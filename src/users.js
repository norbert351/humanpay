// Multi-user P2P registry — the peer layer of HumanPay.
//
// Contrast with the v1 single-operator model: there the one `OP_OPERATOR_PK`
// signed and a single executor wallet paid out of itself. Here each user funds
// their OWN Celo wallet and tips OTHER registered users through the bot. The
// bot never consolidates funds; a tip moves USAT from the SENDER's wallet to
// the RECIPIENT's wallet over the gasless x402/EIP-3009 rail.
//
// The anti-drain spine becomes per-user:
//   * each user sets their OWN bounded spend caps (per-tx / day / lifetime),
//   * the registry itself is the payTo allowlist — you can only tip REGISTERED
//     users, so money can never leave to an undeclared address,
//   * the sender (owner of the source wallet) must sign each tip, or an
//     optional DEV key bound to their own wallet auto-signs for the live demo.
import { privateKeyToAccount } from 'viem/accounts';
import { SpendPolicyEngine } from './policy.js';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export class UserRegistry {
  constructor() {
    this.byId = new Map();      // chatId -> user
    this.byWallet = new Map();  // wallet -> user
    this.byHandle = new Map();  // @handle -> user
  }

  isAddress(a) { return ADDR_RE.test(String(a)); }

  /**
   * Bind a Telegram identity to the user's own USAT wallet. Idempotent by wallet.
   * @returns the (possibly existing) user object.
   */
  register({ chatId, wallet, handle }) {
    const w = String(wallet).toLowerCase();
    if (!this.isAddress(w)) throw new Error('wallet must be a valid 0x address');
    const existing = this.byWallet.get(w);
    if (existing) return existing;

    const id = String(chatId);
    const engine = new SpendPolicyEngine({ operatorAddress: w });
    const user = {
      chatId: id,
      wallet: w,
      handle: handle ? '@' + String(handle).replace(/^@/, '').toLowerCase() : null,
      devKey: null,
      engine,
      createdAt: Date.now(),
    };
    this.byId.set(id, user);
    this.byWallet.set(w, user);
    if (user.handle && !this.byHandle.has(user.handle)) this.byHandle.set(user.handle, user);
    return user;
  }

  /** DEV seam: bind the user's OWN private key so /tip auto-signs from their wallet. */
  setDevKey(chatId, privateKey) {
    const id = String(chatId);
    const { address } = privateKeyToAccount(privateKey);
    const u = this.byId.get(id) || this.register({ chatId: id, wallet: address });
    u.devKey = privateKey;
    return u;
  }

  get(chatId) { return this.byId.get(String(chatId)) || null; }
  getByHandle(h) { return this.byHandle.get('@' + String(h).replace(/^@/, '').toLowerCase()) || null; }
  getByWallet(w) { return this.byWallet.get(String(w).toLowerCase()) || null; }

  /** Resolve a /tip target: @handle | 0x…wallet | numeric chatId. */
  resolveTarget(input) {
    const s = String(input).trim();
    if (s.startsWith('@')) return this.getByHandle(s);
    if (this.isAddress(s)) return this.getByWallet(s);
    if (/^\d+$/.test(s)) return this.byId.get(s) || null;
    return null;
  }

  /** Every registered recipient wallet = the payTo allowlist. */
  recipients() { return [...this.byWallet.keys()]; }
  count() { return this.byWallet.size; }
  all() { return [...this.byWallet.values()]; }
}