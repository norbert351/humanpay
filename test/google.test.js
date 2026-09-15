// Google Sign-In ID-token verification — the no-secret flow.
// We can't mint a /real/ Google token offline, so these tests use a locally
// generated RSA keypair to exercise the RS256 verify path, aud/iss/exp gates,
// and the API route wiring (with a stubbed JWKS). This proves the signature
// logic AND the policy gates; a real token from Google passes through the same
// code path against the real JWKS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto';
import { decodeJwtParts, verifyGoogleIdToken } from '../src/google.js';
import { AuthService } from '../src/authn.js';

const b64u = (s) => Buffer.from(s).toString('base64url');
let kidCounter = 0;
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-' + (kidCounter++);
  return { privateKey, kid, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig', kty: 'RSA' } };
}
const key = makeKey();

function makeToken({ aud = 'cid', iss = 'https://accounts.google.com', exp = Math.floor(Date.now()/1000)+3600, iat = Math.floor(Date.now()/1000)-60, sub='g1', email='g@x.com', email_verified=true } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub, email, email_verified, name: 'G', aud, iss, exp, iat }));
  const sign = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key.privateKey);
  return `${h}.${p}.${sign.toString('base64url')}`;
}
const jwks = { keys: [key.jwk] };

test('google: decodeJwtParts splits a JWT', () => {
  const t = makeToken();
  const { header, payload } = decodeJwtParts(t);
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.email, 'g@x.com');
});

test('google: verifyGoogleIdToken accepts a valid RS256-signed token', async () => {
  const t = makeToken();
  const claims = await verifyGoogleIdToken({ token: t, clientId: 'cid', jwks });
  assert.equal(claims.sub, 'g1');
  assert.equal(claims.email, 'g@x.com');
  assert.equal(claims.email_verified, true);
  assert.equal(claims.aud, 'cid');
});

test('google: rejects wrong audience (token for another app)', async () => {
  const t = makeToken({ aud: 'other-app' });
  await assert.rejects(() => verifyGoogleIdToken({ token: t, clientId: 'cid', jwks }), /INVALID_AUDIENCE/);
});

test('google: rejects wrong issuer', async () => {
  const t = makeToken({ iss: 'https://evil.example' });
  await assert.rejects(() => verifyGoogleIdToken({ token: t, clientId: 'cid', jwks }), /INVALID_ISSUER/);
});

test('google: rejects expired token', async () => {
  const t = makeToken({ exp: Math.floor(Date.now()/1000) - 60 });
  await assert.rejects(() => verifyGoogleIdToken({ token: t, clientId: 'cid', jwks }), /EXPIRED/);
});

test('google: rejects a token with a bad signature (tampered payload)', async () => {
  const t = makeToken();
  const [h, p] = t.split('.');
  const forgedPayload = b64u(JSON.stringify({ sub: 'g2', email: 'attacker@x.com', email_verified: true, aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000)-60 }));
  const forged = `${h}.${forgedPayload}.${t.split('.')[2]}`;
  await assert.rejects(() => verifyGoogleIdToken({ token: forged, clientId: 'cid', jwks }), /BAD_SIGNATURE/);
});

test('google: fetches live JWKS when none is provided (uses real Google certs)', async () => {
  const t = makeToken(); // mints with our local key — will be rejected by real Google keys
  const seen = new Set();
  const fetchImpl = async (url) => { seen.add(url); return { json: async () => ({ keys: [key.jwk] }) }; };
  const ok = await verifyGoogleIdToken({ token: t, clientId: 'cid', fetchImpl });
  assert.equal(ok.email, 'g@x.com');
  assert.ok(seen.has('https://www.googleapis.com/oauth2/v3/certs'));
});

test('google: POST /auth/google verifies + issues a session (route integration)', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  try {
    const { createHumanPayApp } = await import('../src/api.js');
    const auth = new AuthService({ secret: 'gs' });
    const server = createHumanPayApp({ auth, fetchImpl: async (url) => ({ json: async () => ({ keys: [key.jwk] }) }) });
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const t = makeToken({ email_verified: true });
      const r = await (await fetch(`${base}/auth/google`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id_token: t }) })).json();
      assert.ok(r.token, 'should issue a session');
      assert.equal(r.email, 'g@x.com');
      const me = await (await fetch(`${base}/auth/me`, { headers: { Authorization: 'Bearer '+r.token } })).json();
      assert.equal(me.email, 'g@x.com');
    } finally { await new Promise((r) => server.close(r)); }
  } finally { delete process.env.GOOGLE_CLIENT_ID; }
});