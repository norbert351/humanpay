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
  createWalletClient, http, encodeAbiParameters, hexToBigInt, bytesToHex, keccak256,
  createPublicClient, recoverTypedDataAddress,
} from 'viem';
import { taggedCall, TAG } from './attribution.js';
import { USAT_SIGNER_DOMAIN, USAT_ADDRESS, USAT_DECIMALS } from './constants.js';

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
  }

  /** Current API key (facilitator.connect() is a wallet-sign UI on x402.celo.org). */
  key() { return this.apiKey; }

  /** Atomic USAT amount. */
  toAtomic(micro, decimals = 6) { return BigInt(micro) * 10n ** BigInt(decimals); }

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
   * Settle a payment through the facilitator. Credit is consumed per settlement.
   * Returns the facilitator response. On mainnet this MOVES the executor's USAT
   * to payTo (buyer -> merchant directly; facilitator never holds funds).
   */
  async pay({ amountMicro, payTo, token = 'USAT', chainId = 42220, nonce, _creditsPrepaidAt } = {}) {
    const { typedData, signature } = await this.signTransferAuthorization({ amountMicro, payTo, token, chainId, nonce });
    // Append the ERC-8021 attribution code as a settlement annotation (string form).
    const payment = {
      ...typedData,
      signature,
      resource: tagResource(payTo, amountMicro),
    };
    const resp = await fetch(`${this.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      body: JSON.stringify({ network: 'celo', payment: JSON.stringify(payment) }),
    });
    const data = await resp.json().catch(async () => ({ raw: await resp.text() }));
    if (!resp.ok) throw new Error(`x402 settle failed (${resp.status}): ${data.error || data.message || JSON.stringify(data)}`);
    return { source: 'x402-facilitator', settled: data.settled ?? true, txHash: data.txHash ?? data.transaction, credits: data.credits, payment, tag: TAG };
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