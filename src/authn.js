// Auth — how a human proves who they are before touching a HumanPay lab.
//
// Three real paths, no external SaaS required to run:
//   1. Email + password — scrypt (salted, constant-time compare), never stored raw.
//   2. OAuth 2.0 social login (Google / GitHub) — a REAL authorization-code flow
//      that activates the moment GOOGLE_CLIENT_ID/SECRET (or GITHUB_*) are set;
//      until then the routes report `configured:false` honestly (like the FX rail).
//   3. Session tokens — HMAC-SHA256 signed, expiring, stateless (no session store
//      needed), verified on every request.
//
// This is deliberately separate from the WALLET (self-custody) identity: auth
// says WHO is signing in to the app; the wallet says WHICH keys move money.
import { scryptSync, randomBytes, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** Hash a password with a per-account salt: `scrypt$N$salt$hash` (all hex). */
export function hashPassword(password, { N = 16384, salt = randomBytes(16) } = {}) {
  const dk = scryptSync(String(password), salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

/** Constant-time password check. Never throws on malformed hashes. */
export function verifyPassword(password, stored) {
  try {
    const [scheme, N, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const dk = scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, { N: Number(N), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const want = Buffer.from(hashHex, 'hex');
    return dk.length === want.length && timingSafeEqual(dk, want);
  } catch { return false; }
}

/** OAuth providers — endpoints only; activated when client creds are supplied. */
export const OAUTH_PROVIDERS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    idEnv: 'GOOGLE_CLIENT_ID', secretEnv: 'GOOGLE_CLIENT_SECRET',
    parse: (u) => ({ id: u.sub, email: u.email, name: u.name }),
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    idEnv: 'GITHUB_CLIENT_ID', secretEnv: 'GITHUB_CLIENT_SECRET',
    parse: (u) => ({ id: String(u.id), email: u.email, name: u.name || u.login }),
  },
};

export class AuthService {
  /** @param {{ secret?: string, sessionTtlSec?: number, fetchImpl?: Function, now?: () => number, db?: object }} opts */
  constructor({ secret = process.env.AUTH_SECRET || 'humanpay-dev-secret', sessionTtlSec = 60 * 60 * 24 * 7, fetchImpl = globalThis.fetch, now = () => Date.now(), db = null } = {}) {
    this.secret = secret;
    this.sessionTtlSec = sessionTtlSec;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.db = db;                          // optional sqlite handle (persistent accounts)
    this.accounts = new Map();             // email(lower) -> {id, email, passwordHash, provider, createdAt}
    this.byId = new Map();                 // id -> account
    if (db) this._init();
  }

  _init() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, provider TEXT, created_at INTEGER)`);
    for (const r of this.db.prepare('SELECT * FROM accounts').all()) {
      const a = { id: r.id, email: r.email, passwordHash: r.password_hash, provider: r.provider, createdAt: r.created_at };
      this.accounts.set(a.email, a); this.byId.set(a.id, a);
    }
  }
  _persist(a) {
    if (!this.db) return;
    this.db.prepare('INSERT OR REPLACE INTO accounts (id,email,password_hash,provider,created_at) VALUES (?,?,?,?,?)')
      .run(a.id, a.email, a.passwordHash, a.provider, a.createdAt);
  }

  // ---- Email + password ------------------------------------------------
  registerEmail({ email, password }) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('invalid email');
    if (String(password || '').length < 8) throw new Error('password must be at least 8 chars');
    if (this.accounts.has(e)) throw new Error('email already registered');
    const a = { id: 'acct_' + randomUUID().slice(0, 8), email: e, passwordHash: hashPassword(password), provider: 'password', createdAt: this.now() };
    this.accounts.set(e, a); this.byId.set(a.id, a); this._persist(a);
    return { id: a.id, email: a.email };
  }

  loginEmail({ email, password }) {
    const a = this.accounts.get(String(email || '').trim().toLowerCase());
    if (!a || a.provider !== 'password' || !verifyPassword(password, a.passwordHash)) return null;
    return { id: a.id, email: a.email };
  }

  // ---- OAuth 2.0 (social) ---------------------------------------------
  providerConfig(name) {
    const p = OAUTH_PROVIDERS[name];
    if (!p) throw new Error('unknown provider');
    const clientId = process.env[p.idEnv];
    const clientSecret = process.env[p.secretEnv];
    // The AUTHORIZE step needs only the (public) client id — so the button can go
    // live as soon as it's set. The EXCHANGE step additionally needs the secret
    // for a confidential web client; both are reported so the UI never lies.
    return { ...p, name, clientId, clientSecret, secretConfigured: Boolean(clientSecret), configured: Boolean(clientId) };
  }

  /**
   * Build the provider authorize URL. Supports PKCE (S256): pass `codeChallenge`
   * from the client so a public/installed client can complete without a secret.
   * `state` is an HMAC — verified on the callback, no server session needed.
   */
  oauthAuthorizeUrl({ provider, redirectUri, codeChallenge, codeChallengeMethod = 'S256' }) {
    const cfg = this.providerConfig(provider);
    if (!cfg.configured) return { configured: false, provider, envNeeded: [cfg.idEnv] };
    const state = this.sign({ p: provider, r: redirectUri, n: randomBytes(8).toString('hex'), t: this.now() });
    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', cfg.scope);
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', codeChallengeMethod);
    }
    return { configured: true, provider, url: url.toString(), state, secretConfigured: cfg.secretConfigured, pkce: Boolean(codeChallenge) };
  }

  /** Exchange the auth code for a profile and upsert the account. */
  async oauthExchange({ provider, code, redirectUri, state, codeVerifier }) {
    const cfg = this.providerConfig(provider);
    if (!cfg.configured) throw new Error(`${provider} OAuth not configured`);
    if (state) { const d = this.verify(state); if (!d || d.p !== provider) throw new Error('bad oauth state'); }
    const body = new URLSearchParams({ client_id: cfg.clientId, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
    if (codeVerifier) body.set('code_verifier', codeVerifier);
    const tr = await this.fetchImpl(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    const tj = await tr.json().catch(() => ({}));
    const accessToken = tj.access_token;
    if (!accessToken) throw new Error(`oauth token exchange failed: ${tj.error || tj.error_description || tr.status}`);
    const ur = await this.fetchImpl(cfg.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'HumanPay' } });
    const uj = await ur.json();
    const prof = cfg.parse(uj);
    if (!prof.id) throw new Error('oauth profile missing id');
    const e = String(prof.email || `${provider}_${prof.id}@noemail.local`).toLowerCase();
    let a = this.accounts.get(e);
    if (!a) {
      a = { id: 'acct_' + randomUUID().slice(0, 8), email: e, passwordHash: null, provider, createdAt: this.now(), name: prof.name || null };
      this.accounts.set(e, a); this.byId.set(a.id, a); this._persist(a);
    }
    return { id: a.id, email: a.email, provider, name: prof.name || null };
  }

  // ---- Session tokens (stateless, HMAC-signed) -------------------------
  sign(payload) {
    const body = b64u(JSON.stringify(payload));
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  verify(token) {
    try {
      const [body, sig] = String(token).split('.');
      if (!body || !sig) return null;
      const want = createHmac('sha256', this.secret).update(body).digest('base64url');
      const a = Buffer.from(sig), b = Buffer.from(want);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const d = JSON.parse(fromB64u(body).toString('utf8'));
      if (d.exp && this.now() > d.exp) return null;
      return d;
    } catch { return null; }
  }
  issueSession(account) {
    return this.sign({ sub: account.id, email: account.email, iat: this.now(), exp: this.now() + this.sessionTtlSec * 1000 });
  }
  /** Verify a Bearer token → account (for gating routes). */
  authenticate(authHeader) {
    const raw = String(authHeader || '').startsWith('Bearer ') ? String(authHeader).slice(7) : null;
    if (!raw) return null;
    const d = this.verify(raw);
    if (!d || !d.sub) return null;
    return this.byId.get(d.sub) || { id: d.sub, email: d.email };
  }
}
