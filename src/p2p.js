// HumanPay P2P Telegram transport — the peer-to-peer tipping lane.
//
// Each user funds their OWN Celo wallet and tips OTHER registered users through
// the bot. A tip moves USAT from the SENDER's wallet to the RECIPIENT's wallet
// over the gasless x402/EIP-3009 rail — the bot never holds or consolidates funds.
//
// Two sign paths (both preserved, per the self-custody mandate):
//   * self-custody (primary): /tip returns the exact EIP-3009 typed-data to sign
//     in the sender's own wallet app, then /tipsign <sig> relays it. The bot never
//     sees a key.
//   * DEV seam (demo): /key <pk> binds the sender's OWN key (honest, labeled) so
//     /tip auto-signs from their wallet for a smooth live demo.
//
// The anti-drain spine is now per-user: each user's self-set caps bound THEIR OWN
// wallet, and the UserRegistry is the payTo allowlist — you can only tip registered
// users, so money can never flow to an undeclared address. Every allow/block is
// hash-chained into the shared AuditStore and ERC-8021-tagged.
import { recoverTypedDataAddress } from 'viem';
import { fmtMicro } from './policy.js';
import { railStatus, railStatusLine } from './railcheck.js';
import { USER_AGENT_TAG } from './tag.js';

const micro = (amount) => BigInt(Math.round(Number(amount) * 1_000_000));

const HELP = [
  'HumanPay — P2P tips on Celo. Bring your own wallet, tip your people.',
  '/start — this help',
  '/register <0xYourUSATWallet> [@handle] — bind YOUR wallet to this chat',
  '/limit <perTx> <dayCap> <totalCap> — set YOUR bounded spend caps (USAT units)',
  '/me — your wallet + limits + balance',
  '/wallet <@user> — look up another registered user\'s wallet',
  '/tip <amount> <@user|0xwallet> — tip from YOUR wallet; sign it yourself (self-custody) or use /key in DEV mode',
  '/tipsign <signature> — relay a signed self-custody tip /tip gave you',
  '/status /rail /receipts /proof — policy / live rails / audit chain',
].join('\n');

export class P2PTeleMessageHandler {
  constructor({ registry, selfGate, settlement, receipts, tag = USER_AGENT_TAG }) {
    if (!registry) throw new Error('UserRegistry required');
    if (!settlement) throw new Error('settlement required');
    if (!receipts) throw new Error('receipts required');
    this.registry = registry;
    this.selfGate = selfGate;
    this.settlement = settlement;
    this.receipts = receipts;
    this.tag = tag;
    this.pending = new Map(); // chatId -> { req, typedData } awaiting /tipsign
  }

  /** Returns a reply string, or null if this command does not belong to P2P. */
  async handle(text = '', ctx = {}) {
    const [cmd, ...rest] = String(text).trim().split(/\s+/);
    switch (cmd) {
      case '/start': case '/help': return HELP;
      case '/register': return this.register(ctx, rest);
      case '/key': return this.key(ctx, rest);
      case '/limit': return this.limit(ctx, rest);
      case '/me': case '/my': return this.me(ctx, rest);
      case '/wallet': return this.wallet(rest);
      case '/tip': return await this.tip(ctx, rest);
      case '/tipsign': return await this.tipSign(ctx, rest);
      default: return null;
    }
  }

  register(ctx, rest) {
    const [wallet, handle] = rest;
    if (!wallet) return 'usage: /register <0xYourUSATWallet> [@handle]';
    try {
      const user = this.registry.register({ chatId: ctx.chatId ?? 'local', wallet, handle });
      return `registered ${user.wallet.slice(0, 6)}…${user.wallet.slice(-4)} for this chat ✓\n${user.handle ? `handle ${user.handle}\n` : ''}next: /limit <perTx> <dayCap> <totalCap> to set your spend bounds`;
    } catch (e) { return `ERR: ${e.message}`; }
  }

