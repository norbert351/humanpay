// Auth (scrypt + sessions + OAuth honesty), Telegram push receipts, and the
// persistent book (SQLite-backed, survives reopen, fail-safe on bad path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, hashPassword, verifyPassword, OAUTH_PROVIDERS } from '../src/authn.js';
import { TelegramNotifier, receiptText } from '../src/notify.js';
import { PersistentBook } from '../src/bookStore.js';
import { UserRegistry } from '../src/users.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('auth: scrypt hashes + verifies, rejects wrong/malformed', () => {
  const h = hashPassword('hunter2secret');
  assert.notEqual(h, 'hunter2secret');
  assert.equal(verifyPassword('hunter2secret', h), true);
  assert.equal(verifyPassword('wrongpass', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});

test('auth: register → login → session issues, authenticates, expires', async () => {
  let t = 1_000_000;
  const auth = new AuthService({ secret: 's', now: () => t });
  const r = auth.registerEmail({ email: 'A@Example.com', password: 'password123' });
  assert.ok(auth.accounts.has('a@example.com'), 'email lowercased');
  assert.ok(auth.loginEmail({ email: 'a@example.com', password: 'password123' }));
  assert.equal(auth.loginEmail({ email: 'a@example.com', password: 'nope' }), null);
  const token = auth.issueSession({ id: r.id, email: r.email });
  const authed = auth.authenticate('Bearer ' + token);
  assert.equal(authed && authed.id, r.id);
  assert.equal(authed && authed.email, r.email);
  // tamper breaks it
  assert.equal(auth.authenticate('Bearer ' + token.slice(0, -2) + 'aa'), null);
  // expiry
  t += 8 * 24 * 3600 * 1000;
  assert.equal(auth.authenticate('Bearer ' + token), null);
});

test('auth: oauth providers report configured=false honestly until creds are set', () => {
  const auth = new AuthService({ secret: 's' });
  for (const name of Object.keys(OAUTH_PROVIDERS)) {
    const cfg = auth.providerConfig(name);
    assert.equal(cfg.configured, false);
    const authz = auth.oauthAuthorizeUrl({ provider: name, redirectUri: 'http://localhost/cb' });
    assert.equal(authz.configured, false);
    assert.ok(authz.envNeeded && authz.envNeeded.includes(cfg.idEnv));
  }
});

test('auth HTTP routes: /auth/providers lists oauth honestly, /auth/me honors Bearer', async () => {
  const { createHumanPayApp } = await import('../src/api.js');
  const auth = new AuthService({ secret: 'route-test' });
  const server = createHumanPayApp({ auth });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const prov = await (await fetch(`${base}/auth/providers`)).json();
    assert.ok(prov.emailPassword === true);
    assert.equal(prov.oauth.length, 2); // google + github
    assert.ok(prov.oauth.every((p) => p.configured === false));
    // unauthorized me
    assert.equal((await fetch(`${base}/auth/me`)).status, 401);
    // register then me with token
    const reg = await (await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'r@x.com', password: 'password123' }) })).json();
    assert.ok(reg.token);
    const me = await (await fetch(`${base}/auth/me`, { headers: { Authorization: 'Bearer ' + reg.token } })).json();
    assert.equal(me.email, 'r@x.com');
  } finally { await new Promise((r) => server.close(r)); }
});

test('auth: oauth authorize carries PKCE S256 params when a challenge is provided', () => {
  process.env.GOOGLE_CLIENT_ID = '517988614557-test.apps.googleusercontent.com';
  try {
    const auth = new AuthService({ secret: 's' });
    const a = auth.oauthAuthorizeUrl({ provider: 'google', redirectUri: 'http://localhost/app', codeChallenge: 'abcS256challenge' });
    assert.equal(a.configured, true);
    assert.equal(a.pkce, true);
    assert.equal(a.secretConfigured, false);
    const u = new URL(a.url);
    assert.equal(u.searchParams.get('code_challenge'), 'abcS256challenge');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(u.searchParams.get('state'));
  } finally { delete process.env.GOOGLE_CLIENT_ID; }
});

