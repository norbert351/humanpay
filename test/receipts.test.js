import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditStore } from '../src/receipts.js';

test('receipt chain is tamper-evident: edits are detected', () => {
  const store = new AuditStore('test-secret');
  store.append({ decision: 'allow', reason: null, request: { nonce: '1' }, settlement: { txHash: '0x1' } });
  store.append({ decision: 'block', reason: 'OVER_PER_TX_CAP', request: { nonce: '2' }, settlement: null });
  const v = store.verifyChain();
  assert.equal(v.ok, true, JSON.stringify(v));

  // try to silently edit an earlier receipt's reason in place
  const r0 = store.chain[0];
  store.chain[0] = { ...r0, reason: 'FABRICATED-ALLOW' };
  const v2 = store.verifyChain();
  assert.equal(v2.ok, false, 'tamper must be detected');
});

test('receipt lookup by id and full listing', () => {
  const store = new AuditStore();
  const a = store.append({ decision: 'allow', reason: null, request: {}, settlement: {} });
  const b = store.append({ decision: 'block', reason: 'PAYTO_NOT_ALLOWED', request: {}, settlement: null });
  assert.equal(store.get(a.id).id, a.id);
  assert.equal(store.all().length, 2);
  assert.equal(store.get(b.id).decision, 'block');
});