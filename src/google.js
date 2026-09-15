// Google Sign-In — verify a Google ID token WITHOUT a client secret.
//
// Google Identity Services (GIS) returns a signed JWT (ID token) to the browser
// after the popup/One Tap. The server verifies it against Google's PUBLIC JWKS
// (https://www.googleapis.com/oauth2/v3/certs) — public keys require no secret.
// This is the standard "Sign in with Google" flow for a public web client.
import { createPublicKey, createVerify } from 'node:crypto';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Decode the JWT header + payload (no verification) to inspect claims. */
export function decodeJwtParts(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed JWT: expected header.payload.signature');
  const [h, p] = parts.slice(0, 2).map((seg) => JSON.parse(b64url(seg).toString('utf8')));
  return { header: h, payload: p, signature: parts[2] };
}

/**
 * Verify a Google ID token against Google's public keys.
 * @param {{ token: string, clientId: string, jwks?: object, now?: number, fetchImpl?: Function }} opts
 * @returns {{ sub, email, email_verified, name, picture, auth_time, iat, exp, aud, iss }}
 */
export async function verifyGoogleIdToken({ token, clientId, jwks = null, now = () => Math.floor(Date.now() / 1000), fetchImpl = globalThis.fetch, jwksUrl = GOOGLE_JWKS_URL }) {
  if (!token || !clientId) throw new Error('token and clientId required');
  const { header, payload, signature } = decodeJwtParts(token);

  // 1. aud must be OUR client id — a token minted for another app must not work.
  if (payload.aud !== clientId) throw new Error(`INVALID_AUDIENCE: ${payload.aud}`);
  // 2. iss must be Google.
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw new Error(`INVALID_ISSUER: ${payload.iss}`);
  // 3. not before / expiry.
  if (typeof payload.exp === 'number' && now() > payload.exp) throw new Error('EXPIRED_TOKEN');
  if (typeof payload.iat === 'number' && payload.iat > now() + 300) throw new Error('INVALID_IAT');

  // Fetch Google's current JWKS (cache-able; fall back to any passed-in keys).
  let keys = jwks && jwks.keys ? jwks.keys : null;
  if (!keys) {
    const r = await fetchImpl(jwksUrl);
    const j = await r.json();
    keys = Array.isArray(j.keys) ? j.keys : [];
  }

  // 4. Find the key by `kid` in the JWT header and verify the RS256 signature.
  const kid = header.kid;
  const key = keys.find((k) => k.kid === kid && k.kty === 'RSA' && k.alg === 'RS256');
  if (!key) throw new Error(`NO_MATCHING_KEY kid=${kid}`);
  const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256' }, format: 'jwk' });
  const signed = `${token.split('.')[0]}.${token.split('.')[1]}`;
  const ok = createVerify('RSA-SHA256').update(signed, 'utf8').verify(publicKey, Buffer.from(signature, 'base64url'));
  if (!ok) throw new Error('BAD_SIGNATURE');

  return {
    sub: payload.sub,
    email: payload.email || null,
    email_verified: payload.email_verified === true,
    name: payload.name || null,
    picture: payload.picture || null,
    aud: payload.aud,
    iss: payload.iss,
    auth_time: payload.auth_time,
    iat: payload.iat,
    exp: payload.exp,
  };
}