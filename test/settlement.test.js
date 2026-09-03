import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedSettlement, transferCalldata, X402Settlement } from '../src/settlement.js';
import { taggedCall, codesIn, TAG } from '../src/attribution.js';
import { USAT, CHAIN_ID } from '../src/constants.js';

test('attribution suffix carries the ASSIGNED celo tag on settlement calldata', () => {
  const calldata = transferCalldata('0x1111111111111111111111111111111111111111', 3n * 1_000_000n);
  const tagged = taggedCall(calldata);
  assert.ok(tagged.length > calldata.length, 'suffix appended');
  assert.ok(codesIn(tagged).includes(TAG), `codes ${JSON.stringify(codesIn(tagged))} should include ${TAG}`);
});

test('simulated settlement: valid handshake, tagged calldata, receiptable ledger id', async () => {
  const sim = new SimulatedSettlement();
  const p = await sim.pay({ amountMicro: 5n * 1_000_000n, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID });
  assert.ok(p.ledgerId.startsWith('sim-'));
  assert.ok(codesIn(p.calldata).includes(TAG));
  assert.ok(sim.get(p.ledgerId));
});

test('x402 settlement requires an executor key (executor never holds the seed)', () => {
  assert.throws(() => new X402Settlement({}), /requires executorPrivateKey/);
});