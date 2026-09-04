// Hermetic checks for the 2026-09-04 "wire accurately" pass:
//   1. X402FacilitatorSettlement now defaults to the on-chain-verified USAT
//      address + EIP-3009 signing domain (name "Tether America USD") instead of
//      the old guess ("USD Tether") that would revert `invalid signature`.
//   2. usatAddress is optional (defaults to USAT_ADDRESS).
//   3. railStatusLine renders honest /rail text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X402FacilitatorSettlement } from '../src/x402Celo.js';
import { USAT_ADDRESS, USAT_SIGNER_DOMAIN } from '../src/constants.js';
import { railStatusLine } from '../src/railcheck.js';

const EXEC = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('x402: usatAddress optional — defaults to verified USAT_ADDRESS', () => {
  const s = new X402FacilitatorSettlement({ apiKey: 'dummy', executorPrivateKey: EXEC });
  assert.equal(s.usatAddress.toLowerCase(), USAT_ADDRESS.toLowerCase());
});

test('x402: signing domain defaults to the on-chain-verified USAT domain (Tether America USD)', () => {
  const s = new X402FacilitatorSettlement({ apiKey: 'dummy', executorPrivateKey: EXEC });
  assert.equal(s.domain.name, 'Tether America USD');
  assert.equal(s.domain.version, '1');
  assert.equal(s.domain.chainId, 42220);
  assert.equal(s.domain.verifyingContract.toLowerCase(), USAT_ADDRESS.toLowerCase());
  assert.deepEqual({ name: s.domain.name, version: s.domain.version, chainId: s.domain.chainId, verifyingContract: s.domain.verifyingContract }, USAT_SIGNER_DOMAIN);
});

test('x402: explicit usatAddress/domainName still override the default', () => {
  const s = new X402FacilitatorSettlement({ apiKey: 'dummy', executorPrivateKey: EXEC, usatAddress: '0x1111111111111111111111111111111111111111', domainName: 'Other' });
  assert.equal(s.usatAddress, '0x1111111111111111111111111111111111111111');
  assert.equal(s.domain.name, 'Other');
});

test('rail: railStatusLine renders honest /rail text (sim/unfunded)', () => {
  const st = {
    operator: '0x73b16058d57a6337060677496d4A8e97A9554539',
    rails: {
      funding: { celo: 0, usat: 0 },
      settlement: { live: false, apiKeySet: false, executor: null },
      self: { live: false, agentId: null },
    },
  };
  const line = railStatusLine(st);
  assert.match(line, /SIM/);
  assert.match(line, /MOCK/);
  assert.match(line, /NEEDS CELO\+USAT/);
  assert.match(line, /apiKey MISSING/);
});

test('rail: railStatusLine shows READY funding + LIVE rails when all present', () => {
  const st = {
    operator: '0x73b16058d57a6337060677496d4A8e97A9554539',
    rails: {
      funding: { celo: 2.5, usat: 10 },
      settlement: { live: true, apiKeySet: true, executor: '0x73b1' },
      self: { live: true, agentId: '9813', hasHumanProof: true, isProofFresh: true },
    },
  };
  const line = railStatusLine(st);
  assert.match(line, /READY/);
  assert.match(line, /LIVE x402/);
  assert.match(line, /LIVE registry/);
  assert.match(line, /PROOF OK/);
});