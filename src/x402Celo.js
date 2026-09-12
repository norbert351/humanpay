// Real Celo x402 facilitator client.
// Docs: https://x402.celo.org — "settle USDC, USD₮ and USA₮ gaslessly" via the
// hosted facilitator. Flow:
//   1. connect()  — sign a message with the operator wallet, no gas, get an API key (from the x402.celo.org UI)
//   2. top-up USDC/USDT/USAT to buy prepaid credits (one credit settles one payment)
//   3. pay()      — executor signs an EIP-3009 TransferWithAuthorization (gasless),
//                   POST to /settle, facilitator relays buyer -> payTo directly.
// No smart contracts to deploy, no funds held by the facilitator. Celo mainnet + Sepolia.
//
// EIP-3009 (ERC-20 TransferWithAuthorization) is how the facilitator moves the
// stablecoin "gaslessly for users" — the user signs an authorization, not pays gas.
import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletClient, http, encodeAbiParameters, encodeFunctionData, hexToBigInt, bytesToHex, keccak256,
  createPublicClient, recoverTypedDataAddress,
} from 'viem';
import { taggedCall, TAG } from './attribution.js';
import { transferAuthTypedData } from './auth.js';
import { USAT_SIGNER_DOMAIN, USAT_ADDRESS, USAT_DECIMALS } from './constants.js';

// EIP-3009 transferWithAuthorization — used by the TAGGED DIRECT settlement path
// (the facilitator builds its own calldata, so it can never carry our ERC-8021 tag).
const TRANSFER_WITH_AUTHORIZATION_ABI_SIG = [{
  type: 'function', name: 'transferWithAuthorization', stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
}];

// EIP-3009 domain for the Celo-native USAT (Tether America USD). Default verified
// on-chain 2026-09-04 (signature verifies with name "Tether America USD" and only then).
// Overridable via X402_DOMAIN_NAME / X402_DOMAIN_VERSION (default = verified USAT_SIGNER_DOMAIN).

