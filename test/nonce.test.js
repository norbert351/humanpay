// Regression test for a serious production bug found in the 2026-09-12 sweep:
// every P2P tip shared the SAME EIP-3009 nonce (all zeroes).
//
// EIP-3009 marks a nonce USED after a successful transferWithAuthorization. The
// P2P handler passes `nonce: String(Date.now())` (not bytes32), and the builder
// silently substituted 0x00…00 — so the FIRST tip worked and EVERY later tip
// reverted `TetherToken: auth invalid` (the zero nonce is already consumed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferAuthTypedData } from '../src/auth.js';
import { USAT_SIGNER_DOMAIN } from '../src/constants.js';

const A = '0x3333333333333333333333333333333333333333';
const B = '0x4444444444444444444444444444444444444444';
const ZERO32 = '0x' + '00'.repeat(32);

const build = (nonce) => transferAuthTypedData({ from: A, to: B, value: 100000n, nonce, domain: USAT_SIGNER_DOMAIN });

test('nonce: a decimal (Date.now()) nonce becomes a REAL bytes32, never all-zero', () => {
  const td = build(String(Date.now()));
  assert.match(td.message.nonce, /^0x[0-9a-f]{64}$/, 'must be a bytes32 hex string');
  assert.notEqual(td.message.nonce, ZERO32, 'must never be the consumed zero nonce');
});

test('nonce: two calls with the SAME input still produce DIFFERENT nonces', () => {
  // This is the crux — a repeated nonce makes the second transfer revert.
  const a = build('1736000000000');
  const b = build('1736000000000');
  assert.notEqual(a.message.nonce, b.message.nonce, 'nonce must be unique per authorization');
});

test('nonce: many calls produce many distinct nonces (no collisions)', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(build('same-seed-value').message.nonce);
  assert.equal(seen.size, 200, 'every authorization must get a unique nonce');
});

test('nonce: a caller-supplied valid bytes32 is respected verbatim', () => {
  const explicit = '0x' + 'ab'.repeat(32);
  assert.equal(build(explicit).message.nonce, explicit);
});

test('nonce: undefined/missing nonce also yields a real bytes32 (not zero)', () => {
  for (const n of [undefined, null, '']) {
    const td = build(n);
    assert.match(td.message.nonce, /^0x[0-9a-f]{64}$/);
    assert.notEqual(td.message.nonce, ZERO32);
  }
});

test('nonce: a non-64-hex 0x string is NOT passed through raw', () => {
  // e.g. a short or malformed hex value must be replaced, not submitted as-is
  const td = build('0xdeadbeef');
  assert.notEqual(td.message.nonce, '0xdeadbeef');
  assert.match(td.message.nonce, /^0x[0-9a-f]{64}$/);
});

test('nonce: the typed-data still signs and recovers to the payer', async () => {
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const { recoverTypedDataAddress } = await import('viem');
  const acct = privateKeyToAccount(generatePrivateKey());
  const td = transferAuthTypedData({ from: acct.address, to: B, value: 100000n, nonce: String(Date.now()), domain: USAT_SIGNER_DOMAIN });
  const sig = await acct.signTypedData(td);
  const recovered = await recoverTypedDataAddress({ ...td, signature: sig });
  assert.equal(recovered.toLowerCase(), acct.address.toLowerCase(), 'a real signature still recovers (nonce fix must not break signing)');
});
