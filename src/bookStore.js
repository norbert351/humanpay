// Persistent HumanPayBook — same objects as book.js, but backed by node:sqlite
// so bills / subscriptions / escrow / invoices / webhooks / API keys survive a
// restart or redeploy. Mirrors PersistentAuditStore's fail-safe contract: a
// non-writable path degrades to the in-memory store with a loud warning instead
// of crashing the process on boot (a boot crash fails the health check and
// silently pins the previous deploy).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HumanPayBook } from './book.js';

const COLLECTIONS = ['bills', 'subscriptions', 'escrows', 'invoices', 'webhooks', 'apiKeys'];

export class PersistentBook extends HumanPayBook {
  /** @param {{ path: string, secret?: string }} opts */
  constructor({ path, secret } = {}) {
    super();
    this.path = path;
    this.persist = false;
    this.db = null;
    this.secret = secret;
    if (!path) return;
    try {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
      this.db = new DatabaseSync(path);
      this._initSchema();
      this._load();
      this.persist = true;
    } catch (e) {
      console.warn(`[humanpay] persistent book disabled (${e.message}); using in-memory book`);
      this.db = null; this.persist = false;
      for (const c of COLLECTIONS) this[c] = new Map();
    }
  }

  _initSchema() {
    this.db.exec('CREATE TABLE IF NOT EXISTS book (collection TEXT, id TEXT, data TEXT, updated_at INTEGER, PRIMARY KEY (collection, id))');
  }

  _load() {
    for (const row of this.db.prepare('SELECT collection, data FROM book').all()) {
      const col = this[row.collection];
      if (!col) continue;
      try { const obj = JSON.parse(row.data); col.set(obj.id, obj); } catch { /* skip corrupt row */ }
    }
  }

  /** Flush one object of a collection to disk. */
  _save(collection, obj) {
    if (!this.persist || !obj || !obj.id) return;
    try {
      this.db.prepare('INSERT OR REPLACE INTO book (collection,id,data,updated_at) VALUES (?,?,?,?)')
        .run(collection, obj.id, JSON.stringify(obj), Date.now());
    } catch (e) { console.warn('[humanpay] book persist failed', e.message); }
  }

  _remove(collection, id) {
    if (!this.persist || !id) return;
    try { this.db.prepare('DELETE FROM book WHERE collection=? AND id=?').run(collection, id); } catch { /* best-effort */ }
  }

  // ---- Overrides that persist on every state change ---------------------
  createBill(o) { const b = super.createBill(o); this._save('bills', b); return b; }
  payBillShare(id, idx, s) { const b = super.payBillShare(id, idx, s); this._save('bills', b); return b; }

  createSubscription(o) { const x = super.createSubscription(o); this._save('subscriptions', x); return x; }
  chargeSubscription(id, s) { const x = super.chargeSubscription(id, s); this._save('subscriptions', x); return x; }
  cancelSubscription(id) { const x = super.cancelSubscription(id); this._save('subscriptions', x); return x; }

  createEscrow(o) { const x = super.createEscrow(o); this._save('escrows', x); return x; }
  settleEscrow(id, action, s, by) { const x = super.settleEscrow(id, action, s, by); this._save('escrows', x); return x; }

  createInvoice(o) { const x = super.createInvoice(o); this._save('invoices', x); return x; }
  payInvoice(id, s) { const x = super.payInvoice(id, s); this._save('invoices', x); return x; }

  createWebhook(o) { const x = super.createWebhook(o); this._save('webhooks', x); return x; }
  deleteWebhook(id) { const ok = super.deleteWebhook(id); if (ok) this._remove('webhooks', id); return ok; }

  issueApiKey(o) {
    const res = super.issueApiKey(o);
    const rec = this.apiKeys.get(res.keyId);
    this._save('apiKeys', rec);
    return res;
  }
}
