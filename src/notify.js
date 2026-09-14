// Push receipts — notify BOTH parties on a settlement, over Telegram.
//
// Wired into the shared _settle() spine, so every money path (tip, bill share,
// subscription charge, escrow release/refund, invoice pay, fx swap) notifies the
// payer and payee. Delivery is best-effort: a notify failure must NEVER fail or
// roll back a settlement that already happened on-chain.
import { MICRO } from './constants.js';

/** Compose the human receipt message (kept short — it's a Telegram DM). */
export function receiptText({ amountMicro, from, to, tagged, rail, txHash, title }) {
  const amt = (Number(amountMicro) / Number(MICRO)).toFixed(3).replace(/\.?0+$/, '');
  const link = txHash ? `\nhttps://celoscan.io/tx/${txHash}` : '';
  const tag = tagged ? ' · ERC-8021 tagged' : '';
  return `💸 ${amt} USAT settled${title ? ` — ${title}` : ''}\nfrom ${short(from)} → ${short(to)}\nrail ${rail || 'settled'}${tag}${link}`;
}
const short = (a) => (a ? String(a).slice(0, 6) + '…' + String(a).slice(-4) : '—');

export class TelegramNotifier {
  /**
   * @param {{ token?: string, registry?: object, fetchImpl?: Function, log?: Function }} opts
   */
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN, registry = null, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.token = token;
    this.registry = registry;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.sent = []; // audit trail (tests + /notifications inspection)
  }

  get enabled() { return Boolean(this.token); }

  /** Send a raw message to a chat id. Best-effort; returns bool delivered. */
  async send(chatId, text) {
    if (!this.enabled || !chatId) return false;
    try {
      const r = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const ok = !!(r && r.ok);
      this.sent.push({ chatId: String(chatId), at: Date.now(), ok, text });
      if (this.sent.length > 300) this.sent.shift();
      return ok;
    } catch (e) { this.log('[humanpay:notify] send failed', (e && e.message) || e); return false; }
  }

  /** Resolve a wallet address to a chatId via the peer registry. */
  chatIdFor(wallet) {
    if (!this.registry || !wallet) return null;
    const u = this.registry.getByWallet(wallet);
    return u ? u.chatId : null;
  }

  /**
   * Notify both parties of a settlement (payer + payee) when reachable.
   * Never throws — always resolves.
   */
  async notifyPayment({ amountMicro, from, to, tagged, rail, txHash, title }) {
    const text = receiptText({ amountMicro, from, to, tagged, rail, txHash, title });
    const targets = new Set([this.chatIdFor(from), this.chatIdFor(to)].filter(Boolean));
    const out = { attempted: targets.size, delivered: 0, text };
    for (const chatId of targets) {
      if (await this.send(chatId, text)) out.delivered++;
    }
    return out;
  }
}