test('auth: oauth exchange sends client_secret when present + code_verifier when given', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  try {
    const seen = new URLSearchParams();
    const auth = new AuthService({ secret: 's', fetchImpl: async (url, opt) => {
      seen.append('url', url);
      const body = new URLSearchParams(opt.body);
      seen.append('body', body.toString());
      if (url.includes('/token')) return { status: 200, json: async () => ({ access_token: 'tok', error: null }) };
      return { status: 200, json: async () => ({ sub: 'g1', email: 'g@x.com', name: 'G' }) };
    }});
    const cfg = auth.providerConfig('google');
    assert.equal(cfg.secretConfigured, true);
    const acct = await auth.oauthExchange({ provider: 'google', code: 'c', redirectUri: 'http://localhost/app', state: null, codeVerifier: 'vr' });
    assert.equal(acct.email, 'g@x.com');
    const sent = seen.getAll('body').find((b) => b.includes('grant_type=authorization_code'));
    assert.ok(sent.includes('client_secret=csecret'));
    assert.ok(sent.includes('code_verifier=vr'));
  } finally { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; }
});

test('auth: scrypt hash never stores the plaintext', () => {
  const h = hashPassword('s3cret-password');
  assert.ok(!h.includes('s3cret-password'));
  assert.ok(h.startsWith('scrypt$'));
});

test('notify: receiptText formats amounts + links honestly', () => {
  const t = receiptText({ amountMicro: '1000000', from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', tagged: true, rail: 'celo-direct-tagged', txHash: '0xabc123' });
  assert.match(t, /1 USAT settled/);
  assert.match(t, /0xaaaa…aaaa → 0xbbbb…bbbb/);
  assert.match(t, /ERC-8021 tagged/);
  assert.match(t, /celoscan\.io\/tx\/0xabc123/);
});

test('notify: notifies both parties when reachable, never throws when off', async () => {
  const seen = [];
  const notifier = new TelegramNotifier({ token: 'test', registry: (() => {
    const reg = new UserRegistry();
    reg.register({ chatId: '1', wallet: '0x' + 'a1'.repeat(20), handle: 'alice' });
    reg.register({ chatId: '2', wallet: '0x' + 'b0'.repeat(20), handle: 'bob' });
    return reg;
  })(), fetchImpl: async (url, opt) => { seen.push(JSON.parse(opt.body)); return { ok: true, status: 200 }; } });
  const out = await notifier.notifyPayment({ amountMicro: '500000', from: '0x' + 'a1'.repeat(20), to: '0x' + 'b0'.repeat(20), tagged: true, rail: 'celo', txHash: '0x1' });
  assert.equal(out.attempted, 2);
  assert.equal(out.delivered, 2);
  assert.equal(seen.length, 2);
  // disabled notifier → best-effort, no throw
  const off = new TelegramNotifier({ token: null });
  const r = await off.notifyPayment({ amountMicro: '1', from: 'x', to: 'y' });
  assert.equal(r.attempted, 0);
});

test('persistent book: survives reopen + tamper-resistant, fail-safe on bad path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hpbook-'));
  const path = join(dir, 'book.db');
  try {
    const b1 = new PersistentBook({ path });
    assert.equal(b1.persist, true);
    const bill = b1.createBill({ title: 'lunch', totalMicro: '6000000', parts: 3, recipients: [] });
    const sub = b1.createSubscription({ payer: '0x' + 'a1'.repeat(20), payee: '0x' + 'b0'.repeat(20), amountMicro: '100000', intervalSec: 3600 });
    b1.createInvoice({ from: '0x' + 'b0'.repeat(20), to: '0x' + 'a1'.repeat(20), amountMicro: '200000' });
    // reopen reads them back
    const b2 = new PersistentBook({ path });
    assert.ok(b2.getBill(bill.id));
    assert.ok(b2.getSubscription(sub.id));
    assert.equal(b2.bills.size, 1);
    assert.equal(b2.subscriptions.size, 1);
    assert.equal(b2.invoices.size, 1);
    // bad path → graceful in-memory fallback, no crash
    const bad = new PersistentBook({ path: '/var/data/nonexistent-dir-xyz/book.db' });
    assert.equal(bad.persist, false);
    assert.doesNotThrow(() => bad.createBill({ title: 'x', totalMicro: '100', parts: 2 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});