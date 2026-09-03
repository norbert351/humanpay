import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeleMessageHandler } from '../src/telegram.js';
import { SpendPolicyEngine, newOperatorKey, authMessage } from '../src/policy.js';
import { AuditStore } from '../src/receipts.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { TAG, codesIn } from '../src/attribution.js';
import { privateKeyToAccount } from 'viem/accounts';

const PAYEE = '0x1111111111111111111111111111111111111111';
const BADPEE = '0x2222222222222222222222222222222222222222';

function handler(op) {
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  return new TeleMessageHandler({
    engine,
    selfGate: new MockSelfGate(),
    settlement: new SimulatedSettlement(),
    receipts: new AuditStore('tg'),
    operatorSign: async (req) => op.sign(authMessage(req)),
    operatorAddress: op.address,
  });
}

test('telegram: /limit then /pay within bounds settles with the celo tag', async () => {
  const op = newOperatorKey();
  const h = handler(op);
  const l = await h.handle(`/limit 5 20 100 ${PAYEE}`);
  assert.match(l, /policy set/);
  const pay = await h.handle(`/pay 2 ${PAYEE} tip for data bundle`);
  assert.match(pay, /paid 2 USAT/);
  assert.match(pay, /celo_131f6e57e5b5/);
  const rec = h.receipts.all().at(-1);
  assert.equal(rec.decision, 'allow');
  assert.ok(codesIn(rec.settlement.calldata).includes(TAG));
});

test('telegram: /pay to a non-allowlisted address is blocked + block receipted', async () => {
  const op = newOperatorKey();
  const h = handler(op);
  await h.handle(`/limit 5 20 100 ${PAYEE}`);
  const out = await h.handle(`/pay 1 ${BADPEE}`);
  assert.match(out, /blocked: PAYTO_NOT_ALLOWED/);
  const rec = h.receipts.all().at(-1);
  assert.equal(rec.decision, 'block');
  assert.equal(rec.reason, 'PAYTO_NOT_ALLOWED');
});

test('telegram: over-limit drain request is blocked', async () => {
  const op = newOperatorKey();
  const h = handler(op);
  await h.handle(`/limit 5 20 100 ${PAYEE}`);
  const out = await h.handle(`/pay 999 ${PAYEE}`);
  assert.match(out, /blocked: OVER_PER_TX_CAP/);
});

test('telegram: /proof reports an intact audit chain', async () => {
  const op = newOperatorKey();
  const h = handler(op);
  await h.handle(`/limit 5 20 100 ${PAYEE}`);
  await h.handle(`/pay 2 ${PAYEE}`);
  const p = JSON.parse(await h.handle('/proof'));
  assert.equal(p.ok, true);
});