// Regression tests for two real bugs found during the 2026-09-12 verification
// sweep. Both are anti-drain correctness issues, so they matter more than most.
//
// BUG 1: the self-custody /tip path handed out a signing request for an
//        OVER-CAP payment. The budget was only checked at /tipsign, so the agent
//        asked a human to authorize something it should have refused outright.
//
// BUG 2: the naive fix for bug 1 (calling checkBudget at /tip) would DOUBLE-COUNT
//        the spend, because _budgetAllow RESERVES the amount on ALLOW. Hence
//        peekBudget: validate read-only, reserve nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpendPolicyEngine } from '../src/policy.js';
import { USAT, CHAIN_ID } from '../src/constants.js';
import { AuditStore } from '../src/receipts.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { UserRegistry } from '../src/users.js';
import { P2PTeleMessageHandler } from '../src/p2p.js';

const MICRO = 1_000_000n;
const REC = '0x4444444444444444444444444444444444444444';
const SEND = '0x3333333333333333333333333333333333333333';

const engineWith = (limit) => {
  const e = new SpendPolicyEngine({ operatorAddress: SEND });
  e.registerLimit(limit);
  return e;
};

// ---------- peekBudget: read-only semantics ----------

test('peekBudget: refuses over-cap WITHOUT reserving spend', async () => {
  const e = engineWith({ perTxMaxMicro: 500000n, dayCapMicro: 2000000n, totalCapMicro: 10000000n, allowAny: true });
  const over = await e.peekBudget({ amountMicro: 5000000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(over.allow, false);
  assert.equal(over.reason, 'OVER_PER_TX_CAP');
  // the refusal must not have touched the counters
  assert.equal(e.spentTotal, 0n, 'a refused peek must not reserve spend');
  assert.equal(e.spentToday, 0n);
});

test('peekBudget: an ALLOWED peek still reserves nothing (so /tipsign can reserve once)', async () => {
  const e = engineWith({ perTxMaxMicro: 500000n, dayCapMicro: 2000000n, totalCapMicro: 10000000n, allowAny: true });
  const ok = await e.peekBudget({ amountMicro: 300000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(ok.allow, true);
  assert.equal(ok.peek, true);
  assert.equal(e.spentTotal, 0n, 'peek must never reserve');

  // now the real check reserves EXACTLY once
  const real = await e.checkBudget({ amountMicro: 300000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(real.allow, true);
  assert.equal(e.spentTotal, 300000n, 'exactly one reservation');
});

test('peekBudget: repeated peeks do not accumulate (no double-count)', async () => {
  const e = engineWith({ perTxMaxMicro: 500000n, dayCapMicro: 1000000n, totalCapMicro: 10000000n, allowAny: true });
  for (let i = 0; i < 5; i++) {
    const r = await e.peekBudget({ amountMicro: 400000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
    assert.equal(r.allow, true, 'peeking the same amount repeatedly stays allowed');
  }
  assert.equal(e.spentTotal, 0n, 'peeks never accumulate');
});

test('peekBudget: enforces day and lifetime caps read-only too', async () => {
  const e = engineWith({ perTxMaxMicro: 500000n, dayCapMicro: 600000n, totalCapMicro: 10000000n, allowAny: true });
  await e.checkBudget({ amountMicro: 500000n, payTo: REC, token: USAT, chainId: CHAIN_ID }); // reserve 0.5
  const day = await e.peekBudget({ amountMicro: 300000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(day.allow, false);
  assert.equal(day.reason, 'OVER_DAY_CAP');

  const e2 = engineWith({ perTxMaxMicro: 500000n, dayCapMicro: 10000000n, totalCapMicro: 700000n, allowAny: true });
  await e2.checkBudget({ amountMicro: 500000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  const life = await e2.peekBudget({ amountMicro: 300000n, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(life.allow, false);
  assert.equal(life.reason, 'OVER_TOTAL_CAP');
});

test('peekBudget: no limit -> NO_LIMIT, read-only', async () => {
  const e = new SpendPolicyEngine({ operatorAddress: SEND });
  const r = await e.peekBudget({ amountMicro: MICRO, payTo: REC, token: USAT, chainId: CHAIN_ID });
  assert.equal(r.reason, 'NO_LIMIT');
});

// ---------- the /tip handler refuses BEFORE asking for a signature ----------

async function handlerWithLimit(limitArgs) {
  const registry = new UserRegistry();
  const receipts = new AuditStore('p2p-preflight-secret');
  const h = new P2PTeleMessageHandler({ registry, selfGate: new MockSelfGate(), settlement: new SimulatedSettlement(), receipts });
  registry.register({ chatId: 'u', wallet: SEND, handle: 'u' });
  registry.register({ chatId: 'rec', wallet: REC, handle: 'rec' });
  await h.handle(`/limit ${limitArgs}`, { chatId: 'u' });
  return { h, receipts };
}

test('tip preflight: an OVER-CAP self-custody tip is refused, never handed out for signing', async () => {
  const { h, receipts } = await handlerWithLimit('0.50 1 2');
  const out = await h.handle('/tip 5 @rec', { chatId: 'u' });
  assert.match(out, /blocked: OVER_PER_TX_CAP/, `expected a block, got: ${out}`);
  assert.doesNotMatch(out, /Sign|signature|TransferWithAuthorization/, 'must NOT return a signing request');
  // the refusal is receipted (blocks are auditable too)
  const last = receipts.all().at(-1);
  assert.equal(last.decision, 'block');
  assert.equal(last.reason, 'OVER_PER_TX_CAP');
});

test('tip preflight: an in-cap tip still returns the signing request', async () => {
  const { h } = await handlerWithLimit('0.50 1 2');
  const out = await h.handle('/tip 0.25 @rec', { chatId: 'u' });
  assert.match(out, /self-custody tip/);
  assert.match(out, /TransferWithAuthorization/);
});

test('tip preflight: repeated in-cap /tip calls do not exhaust the budget by peeking', async () => {
  const { h } = await handlerWithLimit('0.50 1 2');
  // peeking 5 times must not consume the daily cap, so a later real tip still works
  for (let i = 0; i < 5; i++) await h.handle('/tip 0.40 @rec', { chatId: 'u' });
  const sender = h.registry.get('u');
  assert.equal(sender.engine.spentTotal, 0n, 'peeks must not have reserved anything');
  // and a real reservation still fits
  const real = await sender.engine.checkBudget({ amountMicro: 400000n, payTo: REC, token: 'USAT', chainId: 42220 });
  assert.equal(real.allow, true);
});
