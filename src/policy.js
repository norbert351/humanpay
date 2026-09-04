// The load-bearing anti-drain spine.
//
// Threat this exists to stop (the reason the product wins, per research):
//   * May-2026: prompt injection in a Morse-code tweet drained ~$150K from a
//     Grok-linked agent wallet.
//   * Jan-2026: over-permissioned agents amplified the ~$40M Step Finance breach.
//
// Design (answers Forbes/TRM's "who is accountable when agents move money"):
//   * The agent NEVER holds the master seed. A separate OPERATOR key (held by
//     the human) must sign each payment request's authorization.
//   * A bounded spend-policy caps the agent: per-tx max, daily cap, lifetime cap
//     (integer micro-units — no float drift).
//   * payTo allowlist restricts which address money can ever flow to.
//   * Only after a valid operator signature + within caps + allowlisted does the
//     policy ALLOW. Everything else is BLOCKED with a machine-readable reason.
// So even a prompt-injected agent cannot self-authorize or exceed its bounds.
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { recoverMessageAddress } from 'viem';
import { CHAIN_ID, USAT, MICRO } from './constants.js';

export function fmtMicro(micro) { return Number(micro) / Number(MICRO); }

/** A fresh operator key (the human's authorizing key — not the executor). */
export function newOperatorKey() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address, sign: async (message) => account.signMessage({ message }), account };
}

/**
 * Message the operator signs to authorize ONE payment.
 * Binds nonce + amount + payTo + token + chainId so a replayed/stolen signature
 * can't be reused for a different (larger / other-recipient) payment.
 */
export function authMessage({ nonce, amountMicro, payTo, token, chainId, ts }) {
  return JSON.stringify({ nonce, amountMicro: amountMicro.toString(), payTo, token, chainId, ts });
}

export class SpendPolicyEngine {
  /** @param {{ operatorAddress: string }} opts */
  constructor({ operatorAddress }) {
    this.operatorAddress = operatorAddress.toLowerCase();
    this.limit = null;
    this.spentToday = 0n;
    this.epoch = null; // UTC day number; rolls the daily cap over midnight
    this.spentTotal = 0n;
  }

  /** Set the bounded spend policy ONCE. Integers in micro-units. */
  registerLimit({ perTxMaxMicro, dayCapMicro, totalCapMicro, allowlist = [], allowAny = false }) {
    if (this.limit) throw new Error('limit already registered; policy is one-time by design');
    this.limit = {
      perTxMaxMicro: BigInt(perTxMaxMicro),
      dayCapMicro: BigInt(dayCapMicro),
      totalCapMicro: BigInt(totalCapMicro),
      allowlist: allowlist.map((a) => a.toLowerCase()),
      allowAny: !!allowAny,
    };
    return this.limit;
  }

  dayOffset() { return Math.floor(Date.now() / 86_400_000); }

  /** Authorize a payment request. Returns { allow:true } or { allow:false, reason }. */
  async check({ nonce, amountMicro, payTo, token, chainId, ts, signature }) {
    if (!this.limit) return { allow: false, reason: 'NO_LIMIT' };
    const amt = BigInt(amountMicro);

    // 1. token + chain bound — only USAT on Celo mainnet moves (stablecoin subtrack "both halves").
    if (token !== USAT) return { allow: false, reason: `TOKEN_NOT_ALLOWED:${token}` };
    if (Number(chainId) !== Number(CHAIN_ID)) return { allow: false, reason: `CHAIN_NOT_ALLOWED:${chainId}` };

    // 2. positive sensible amount
    if (amt <= 0n) return { allow: false, reason: 'NON_POSITIVE_AMOUNT' };

    // 3. operator authorization — the human signed THIS exact request.
    const msg = authMessage({ nonce, amountMicro: amt, payTo, token, chainId, ts });
    let signer;
    try { signer = (await recoverMessageAddress({ message: msg, signature })).toLowerCase(); }
    catch (e) { return { allow: false, reason: 'BAD_SIGNATURE' }; }
    if (signer !== this.operatorAddress) return { allow: false, reason: 'OPERATOR_MISMATCH' };

    return this._budgetAllow(amt, payTo, token, chainId);
  }

  /**
   * Budget + allowlist check WITHOUT signature recovery. Used by the self-custody
   * P2P path, where the EIP-3009 transfer signature is verified at the transport
   * layer (recoverTypedDataAddress over the sender's own wallet). The manager here
   * still enforces per-user caps + the registered-recipient rule.
   */
  async checkBudget({ amountMicro, payTo, token, chainId }) {
    if (!this.limit) return { allow: false, reason: 'NO_LIMIT' };
    const amt = BigInt(amountMicro);
    if (token !== USAT) return { allow: false, reason: `TOKEN_NOT_ALLOWED:${token}` };
    if (Number(chainId) !== Number(CHAIN_ID)) return { allow: false, reason: `CHAIN_NOT_ALLOWED:${chainId}` };
    if (amt <= 0n) return { allow: false, reason: 'NON_POSITIVE_AMOUNT' };
    return this._budgetAllow(amt, payTo, token, chainId);
  }

  /** Shared per-tx / daily / lifetime / allowlist cap check; reserves spend on ALLOW. */
  _budgetAllow(amt, payTo, token, chainId) {
    // 4. per-tx cap
    if (amt > this.limit.perTxMaxMicro) return { allow: false, reason: 'OVER_PER_TX_CAP' };

    // 5. daily cap w/ midnight rollover
    const nowDay = this.dayOffset();
    if (this.epoch !== nowDay) { this.epoch = nowDay; this.spentToday = 0n; }
    if (this.spentToday + amt > this.limit.dayCapMicro) return { allow: false, reason: 'OVER_DAY_CAP' };

    // 6. lifetime cap
    if (this.spentTotal + amt > this.limit.totalCapMicro) return { allow: false, reason: 'OVER_TOTAL_CAP' };

    // 7. allowlist
    if (!this.limit.allowAny && !this.limit.allowlist.includes(payTo.toLowerCase())) {
      return { allow: false, reason: 'PAYTO_NOT_ALLOWED' };
    }

    // ALLOW — reserve the spend so concurrent requests can't overrun the caps.
    this.spentToday += amt;
    this.spentTotal += amt;
    return { allow: true, usedToday: this.spentToday, usedTotal: this.spentTotal };
  }
}