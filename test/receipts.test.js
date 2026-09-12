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

// ---- adversarial cases: the chain must catch each attack, not just a reason edit ----

const seeded = () => {
  const s = new AuditStore('adv-secret');
  s.append({ decision: 'allow', reason: null, request: { nonce: '1', amountMicro: '100000' }, settlement: { txHash: '0xaaa', source: 'celo-direct-tagged' } });
  s.append({ decision: 'allow', reason: null, request: { nonce: '2', amountMicro: '200000' }, settlement: { txHash: '0xbbb', source: 'celo-direct-tagged' } });
  s.append({ decision: 'block', reason: 'OVER_DAY_CAP', request: { nonce: '3', amountMicro: '900000' }, settlement: null });
  s.append({ decision: 'allow', reason: null, request: { nonce: '4', amountMicro: '300000' }, settlement: { txHash: '0xccc', source: 'celo-direct-tagged' } });
  return s;
};

test('tamper: flipping a MIDDLE record is detected (not just the first)', () => {
  const s = seeded();
  assert.equal(s.verifyChain().ok, true);
  s.chain[2] = { ...s.chain[2], decision: 'allow', reason: null }; // hide a block
  const v = s.verifyChain();
  assert.equal(v.ok, false, 'a hidden block in the middle must be caught');
});

test('tamper: DELETING a record breaks the chain (prevHash mismatch)', () => {
  const s = seeded();
  s.chain.splice(1, 1); // drop record r-1
  const v = s.verifyChain();
  assert.equal(v.ok, false, 'deletion must be detected');
  assert.equal(v.reason, 'prevHash');
});

test('tamper: REORDERING records is detected', () => {
  const s = seeded();
  const [a, b] = [s.chain[1], s.chain[2]];
  s.chain[1] = b; s.chain[2] = a;
  assert.equal(s.verifyChain().ok, false, 'reordering must be detected');
});

test('tamper: altering the SETTLEMENT fields (amount / txHash) is detected', () => {
  const s = seeded();
  s.chain[0] = { ...s.chain[0], settlement: { ...s.chain[0].settlement, txHash: '0xFABRICATED' } };
  assert.equal(s.verifyChain().ok, false, 'a rewritten txHash must be caught');
});

test('tamper: rewriting the REQUEST amount is detected', () => {
  const s = seeded();
  s.chain[3] = { ...s.chain[3], request: { ...s.chain[3].request, amountMicro: '1' } };
  assert.equal(s.verifyChain().ok, false, 'a rewritten amount must be caught');
});

test('tamper: a forged record APPENDED without the secret is detected', () => {
  const s = seeded();
  // an attacker with disk access appends a hand-made "allow" with a guessed hash
  s.chain.push({ id: 'r-4', index: 4, ts: Date.now(), decision: 'allow', reason: null, request: { nonce: 'evil' }, settlement: { txHash: '0xdead' }, prevHash: s.chain[3].hash, hash: 'deadbeef' });
  assert.equal(s.verifyChain().ok, false, 'a forged append must be caught');
});

test('tamper: a DIFFERENT secret cannot verify a chain (integrity is secret-bound)', () => {
  const s = seeded();
  const clone = new AuditStore('different-secret');
  clone.chain = s.chain.map((r) => ({ ...r }));
  assert.equal(clone.verifyChain().ok, false, 'the chain must not verify under a wrong secret');
});

test('chain: BigInt values in request/settlement do not break append or verify', () => {
  const s = new AuditStore('bigint-secret');
  // JSON.stringify throws on BigInt — the receipt body must use a replacer, or
  // both the append AND the later verify blow up.
  assert.doesNotThrow(() => s.append({ decision: 'allow', reason: null, request: { amountMicro: 100000n }, settlement: { value: 100000n } }));
  assert.equal(s.verifyChain().ok, true);
});

test('chain: ids are stable and sequential (r-0, r-1, …)', () => {
  const s = seeded();
  assert.deepEqual(s.chain.map((r) => r.id), ['r-0', 'r-1', 'r-2', 'r-3']);
  assert.equal(s.get('r-2').reason, 'OVER_DAY_CAP');
  assert.equal(s.get('r-99'), null);
});
