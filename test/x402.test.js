// Hermetic checks for the Celo x402 facilitator client (2026-09 "wire accurately"
// + 2026-09-12 real-settlement pass):
//   1. USAT address + EIP-3009 signing domain default to the on-chain-verified
//      values (name "Tether America USD") — the old "USD Tether" guess reverts.
//   2. usatAddress is optional.
//   3. toAtomic keeps micro-units AS atomic (no 1e6 double-scaling).
//   4. buildPaymentPayload emits the x402 v2 shape the facilitator accepts
//      (nested accepted.scheme + sibling paymentRequirements) — the flat shape
//      was rejected with `unsupported_scheme`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X402FacilitatorSettlement } from '../src/x402Celo.js';
import { USAT_ADDRESS, USAT_SIGNER_DOMAIN } from '../src/constants.js';

const EXEC = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KEY = 'x402_test_key';
const s = (opts = {}) => new X402FacilitatorSettlement({ apiKey: KEY, executorPrivateKey: EXEC, ...opts });

test('x402: usatAddress optional — defaults to verified USAT_ADDRESS', () => {
  assert.equal(s().usatAddress.toLowerCase(), USAT_ADDRESS.toLowerCase());
});

test('x402: signing domain defaults to the on-chain-verified USAT domain (Tether America USD)', () => {
  const c = s();
  assert.equal(c.domain.name, 'Tether America USD');
  assert.equal(c.domain.version, '1');
  assert.equal(c.domain.chainId, 42220);
  assert.equal(c.domain.verifyingContract.toLowerCase(), USAT_ADDRESS.toLowerCase());
  assert.deepEqual(
    { name: c.domain.name, version: c.domain.version, chainId: c.domain.chainId, verifyingContract: c.domain.verifyingContract },
    USAT_SIGNER_DOMAIN,
  );
});

test('x402: explicit usatAddress/domainName still override the default', () => {
  const c = s({ usatAddress: '0x1111111111111111111111111111111111111111', domainName: 'Other' });
  assert.equal(c.usatAddress, '0x1111111111111111111111111111111111111111');
  assert.equal(c.domain.name, 'Other');
});

test('x402: toAtomic keeps micro-units as atomic (1 micro = 1 atomic for 6dp USAT)', () => {
  const c = s();
  // amountMicro is ALREADY atomic: 3_000_000 micro = 3 USAT = 3_000_000 atomic.
  // The old implementation multiplied by 1e6 again, inflating every real
  // settlement 1,000,000x and surfacing as `insufficient_funds` from the
  // facilitator (not as an obvious unit error).
  assert.equal(c.toAtomic(3_000_000n), 3_000_000n);
  assert.equal(c.toAtomic(100000n), 100000n); // 0.10 USAT
});

test('x402: payment checks require a valid apiKey + executor key', () => {
  assert.throws(() => new X402FacilitatorSettlement({ executorPrivateKey: EXEC }), /requires apiKey/);
  assert.throws(() => new X402FacilitatorSettlement({ apiKey: KEY }), /requires executorPrivateKey/);
});

test('x402: buildPaymentPayload emits the x402 v2 shape (nested accepted + paymentRequirements)', async () => {
  const c = s();
  const payTo = '0x9999999999999999999999999999999999999999';
  const { typedData, signature } = await c.signTransferAuthorization({
    amountMicro: 100000n, payTo, nonce: '0x' + '11'.repeat(32),
  });
  const body = c.buildPaymentPayload({ typedData, signature, payTo, amountMicro: 100000n });

  assert.equal(body.x402Version, 2);
  // the scheme MUST sit at paymentPayload.accepted.scheme — a flat payload is rejected
  assert.equal(body.paymentPayload.accepted.scheme, 'exact');
  assert.equal(body.paymentPayload.accepted.network, 'eip155:42220');
  assert.equal(body.paymentPayload.accepted.asset.toLowerCase(), USAT_ADDRESS.toLowerCase());
  assert.equal(body.paymentPayload.accepted.amount, '100000', '0.10 USAT stays 100000 atomic');
  assert.equal(body.paymentPayload.accepted.extra.name, 'Tether America USD');
  assert.equal(body.paymentPayload.accepted.extra.assetTransferMethod, 'eip3009');
  // signature + authorization reconstructed from the signed typed-data
  assert.equal(body.paymentPayload.payload.signature, signature);
  assert.equal(body.paymentPayload.payload.authorization.value, '100000');
  assert.equal(body.paymentPayload.payload.authorization.nonce, '0x' + '11'.repeat(32));
  // the sibling paymentRequirements block is REQUIRED by /settle and /verify
  assert.equal(body.paymentRequirements.scheme, 'exact');
  assert.equal(body.paymentRequirements.amount, '100000');
  // no BigInt leaks (JSON.stringify must not throw on the body)
  assert.doesNotThrow(() => JSON.stringify(body));
});