const TRANSFER_WITH_AUTH_TYPE = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export class X402FacilitatorSettlement {
  /**
   * @param {{ apiKey: string, executorPrivateKey: string, facilitatorUrl?: string,
   *           usatAddress?: string, domain?: object, rpcUrl?: string }} opts
   */
  constructor({
    apiKey, executorPrivateKey, facilitatorUrl = 'https://api.x402.celo.org',
    usatAddress, domain, domainName, domainVersion, rpcUrl = 'https://forno.celo.org',
  }) {
    if (!apiKey) throw new Error('X402FacilitatorSettlement requires apiKey (from x402.celo.org)');
    if (!executorPrivateKey) throw new Error('X402FacilitatorSettlement requires executorPrivateKey');
    this.apiKey = apiKey;
    this.executor = privateKeyToAccount(executorPrivateKey);
    this.facilitatorUrl = facilitatorUrl;
    // USAT on Celo mainnet (verified 2026-09-04). Optional so a Sepolia/token quirk can override.
    this.usatAddress = usatAddress || USAT_ADDRESS;
    this.domain = domain || {
      ...USAT_SIGNER_DOMAIN,
      verifyingContract: this.usatAddress,
      name: domainName || USAT_SIGNER_DOMAIN.name,
      version: domainVersion || USAT_SIGNER_DOMAIN.version,
    };
    this.wallet = createWalletClient({ account: this.executor, transport: http(rpcUrl) });
    this.publicClient = createPublicClient({ transport: http(rpcUrl) });
  }

  /** Current API key (facilitator.connect() is a wallet-sign UI on x402.celo.org). */
  key() { return this.apiKey; }

  /**
   * Atomic USAT amount.
   *
   * UNIT CONVENTION (project-wide, see constants.js `MICRO`): `amountMicro` is
   * ALREADY atomic — callers convert USAT -> micro with `amount * 1_000_000`
   * (src/p2p.js `micro()`), and USAT has 6 decimals, so micro === atomic.
   * This used to multiply by 10^decimals AGAIN, inflating every real settlement
   * by 1e6 (0.10 USAT was submitted as 100,000 USAT) — which surfaced as
   * `insufficient_funds` from the facilitator, not as an obvious unit error.
   * Kept as a named seam so a non-6-decimal token can still override `decimals`.
   */
  toAtomic(micro, decimals = USAT_DECIMALS) {
    const m = BigInt(micro);
    if (decimals === USAT_DECIMALS) return m; // already atomic
    return (m / 10n ** BigInt(USAT_DECIMALS)) * 10n ** BigInt(decimals);
  }

  /** Sign an EIP-3009 TransferWithAuthorization (gasless). Returns typed-data + sig. */
  async signTransferAuthorization({ amountMicro, payTo, token, chainId, nonce }) {
    const value = this.toAtomic(amountMicro);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const typedData = {
      domain: this.domain,
      primaryType: 'TransferWithAuthorization',
      types: TRANSFER_WITH_AUTH_TYPE,
      message: {
        from: this.executor.address,
        to: payTo.toLowerCase(),
        value,
        validAfter: now - 1000n,
        validBefore: now + 3600n, // 1 hour validity
        nonce: typeof nonce === 'string' && nonce.startsWith('0x') ? nonce : bytesToHex(new Uint8Array(32)), // caller may pass; default 0x00..00 (fresh)
      },
    };
    const signature = await this.wallet.signTypedData(typedData);
    return { typedData, signature };
  }

  /**
   * Build the x402 v2 `PaymentPayload` the facilitator expects.
   * Spec: specs/x402-specification-v2.md §5.1/§7 + specs/schemes/exact/scheme_exact_evm.md
   * (EIP-3009 method). The /settle and /verify bodies are:
   *   { x402Version: 2,
   *     paymentPayload: { x402Version, resource, accepted:{scheme,network,amount,
   *       asset,payTo,maxTimeoutSeconds,extra:{name,version}}, payload:{signature,
   *       authorization:{from,to,value,validAfter,validBefore,nonce}} },
   *     paymentRequirements: { scheme, network, amount, asset, payTo,
   *       maxTimeoutSeconds, extra:{name,version} } }
   * Everything that matters is the NESTED `accepted.scheme === 'exact'` plus the
   * sibling `paymentRequirements` — a flat payload (or one without
   * paymentRequirements) is rejected with `unsupported_scheme`, which is a
   * misleading error: it means "I could not find a scheme in the expected place",
   * NOT "you sent a scheme I don't support".
   */
  buildPaymentPayload({ typedData, signature, payTo, amountMicro }) {
    const m = typedData.message;
    const amount = String(this.toAtomic(amountMicro));
    const base = {
      scheme: 'exact',
      network: `eip155:${this.domain.chainId}`,
      amount,
      asset: this.usatAddress,
      payTo: payTo.toLowerCase(),
      maxTimeoutSeconds: 3600,
      extra: { name: this.domain.name, version: this.domain.version },
    };
    return {
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        resource: { url: tagResource(payTo, amountMicro), description: 'HumanPay P2P settlement', mimeType: 'application/json' },
        accepted: { ...base, extra: { assetTransferMethod: 'eip3009', ...base.extra } },
        payload: {
          signature,
          authorization: {
            from: m.from,
            to: m.to,
            value: String(m.value),
            validAfter: String(m.validAfter),
            validBefore: String(m.validBefore),
            nonce: m.nonce,
          },
        },
      },
      paymentRequirements: base,
    };
  }

  /** POST a payment payload to the facilitator /settle and normalise the response. */
  async _settle(body, amountMicro, payTo) {
    const resp = await fetch(`${this.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(async () => ({ raw: await resp.text() }));
    if (!resp.ok || data.success === false) {
      throw new Error(`x402 settle failed (${resp.status}): ${data.errorReason || data.errorMessage || data.invalidReason || data.error || data.message || JSON.stringify(data)}`);
    }
    return {
      source: 'x402-facilitator', settled: data.success ?? data.settled ?? true,
      txHash: data.transaction || data.txHash, credits: data.credits,
      payment: body, tag: TAG, amountMicro: String(amountMicro), payTo,
    };
  }

  /**
   * JSON-safe view of a payment payload. The typed-data `message` carries BigInts
   * (value / validAfter / validBefore) and `JSON.stringify` throws on them — which
   * crashed the REAL settlement path before it ever reached the facilitator
   * (the SimulatedSettlement path never serialized, so tests stayed green).
   * Stringify every BigInt to its decimal form; the facilitator accepts strings.
   */
  static jsonSafe(payment) {
    return JSON.parse(JSON.stringify(payment, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }

  /**
   * Settle a payment through the facilitator. Credit is consumed per settlement.
   * Returns the facilitator response. On mainnet this MOVES the executor's USAT
   * to payTo (buyer -> merchant directly; facilitator never holds funds).
   */
  async pay({ amountMicro, payTo, token = 'USAT', chainId = 42220, nonce, _creditsPrepaidAt } = {}) {
    const { typedData, signature } = await this.signTransferAuthorization({ amountMicro, payTo, token, chainId, nonce });
    const payment = this.buildPaymentPayload({ typedData, signature, payTo, amountMicro });
    return this._settle(payment, amountMicro, payTo);
  }

  /** Resolve the signing account for a payment: per-tip signer if given, else the executor. */
  signerFor(signerPrivateKey) {
    return signerPrivateKey ? privateKeyToAccount(signerPrivateKey) : this.executor;
  }

  /**
   * P2P dev-mode tip: sign an EIP-3009 transfer where `from` is the SENDER's own
   * wallet (not the executor) and relay via the facilitator. signerPrivateKey is
   * the sender's OWN key (bound via /key) — the bot still never consolidates funds.
   */
  async payFrom({ amountMicro, payTo, token = 'USAT', chainId = 42220, nonce, from, signerPrivateKey }) {
    if (Number(chainId) !== 42220) throw new Error('PAYMENT-SIGNATURE: wrong chainId');
    const authorizer = this.signerFor(signerPrivateKey);
    const sender = (from || authorizer.address).toLowerCase();
    const typedData = transferAuthTypedData({
      from: sender,
      to: payTo.toLowerCase(),
      value: this.toAtomic(amountMicro),
      nonce,
      domain: this.domain,
    });
    const signature = await authorizer.signTypedData(typedData);
    return this._relay({ typedData, signature, payTo: payTo.toLowerCase(), amountMicro });
  }

  /**
   * PRODUCTION self-custody path: return the unsigned EIP-3009 typed-data the
   * sender must sign in their own wallet app (never exposing their key to the bot).
   */
  async offlineAuth({ amountMicro, payTo, from, token = 'USAT', chainId = 42220, nonce }) {
    if (Number(chainId) !== 42220) throw new Error('PAYMENT-SIGNATURE: wrong chainId');
    const typedData = transferAuthTypedData({
      from: from.toLowerCase(),
      to: payTo.toLowerCase(),
      value: this.toAtomic(amountMicro),
      nonce,
      domain: this.domain,
    });
    return { typedData, signature: null };
  }

  /** Relay a user-signed EIP-3009 authorization through the facilitator. */
  async settleWithSignature({ typedData, signature }) {
    if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('PAYMENT-SIGNATURE: invalid signature');
    const value = BigInt(typedData.message.value);
    const amountMicro = value; // amountMicro IS atomic for 6-decimal USAT (see toAtomic)
    const payTo = typedData.message.to;
    return this._relay({ typedData, signature, payTo, amountMicro });
  }

  /**
   * TAGGED DIRECT SETTLEMENT — the attribution path.
   *
   * The facilitator builds and broadcasts the calldata itself, so a settlement
   * relayed through it can NEVER carry the ERC-8021 tag (verified live: the
   * resulting tx is a clean transferWithAuthorization with no data suffix, and
   * fromDataSuffix() returns null). The hackathon leaderboard counts ONLY txs
   * carrying the assigned tag — so this method submits the SAME EIP-3009
   * authorization directly, from the executor, with `toDataSuffix(TAG)` appended.
   * Cost: the executor pays gas (~0.001 CELO on Celo). Benefit: the tx is credited.
   *
   * The authorization itself is unchanged (same signature, same EIP-3009
   * semantics) — only the broadcaster differs, so the anti-drain guarantees hold.
   */
  async settleTagged({ typedData, signature, amountMicro, payTo }) {
    if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('PAYMENT-SIGNATURE: invalid signature');
    const m = typedData.message;
    // The direct path broadcasts from the EXECUTOR's wallet, and EIP-3009 requires
    // the tx sender to be the authorization's `from` (or an approved party) — so
    // this path only works when the authorization was signed by the executor.
    if (m.from.toLowerCase() !== this.executor.address.toLowerCase()) {
      throw new Error(`tagged path requires the executor to be the authorizer (auth from ${m.from.slice(0,10)}…, executor ${this.executor.address.slice(0,10)}…)`);
    }
    const base = encodeFunctionData({
      abi: TRANSFER_WITH_AUTHORIZATION_ABI_SIG,
      functionName: 'transferWithAuthorization',
      args: [m.from, m.to, BigInt(m.value), BigInt(m.validAfter), BigInt(m.validBefore), m.nonce, signature],
    });
    const data = taggedCall(base); // ERC-8021 tag appended to the calldata
    const hash = await this.wallet.sendTransaction({ to: this.usatAddress, data, account: this.executor });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`tagged settle reverted: ${hash}`);
    return {
      source: 'celo-direct-tagged', settled: true, txHash: hash,
      tag: TAG, amountMicro: String(amountMicro ?? m.value), payTo,
      explorer: `https://celoscan.io/tx/${hash}`,
    };
  }

  async _relay({ typedData, signature, payTo, amountMicro }) {
    const payment = this.buildPaymentPayload({ typedData, signature, payTo, amountMicro });
    return this._settle(payment, amountMicro, payTo);
  }
}

/** Tag a settlement reference with the assigned attribution code for the receipt. */
export function tagResource(payTo, amountMicro) {
  return `humanpay:${payTo.slice(0, 8)}:${amountMicro}:${TAG}`;
}

/** Recovery helper (for tests): prove the transfer-authorization signature is the executor's. */
export async function recoverTransferAuthAddress({ typedData, signature }) {
  const { domain, types, primaryType, message } = typedData;
  return recoverTypedDataAddress({ address: message.from, domain, types, primaryType, message, signature });
}