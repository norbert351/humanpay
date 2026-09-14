// Business objects on top of the bounded-pay spine: split bills, subscriptions,
// escrow, invoices, webhooks, API keys. All money movement routes through the
// SAME policy engine + settlement rail + tamper-evident receipts; these objects
// just describe intent (who owes what, when, to whom) so a payment is never
// authorised by object state alone — the human signature + caps still gate it.
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { MICRO } from './constants.js';

const now = () => Date.now();
const id = (p) => `${p}_${randomUUID().slice(0, 8)}`;

/** Split a total into N shares in integer micro-units (remainder-safe). */
export function splitShares(totalMicro, parts) {
  const n = Math.max(1, Number(parts) | 0);
  const total = BigInt(totalMicro);
  const base = total / BigInt(n);
  const rem = total % BigInt(n);
  return Array.from({ length: n }, (_, i) => (i < Number(rem) ? base + 1n : base).toString());
}

export class HumanPayBook {
  constructor() {
    this.bills = new Map();         // id -> bill (split-a-bill)
    this.subscriptions = new Map(); // id -> subscription
    this.escrows = new Map();       // id -> escrow
    this.invoices = new Map();      // id -> invoice
    this.webhooks = new Map();      // id -> webhook
    this.apiKeys = new Map();       // keyId -> {keyHash, label, createdAt, lastUsedAt}
    this.events = [];               // outbound event log (for delivery + tests)
  }