  key(ctx, rest) {
    const [pk] = rest;
    if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) return 'usage: /key <0xYourPrivateKey>  (DEV seam — auto-signs tips from YOUR wallet)';
    try {
      const u = this.registry.setDevKey(ctx.chatId ?? 'local', pk);
      return `DEV mode on: tips auto-sign from ${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)} (self-custody production flow = /tip then sign yourself, no /key)`;
    } catch (e) { return `ERR: ${e.message}`; }
  }

  limit(ctx, rest) {
    const [perTx, day, total] = rest;
    if (!perTx || !day || !total) return 'usage: /limit <perTx> <dayCap> <totalCap> (USAT units)';
    const u = this.registry.get(ctx.chatId ?? 'local');
    if (!u) return 'register first: /register <0xYourUSATWallet>';
    const n = (v) => { const m = Number(v); if (!Number.isFinite(m) || m < 0) throw new Error('limit must be a non-negative USAT number'); return BigInt(Math.round(m * 1_000_000)); };
    try {
      u.engine.registerLimit({ perTxMaxMicro: n(perTx), dayCapMicro: n(day), totalCapMicro: n(total), allowAny: true });
      return `your policy set ✓ perTx ${perTx} · day ${day} · total ${total} USAT (recipients must be registered users)`;
    } catch (e) { return `ERR: ${e.message}`; }
  }

  me(ctx) {
    const u = this.registry.get(ctx.chatId ?? 'local');
    if (!u) return 'not registered. /register <0xYourUSATWallet> [@handle]';
    const l = u.engine.limit;
    return [
      `wallet: ${u.wallet}`,
      u.handle ? `handle: ${u.handle}` : null,
      l
        ? `bounds: perTx ${fmtMicro(l.perTxMaxMicro)} · day ${fmtMicro(l.dayCapMicro)} · total ${fmtMicro(l.totalCapMicro)} USAT`
        : 'bounds: not set (run /limit <perTx> <dayCap> <totalCap>)',
      `spent: day ${fmtMicro(u.engine.spentToday)} · total ${fmtMicro(u.engine.spentTotal)} USAT`,
      u.devKey ? 'keys: DEV mode (auto-sign on)' : 'keys: self-custody (sign each tip yourself)',
      `balance: 0 (fund YOUR wallet out-of-band; see /rail)`,
    ].filter(Boolean).join('\n');
  }

  wallet(rest) {
    const [target] = rest;
    if (!target) return 'usage: /wallet <@user|0xwallet>';
    const u = this.registry.resolveTarget(target);
    return u ? `${u.handle || u.chatId}: ${u.wallet}` : `no registered user matches "${target}"`;
  }

  async tip(ctx, rest) {
    const [amount, target, ...note] = rest;
    if (!amount || !target) return 'usage: /tip <amount> <@user|0xwallet> [note]';
    const sender = this.registry.get(ctx.chatId ?? 'local');
    if (!sender) return 'register first: /register <0xYourUSATWallet>';
    const recv = this.registry.resolveTarget(target);
    if (!recv) return `no registered HumanPay user matches "${target}" — tell them to /register first`;
    if (recv === sender) return 'you cannot tip yourself';

    const amt = micro(amount);
    if (amt <= 0n) return 'amount must be positive';

    const gate = await this.selfGate.verify({ chat: 'telegram', note: note.join(' ') });
    if (!gate.ok) return `denied: ${gate.reason || 'NOT_HUMAN'}`;

    const req = {
      nonce: String(Date.now()), amountMicro: amt, payTo: recv.wallet,
      token: 'USAT', chainId: 42220, ts: Date.now(), note: note.join(' '), from: sender.wallet,
    };

    // DEV-mode auto-sign from the sender's OWN wallet (no central executor).
    if (sender.devKey) {
      const { signAuth } = await import('./p2pSign.js');
      const signature = await signAuth(sender.devKey, req);
      const verdict = await sender.engine.check({ ...req, signature });
      if (!verdict.allow) {
        this.receipts.append({ decision: 'block', reason: verdict.reason, request: req, settlement: null });
        return `blocked: ${verdict.reason}`;
      }
      const settled = await this.settlement.payFrom({ amountMicro: amt, payTo: recv.wallet, token: 'USAT', chainId: 42220, from: sender.wallet, signerPrivateKey: sender.devKey, nonce: req.nonce });
      const receipt = this.receipts.append({ decision: 'allow', reason: null, request: req, settlement: settled });
      return `tip ${amount} USAT ${sender.wallet.slice(0, 6)}… -> ${recv.wallet.slice(0, 6)}…${recv.handle ? ` (@${recv.handle.slice(1)})` : ''}\nreceipt ${receipt.id} · tag ${this.tag}${settled.txHash ? `\ntx ${settled.txHash}` : ''}${settled.source ? `\nrail ${settled.source}` : ''}`;
    }

    // Self-custody (primary): hand the sender an unsigned EIP-3009 auth to sign in their wallet.
    const { typedData } = await this.settlement.offlineAuth({ amountMicro: amt, payTo: recv.wallet, from: sender.wallet, chainId: 42220, token: 'USAT', nonce: req.nonce });
    this.pending.set(String(ctx.chatId ?? 'local'), { req, typedData });
    return [
      `⚠ self-custody tip — sign in YOUR wallet app, then relay with /tipsign <signature>`,
      ``,
      `from:   ${sender.wallet}`,
      `to:     ${recv.wallet}`,
      `amount: ${amount} USAT · chain 42220`,
      `token:  Tether America USD (${this.settlement.usatAddress || 'USAT'})`,
      ``,
      `Signed auth (EIP-3009):`,
      `type   TransferWithAuthorization`,
      `notice valid 1h — sign the message your wallet shows and paste the 0x… signature back.`,
    ].join('\n');
  }

  async tipSign(ctx, rest) {
    const [signature] = rest;
    const key = String(ctx.chatId ?? 'local');
    const pend = this.pending.get(key);
    if (!pend) return 'no pending self-custody tip — run /tip <amount> <user> first';
    if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return 'usage: /tipsign <0x…signature> — the signature /tip asked you to produce';

    const { req, typedData } = pend;
    let signer;
    try {
      signer = (await recoverTypedDataAddress({
        address: typedData.message.from, domain: typedData.domain,
        types: typedData.types, primaryType: typedData.primaryType, message: typedData.message, signature,
      })).toLowerCase();
    } catch (e) { signer = null; }

    const sender = this.registry.get(key);
    if (!signer || !sender || signer !== req.from) {
      this.receipts.append({ decision: 'block', reason: 'BAD_SIGNATURE', request: req, settlement: null });
      this.pending.delete(key);
      return 'signature invalid — could not recover your wallet from it. Nothing moved.';
    }

    const verdict = await sender.engine.checkBudget({ amountMicro: req.amountMicro, payTo: req.payTo, token: 'USAT', chainId: 42220 });
    if (!verdict.allow) {
      this.receipts.append({ decision: 'block', reason: verdict.reason, request: req, settlement: null });
      this.pending.delete(key);
      return `blocked: ${verdict.reason}`;
    }

    const settled = await this.settlement.settleWithSignature({ typedData, signature });
    const receipt = this.receipts.append({ decision: 'allow', reason: null, request: { ...req, signature }, settlement: settled });
    this.pending.delete(key);
    return `tip ${fmtMicro(req.amountMicro)} USAT ${req.from.slice(0, 6)}… -> ${req.payTo.slice(0, 6)}…\nreceipt ${receipt.id} · tag ${this.tag}${settled.txHash ? `\ntx ${settled.txHash}` : ''}${settled.source ? `\nrail ${settled.source}` : ''}`;
  }

  status(ctx) {
    const u = this.registry.get(ctx.chatId ?? 'local');
    if (!u) return 'not registered. /register <0xYourUSATWallet>';
    return `registered users: ${this.registry.count()} · recipients ${this.registry.recipients().length}\nyou: ${u.wallet}`;
  }

  async rail(ctx) {
    try {
      const u = this.registry.get(ctx.chatId ?? 'local');
      const s = await railStatus({ operatorAddress: (u && u.wallet) || 'unknown', settlement: this.settlement, selfGate: this.selfGate });
      return railStatusLine(s);
    } catch (e) { return `rail check error: ${(e && e.message) || e}`; }
  }

  proof() { return JSON.stringify(this.receipts.verifyChain()); }

  receiptsText() {
    return this.receipts.all().slice(-5).map((r) =>
      `#${r.index} ${r.decision}${r.reason ? `:${r.reason}` : ''} · ${r.settlement ? (r.settlement.txHash || r.settlement.ledgerId) : '-'}`).join('\n') || '(none)';
  }
}