// HumanPay Telegram transport — the distribution channel.
// A MessageHandler turns a Telegram update (command text) into the full
// policy->settle->receipt flow. The bot signs /pay authorizations with the
// OPERATOR key (held in the bot's own env/secret store — the executor never
// holds the master seed). Fully testable with synthetic updates; the long-poll
// bot in bot.mjs wires it to a real token.
import { authMessage } from './policy.js';
import { fmtMicro } from './policy.js';
import { railStatus, railStatusLine } from './railcheck.js';

const HELP = [
  'HumanPay — bounded auto-pay agent (Celo, tag celo_131f6e57e5b5).',
  '/start — this help',
  '/limit <perTx> <dayCap> <totalCap> <payTo ...> — set the one-time bounded spend policy (USAT units) + payee allowlist',
  '/pay <amount> <payTo> [note] — request a payment (operator signs; must be within caps + allowlisted)',
  '/status — policy + operator',
  '/rail — live settlement + proof-of-human rail readiness',
  '/proof — audit-chain integrity',
  '/receipts — last receipts',
].join('\n');

export class TeleMessageHandler {
  constructor({ engine, selfGate, settlement, receipts, operatorSign, operatorAddress }) {
    if (!engine) throw new Error('engine required');
    if (!settlement) throw new Error('settlement required');
    if (!receipts) throw new Error('receipts required');
    if (!operatorSign) throw new Error('operatorSign required (signs each payment authorization)');
    this.engine = engine;
    this.selfGate = selfGate;
    this.settlement = settlement;
    this.receipts = receipts;
    this.operatorSign = operatorSign;
    this.operatorAddress = operatorAddress || 'unknown';
  }

  /** Returns a reply string (and optional extra state) for a chat message. */
  async handle(text = '') {
    const [cmd, ...rest] = text.trim().split(/\s+/);
    switch (cmd) {
      case '/start': return HELP;
      case '/status': return this.status();
      case '/rail': return await this.rail();
      case '/proof': return this.proof();
      case '/receipts': return this.receiptsText();
      case '/limit': return await this.setLimit(rest);
      case '/pay': return await this.pay(rest);
      default: return 'Unknown command. ' + HELP;
    }
  }

  status() {
    const l = this.engine.limit;
    return l
      ? `operator: ${this.operatorAddress}\nperTx ${fmtMicro(l.perTxMaxMicro)} · day ${fmtMicro(l.dayCapMicro)} · total ${fmtMicro(l.totalCapMicro)} · allowAny ${l.allowAny}\nspent(day ${fmtMicro(this.engine.spentToday)} / total ${fmtMicro(this.engine.spentTotal)})`
      : `operator: ${this.operatorAddress} — no spend-limit set yet (run /limit)`;
  }

  /** Honest live readiness of the settlement + proof-of-human rails. */
  async rail() {
    try {
      const s = await railStatus({ operatorAddress: this.operatorAddress, settlement: this.settlement, selfGate: this.selfGate });
      return railStatusLine(s);
    } catch (e) {
      return `rail check error: ${(e && e.message) || e}`;
    }
  }

  proof() { return JSON.stringify(this.receipts.verifyChain()); }

  receiptsText() {
    return this.receipts.all().slice(-5).map((r) =>
      `#${r.index} ${r.decision}${r.reason ? `:${r.reason}` : ''} · ${r.settlement ? (r.settlement.txHash || r.settlement.ledgerId) : '-'}`).join('\n') || '(none)';
  }

  async setLimit(rest) {
    const [perTx, day, total, ...addrs] = rest;
    const n = (v) => { const m = Number(v); if (!Number.isFinite(m) || m < 0) throw new Error('limit must be a non-negative number of USAT'); return BigInt(Math.round(m * 1_000_000)); };
    try {
      this.engine.registerLimit({ perTxMaxMicro: n(perTx), dayCapMicro: n(day), totalCapMicro: n(total), allowlist: addrs.map(a => a.toLowerCase()), allowAny: addrs.length === 0 });
      return `policy set ✓ (allowAny=${addrs.length === 0})` + this.status().replace(/^operator.*/, ''); // (status prints operator)
    } catch (e) { return `ERR: ${e.message}`; }
  }

  async pay(rest) {
    const [amount, payTo, ...note] = rest;
    if (!amount || !payTo) return 'usage: /pay <amount> <payTo> [note]';
    const amt = BigInt(Math.round(Number(amount) * 1_000_000));
    if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) return 'payTo must be a valid 0x address';
    // 1. proof-of-human gate
    const gate = await this.selfGate.verify({ chat: 'telegram', note: note.join(' ') });
    if (!gate.ok) return `denied: ${gate.reason || 'NOT_HUMAN'}`;

    const req = { nonce: String(Date.now()), amountMicro: amt, payTo: payTo.toLowerCase(), token: 'USAT', chainId: 42220, ts: Date.now(), note: note.join(' ') };
    // 2. operator signs THIS exact request (bounded, allowlisted)
    const signature = await this.operatorSign(req);
    const verdict = await this.engine.check({ ...req, signature });
    if (!verdict.allow) {
      this.receipts.append({ decision: 'block', reason: verdict.reason, request: req, settlement: null });
      return `blocked: ${verdict.reason}`;
    }
    // 3. settle on the rail
    const settled = await this.settlement.pay({ amountMicro: amt, payTo: req.payTo, token: 'USAT', chainId: 42220, signature });
    // 4. tamper-evident receipt
    const rec = this.receipts.append({ decision: 'allow', reason: null, request: req, settlement: settled });
    return `paid ${amount} USAT -> ${payTo.slice(0, 8)}…\nreceipt ${rec.id} · tag celo_131f6e57e5b5${settled.txHash ? `\ntx ${settled.txHash}` : ''}${settled.source ? `\nrail ${settled.source}` : ''}`;
  }
}