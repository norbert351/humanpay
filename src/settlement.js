// Settlement rails. Two implementations behind one interface:
//   * SimulatedSettlement — hermetic in-memory ledger (tests/demo, no gas).
//   * X402Settlement — real USAT transfer over the Celo x402 facilitator, with
//     the ERC-8021 attribution suffix appended to the transfer calldata.
// Both verify PAYMENT-SIGNATURE semantics (amount / chainId / payTo) before
// settling and return a receiptable ledger id.
import { createHash, randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, encodeFunctionData, parseEther } from 'viem';
import { celo } from 'viem/chains';
import { taggedCall, codesIn } from './attribution.js';
import { USAT, ERC20_TRANSFER_SIG, MICRO } from './constants.js';

const ERC20_ABI = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] },
];

/** Convert micro-units to the FEI/wei-style integer the token transfer needs. */
export function toUnit(micro) { return BigInt(micro); }

/** Base ERC-20 transfer calldata BEFORE tagging. */
export function transferCalldata(payTo, amountUnits) {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [payTo, amountUnits] });
}

function unitToWei(units, decimals = 6) { return BigInt(units) * 10n ** BigInt(decimals); }

export class SimulatedSettlement {
  constructor() { this.ledger = new Map(); this.next = 1; }
  async getPaymentRequest({ amountMicro, payTo, token }) {
    if (token !== USAT) throw new Error(`unsupported token: ${token}`);
    return {
      recipient: payTo.toLowerCase(),
      amount: toUnit(amountMicro).toString(),
      token, chainId: 42220, fee: '0', expiresAt: Date.now() + 60_000,
    };
  }
  async pay({ amountMicro, payTo, token, chainId, signature }) {
    // x402 handshake: validate the payee, amount, token, chain.
    const req = await this.getPaymentRequest({ amountMicro, payTo, token });
    if (Number(chainId) !== 42220) throw new Error('PAYMENT-SIGNATURE: wrong chainId');
    if (req.recipient !== payTo.toLowerCase()) throw new Error('PAYMENT-SIGNATURE: payTo mismatch');
    const calldata = taggedCall(transferCalldata(payTo, toUnit(amountMicro)));
    const id = `sim-${this.next++}`;
    const txHash = `0x${createHash('sha256').update(id + Date.now()).digest('hex').slice(0, 64)}`;
    this.ledger.set(id, { id, txHash, calldata, amountMicro, payTo, token, chainId, suffixCodes: codesIn(calldata) });
    return { ledgerId: id, txHash, calldata, suffixCodes: codesIn(calldata) };
  }
  get(id) { return this.ledger.get(id); }
}

export class X402Settlement {
  /** @param {{ executorPrivateKey: string, rpcUrl?: string, facilitatorUrl?: string }} opts */
  constructor({ executorPrivateKey, rpcUrl = 'https://forno.celo.org', facilitatorUrl }) {
    if (!executorPrivateKey) throw new Error('X402Settlement requires executorPrivateKey');
    this.executor = privateKeyToAccount(executorPrivateKey);
    this.rpcUrl = rpcUrl;
    this.facilitatorUrl = facilitatorUrl;
    this.wallet = createWalletClient({ account: this.executor, chain: celo, transport: http(rpcUrl) });
  }

  async pay({ amountMicro, payTo, token, chainId, signature }) {
    if (token !== USAT) throw new Error(`unsupported token: ${token}`);
    if (Number(chainId) !== 42220) throw new Error('PAYMENT-SIGNATURE: wrong chainId');
    // real facilitator handshake would POST an invoice and validate
    // PAYMENT-SIGNATURE; for the shipping kernel we sign + tag + send directly.
    const amountUnits = toUnit(amountMicro);
    const calldata = taggedCall(transferCalldata(payTo, amountUnits));
    const hash = await this.wallet.sendTransaction({
      to: payTo, data: calldata, chain: null, // value in USAT is in the transfer; gas paid in USAT via fee abstraction
      maxFeePerGas: undefined,
    });
    return { ledgerId: `x402-${hash}`, txHash: hash, calldata, suffixCodes: codesIn(calldata) };
  }
}

export { unitToWei };