// Persistent tamper-evident decision log — SQLite-backed (node:sqlite, built
// into Node 22, zero new deps). Same hash-chain integrity as the in-memory
// AuditStore: every record commits to its predecessor, so the audit trail
// cannot be silently edited — and it now survives process restarts and
// redeploys (when the DB file lives on durable storage).
//
// Guarantees preserved from AuditStore:
//   rec.hash = sha256(`${secret}:${index}:${body}:${prevHash}`)
//   body     = JSON.stringify({decision, reason, request, settlement})
//   prevHash = previous record's hash (or GENESIS batch for index 0)
//
// API-compatible: constructor(secret), append(), get(), all(), verifyChain().
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class PersistentAuditStore {
  constructor({ secret = randomBytes(16).toString('hex'), path = '', table = 'receipts' } = {}) {
    this.secret = secret;
    this.table = table;
    this.chain = [];
    this.byIndex = new Map();
    this._persist = Boolean(path);
    if (path) {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
      this.db = new DatabaseSync(path);
      this._initSchema();
      this._load();
    }
  }

  _initSchema() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (
      idx INTEGER PRIMARY KEY,
      record TEXT NOT NULL
    )`);
  }

  _load() {
    const rows = this.db.prepare(`SELECT idx, record FROM ${this.table} ORDER BY idx`).all();
    this.chain = rows.map((r) => JSON.parse(r.record));
    this.byIndex = new Map(this.chain.map((r) => [r.index, r]));
  }

  _hash(payload) { return createHash('sha256').update(payload).digest('hex'); }

  _body({ decision, reason, request, settlement }) {
    return JSON.stringify({ decision, reason, request, settlement }, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }

  append({ decision, reason, request, settlement }) {
    const index = this.chain.length;
    const prevHash = index ? this.chain[index - 1].hash : this._hash(`GENESIS:${this.secret}`);
    const body = this._body({ decision, reason, request, settlement });
    const hash = this._hash(`${this.secret}:${index}:${body}:${prevHash}`);
    const rec = { id: `r-${index}`, index, ts: Date.now(), decision, reason, request, settlement, prevHash, hash };
    if (this._persist) {
      this.db.prepare(`INSERT INTO ${this.table} (idx, record) VALUES (?, ?)`).run(index, JSON.stringify(rec));
    }
    this.chain.push(rec);
    this.byIndex.set(index, rec);
    return rec;
  }

  get(id) { return this.byIndex.get(Number(String(id).replace('r-', ''))) || null; }
  all() { return this.chain; }

  /** Recompute the whole chain to detect any tampering. */
  verifyChain() {
    for (let i = 0; i < this.chain.length; i++) {
      const r = this.chain[i];
      const prevHash = i ? this.chain[i - 1].hash : this._hash(`GENESIS:${this.secret}`);
      const body = this._body({ decision: r.decision, reason: r.reason, request: r.request, settlement: r.settlement });
      if (r.prevHash !== prevHash) return { ok: false, at: r.index, reason: 'prevHash' };
      if (r.hash !== this._hash(`${this.secret}:${r.index}:${body}:${prevHash}`)) return { ok: false, at: r.index, reason: 'body' };
    }
    return { ok: true, records: this.chain.length };
  }

  close() { if (this.db) this.db.close(); }
}