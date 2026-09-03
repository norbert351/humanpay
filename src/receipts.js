// Tamper-evident decision log. Every policy verdict (allow OR block), the exact
// request that caused it, and the settlement result are written as one record
// chained by hash (each record commits to its predecessor) so the audit trail
// cannot be silently edited. This is the "provable audit receipt" half of the
// agent-trust layer — a judge can verify the whole chain in one pass.
import { createHash, randomBytes } from 'node:crypto';

export class AuditStore {
  constructor(secret = randomBytes(16).toString('hex')) {
    this.secret = secret;
    this.chain = [];
    this.byIndex = new Map();
  }

  _hash(payload) { return createHash('sha256').update(payload).digest('hex'); }

  append({ decision, reason, request, settlement }) {
    const index = this.chain.length;
    const prevHash = index ? this.chain[index - 1].hash : this._hash(`GENESIS:${this.secret}`);
    const body = JSON.stringify({ decision, reason, request, settlement });
    const hash = this._hash(`${this.secret}:${index}:${body}:${prevHash}`);
    const rec = { id: `r-${index}`, index, ts: Date.now(), decision, reason, request, settlement, prevHash, hash };
    this.chain.push(rec);
    this.byIndex.set(index, rec);
    return rec;
  }

  get(id) { return this.byIndex.get(Number(id.replace('r-', ''))) || null; }
  all() { return this.chain; }

  /** Recompute the whole chain to detect any tampering. */
  verifyChain() {
    for (let i = 0; i < this.chain.length; i++) {
      const r = this.chain[i];
      const prevHash = i ? this.chain[i - 1].hash : this._hash(`GENESIS:${this.secret}`);
      const body = JSON.stringify({ decision: r.decision, reason: r.reason, request: r.request, settlement: r.settlement });
      if (r.prevHash !== prevHash) return { ok: false, at: r.index, reason: 'prevHash' };
      if (r.hash !== this._hash(`${this.secret}:${r.index}:${body}:${prevHash}`)) return { ok: false, at: r.index, reason: 'body' };
    }
    return { ok: true, records: this.chain.length };
  }
}