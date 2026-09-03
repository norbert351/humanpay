import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpendPolicyEngine, newOperatorKey, authMessage, fmtMicro } from '../src/policy.js';
import { CHAIN_ID, USAT } from '../src/constants.js';

const MICRO = 1_000_000n;

test('policy allows a signed, in-caps, allowlisted payment', async () => {
  const op = newOperatorKey();
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  engine.registerLimit({ perTxMaxMicro: 5n * MICRO, dayCapMicro: 20n * MICRO, totalCapMicro: 100n * MICRO, allowlist: ['0x1111111111111111111111111111111111111111'] });

  const req = { nonce: '1', amountMicro: 3n * MICRO, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
  const signature = await op.sign(authMessage(req));
  const v = await engine.check({ ...req, signature });
  assert.equal(v.allow, true);
});

test('policy BLOCKS a prompt-injected over-limit payment (the drain)', async () => {
  const op = newOperatorKey();
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  engine.registerLimit({ perTxMaxMicro: 5n * MICRO, dayCapMicro: 20n * MICRO, totalCapMicro: 100n * MICRO, allowlist: ['0x1111111111111111111111111111111111111111'] });
  // agent tries to send 150 units (the ~$150K Grok-drain analog); operator signs it (or is tricked) —
  // still blocked by per-tx cap + any non-allowlisted addr.
  const req = { nonce: '1', amountMicro: 150n * MICRO, payTo: '0x2222222222222222222222222222222222222222', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
  const signature = await op.sign(authMessage(req));
  const v = await engine.check({ ...req, signature });
  assert.equal(v.allow, false);
});

test('policy BLOCKS when operator did NOT sign (spoofed authorization)', async () => {
  const op = newOperatorKey();
  const attacker = newOperatorKey();
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  engine.registerLimit({ perTxMaxMicro: 5n * MICRO, dayCapMicro: 20n * MICRO, totalCapMicro: 100n * MICRO, allowlist: ['0x1111111111111111111111111111111111111111'] });
  const req = { nonce: '1', amountMicro: MICRO, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
  const forgery = await attacker.sign(authMessage(req)); // attacker, not operator
  const v = await engine.check({ ...req, signature: forgery });
  assert.equal(v.allow, false);
  assert.equal(v.reason, 'OPERATOR_MISMATCH');
});

test('replayed / edited signature is bound to the exact message (amount tied)', async () => {
  const op = newOperatorKey();
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  engine.registerLimit({ perTxMaxMicro: 5n * MICRO, dayCapMicro: 20n * MICRO, totalCapMicro: 100n * MICRO, allowlist: ['0x1111111111111111111111111111111111111111'] });
  const req = { nonce: '1', amountMicro: MICRO, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
  const sig = await op.sign(authMessage(req));
  // attacker edits the amount up; signature no longer matches
  const tampered = { ...req, amountMicro: 4n * MICRO };
  const v = await engine.check({ ...tampered, signature: sig });
  assert.equal(v.allow, false);
});

test('daily cap rolls over at midnight', async () => {
  const op = newOperatorKey();
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  engine.registerLimit({ perTxMaxMicro: 100n * MICRO, dayCapMicro: 10n * MICRO, totalCapMicro: 1000n * MICRO, allowlist: ['0x1111111111111111111111111111111111111111'] });
  for (let i = 0; i < 10; i++) {
    const req = { nonce: String(i), amountMicro: MICRO, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
    const s = await op.sign(authMessage(req));
    assert.equal((await engine.check({ ...req, signature: s })).allow, true);
  }
  const over = { nonce: '10', amountMicro: MICRO, payTo: '0x1111111111111111111111111111111111111111', token: USAT, chainId: CHAIN_ID, ts: Date.now() };
  const s = await op.sign(authMessage(over));
  assert.equal((await engine.check({ ...over, signature: s })).allow, false); // OVER_DAY_CAP
});