  // ---- Split-a-bill (the ONE narrow job) --------------------------------
  createBill({ title, totalMicro, parts, creator, recipients, currency = 'USAT' }) {
    if (!totalMicro || BigInt(totalMicro) <= 0n) throw new Error('totalMicro must be > 0');
    const p = Number(parts) || 0;
    if (p < 2 || p > 20) throw new Error('parts must be between 2 and 20');
    const shares = splitShares(totalMicro, p);
    const list = Array.isArray(recipients) ? recipients.slice(0, p) : [];
    const bill = {
      id: id('bill'), title: title || 'Untitled bill', currency,
      totalMicro: String(totalMicro), parts: p, shares,
      creator: creator || null, recipients: list,
      settlements: Array.from({ length: p }, () => null), // per-share settlement
      status: 'open', createdAt: now(), updatedAt: now(),
    };
    this.bills.set(bill.id, bill);
    return bill;
  }
  getBill(billId) { return this.bills.get(billId) || null; }
  listBills(filter = {}) {
    let out = [...this.bills.values()];
    if (filter.creator) out = out.filter((b) => b.creator === filter.creator);
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  /** Mark share `idx` settled (called after a real/tagged settlement succeeds). */
  payBillShare(billId, idx, settlement) {
    const b = this.bills.get(billId);
    if (!b) throw new Error('bill not found');
    const i = Number(idx);
    if (!(i >= 0 && i < b.parts)) throw new Error('invalid share index');
    if (b.settlements[i]) throw new Error('share already paid');
    b.settlements[i] = settlement;
    b.updatedAt = now();
    if (b.settlements.every((s) => s)) b.status = 'paid';
    return b;
  }

  // ---- Subscriptions (recurring bounded pay) ----------------------------
  createSubscription({ payer, payee, amountMicro, intervalSec, label }) {
    if (!payer || !payee) throw new Error('payer and payee required');
    if (!amountMicro || BigInt(amountMicro) <= 0n) throw new Error('amountMicro must be > 0');
    const iv = Number(intervalSec);
    if (!(iv >= 60 && iv <= 60 * 60 * 24 * 31)) throw new Error('intervalSec must be 60s..31d');
    const sub = {
      id: id('sub'), payer: String(payer).toLowerCase(), payee: String(payee).toLowerCase(),
      amountMicro: String(amountMicro), intervalSec: iv, label: label || 'Subscription',
      status: 'active', createdAt: now(), nextDueAt: now() + iv * 1000, runs: 0, history: [],
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }
  getSubscription(sid) { return this.subscriptions.get(sid) || null; }
  listSubscriptions(filter = {}) {
    let out = [...this.subscriptions.values()];
    if (filter.payer) out = out.filter((s) => s.payer === String(filter.payer).toLowerCase());
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  /** Advance a subscription after a successful (policy-gated) charge. */
  chargeSubscription(sid, settlement) {
    const s = this.subscriptions.get(sid);
    if (!s) throw new Error('subscription not found');
    if (s.status !== 'active') throw new Error('subscription not active');
    s.runs += 1;
    s.nextDueAt = now() + s.intervalSec * 1000;
    s.history.push({ at: now(), settlement });
    if (s.history.length > 120) s.history.shift();
    return s;
  }
  cancelSubscription(sid) {
    const s = this.subscriptions.get(sid);
    if (!s) throw new Error('subscription not found');
    s.status = 'cancelled'; s.updatedAt = now();
    return s;
  }

  // ---- Escrow (hold → release / refund) ---------------------------------
  createEscrow({ buyer, seller, amountMicro, terms }) {
    if (!buyer || !seller) throw new Error('buyer and seller required');
    if (!amountMicro || BigInt(amountMicro) <= 0n) throw new Error('amountMicro must be > 0');
    const e = {
      id: id('esc'), buyer: String(buyer).toLowerCase(), seller: String(seller).toLowerCase(),
      amountMicro: String(amountMicro), terms: terms || null, status: 'held',
      createdAt: now(), updatedAt: now(), release: null, refund: null,
    };
    this.escrows.set(e.id, e);
    return e;
  }
  getEscrow(eid) { return this.escrows.get(eid) || null; }
  listEscrows(filter = {}) {
    let out = [...this.escrows.values()];
    if (filter.buyer) out = out.filter((e) => e.buyer === String(filter.buyer).toLowerCase());
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  settleEscrow(eid, action, settlement, by) {
    const e = this.escrows.get(eid);
    if (!e) throw new Error('escrow not found');
    if (e.status !== 'held') throw new Error(`escrow already ${e.status}`);
    if (action === 'release') { e.status = 'released'; e.release = { at: now(), by, settlement }; }
    else if (action === 'refund') { e.status = 'refunded'; e.refund = { at: now(), by, settlement }; }
    else throw new Error('action must be release|refund');
    e.updatedAt = now();
    return e;
  }

  // ---- Invoices / payment requests --------------------------------------
  createInvoice({ from, to, amountMicro, note, dueAt }) {
    if (!from || !to) throw new Error('from and to required');
    if (!amountMicro || BigInt(amountMicro) <= 0n) throw new Error('amountMicro must be > 0');
    const inv = {
      id: id('inv'), from: String(from).toLowerCase(), to: String(to).toLowerCase(),
      amountMicro: String(amountMicro), note: note || null, status: 'open',
      createdAt: now(), dueAt: dueAt || null, paidAt: null, settlement: null,
    };
    this.invoices.set(inv.id, inv);
    return inv;
  }
  getInvoice(iid) { return this.invoices.get(iid) || null; }
  listInvoices(filter = {}) {
    let out = [...this.invoices.values()];
    if (filter.from) out = out.filter((i) => i.from === String(filter.from).toLowerCase());
    if (filter.to) out = out.filter((i) => i.to === String(filter.to).toLowerCase());
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  payInvoice(iid, settlement) {
    const inv = this.invoices.get(iid);
    if (!inv) throw new Error('invoice not found');
    if (inv.status === 'paid') throw new Error('invoice already paid');
    inv.status = 'paid'; inv.paidAt = now(); inv.settlement = settlement;
    return inv;
  }

  // ---- Webhooks ----------------------------------------------------------
  createWebhook({ url, events = ['*'], secret }) {
    let u;
    try { u = new URL(url); } catch { throw new Error('invalid webhook url'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('webhook url must be http(s)');
    const s = secret || randomBytes(16).toString('hex');
    const wh = { id: id('wh'), url, events, secret: s, createdAt: now(), deliveries: 0, lastStatus: null };
    this.webhooks.set(wh.id, wh);
    return wh;
  }
  getWebhook(wid) { return this.webhooks.get(wid) || null; }
  listWebhooks() { return [...this.webhooks.values()].map((w) => ({ ...w, secret: w.secret.slice(0, 6) + '…' })); }
  deleteWebhook(wid) { return this.webhooks.delete(wid); }

  /** Record + (optionally) deliver an event to matching webhooks. */
  async emit(event, payload, { fetchImpl = globalThis.fetch } = {}) {
    const rec = { event, payload, at: now(), matched: 0, ok: 0 };
    for (const wh of this.webhooks.values()) {
      if (!(wh.events.includes('*') || wh.events.includes(event))) continue;
      rec.matched++;
      const body = JSON.stringify({ event, at: rec.at, data: payload });
      const sig = 'sha256=' + createHmac('sha256', wh.secret).update(body).digest('hex');
      wh.deliveries++;
      try {
        const r = await fetchImpl(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HumanPay-Signature': sig, 'X-HumanPay-Event': event }, body });
        wh.lastStatus = r && r.status;
        if (r && r.ok) rec.ok++;
      } catch (e) { wh.lastStatus = 'error'; }
    }
    this.events.push(rec);
    if (this.events.length > 200) this.events.shift();
    return rec;
  }

  // ---- API keys ----------------------------------------------------------
  issueApiKey({ label }) {
    const raw = 'hp_' + randomBytes(24).toString('hex');
    const keyId = raw.slice(0, 11);
    const keyHash = createHmac('sha256', 'humanpay-apikey').update(raw).digest('hex');
    this.apiKeys.set(keyId, { keyId, keyHash, label: label || 'default', createdAt: now(), lastUsedAt: null });
    return { keyId, apiKey: raw, label: label || 'default' }; // raw shown ONCE
  }
  verifyApiKey(raw) {
    if (!raw || !String(raw).startsWith('hp_')) return null;
    const keyId = String(raw).slice(0, 11);
    const rec = this.apiKeys.get(keyId);
    if (!rec) return null;
    const h = createHmac('sha256', 'humanpay-apikey').update(String(raw)).digest('hex');
    const a = Buffer.from(h, 'hex'); const b = Buffer.from(rec.keyHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    rec.lastUsedAt = now();
    return rec;
  }
  listApiKeys() { return [...this.apiKeys.values()].map((k) => ({ keyId: k.keyId, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })); }

  // ---- Insights ----------------------------------------------------------
  /** Aggregate spend from receipts (+ book objects) for the operator view. */
  insights(receipts = []) {
    const byDay = {};
    const byCounterparty = {};
    let allowed = 0, blocked = 0, totalMicro = 0n;
    for (const r of receipts) {
      if (r.decision === 'allow') {
        allowed++;
        const amt = BigInt((r.request && r.request.amountMicro) || (r.settlement && r.settlement.amountMicro) || 0);
        totalMicro += amt;
        const day = new Date(r.at || r.createdAt || Date.now()).toISOString().slice(0, 10);
        byDay[day] = (byDay[day] || 0n) + amt;
        const cp = (r.request && (r.request.payTo || r.request.to)) || (r.settlement && r.settlement.payTo) || 'unknown';
        byCounterparty[cp] = (byCounterparty[cp] || 0n) + amt;
      } else if (r.decision === 'block') blocked++;
    }
    const micro = (v) => Number(v) / Number(MICRO);
    return {
      allowed, blocked,
      totalUsat: Number(totalMicro) / Number(MICRO),
      byDay: Object.fromEntries(Object.entries(byDay).map(([d, v]) => [d, micro(v)])),
      topCounterparties: Object.entries(byCounterparty).sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 10).map(([k, v]) => ({ wallet: k, usat: micro(v) })),
      counts: { bills: this.bills.size, subscriptions: this.subscriptions.size, escrows: this.escrows.size, invoices: this.invoices.size },
    };
  }
}
