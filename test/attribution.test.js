// /attribution — judge-facing proof that settlements carry the ASSIGNED ERC-8021
// tag. The leaderboard counts only tagged txs, and a facilitator-relayed x402
// settlement CANNOT carry a data suffix (the facilitator builds the calldata),
// so this endpoint must report tagged vs untagged per settlement rather than
// implying every rail is credited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHumanPayApp } from '../src/api.js';
import { SpendPolicyEngine, newOperatorKey } from '../src/policy.js';
import { AuditStore } from '../src/receipts.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { ATTRIBUTION_TAG, VERIFIED_TAGGED_SETTLEMENTS } from '../src/constants.js';
import { TAG, codesIn, taggedCall } from '../src/attribution.js';

async function withServer(fn) {
  const op = newOperatorKey();
  const receipts = new AuditStore('attr-secret');
  const app = createHumanPayApp({
    engine: new SpendPolicyEngine({ operatorAddress: op.address }),
    receipts, settlement: new SimulatedSettlement(), selfGate: new MockSelfGate(),
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, receipts); } finally { server.closeAllConnections?.(); server.close(); }
}

test('attribution: assigned tag is exported and matches the on-chain tag constant', () => {
  assert.equal(TAG, ATTRIBUTION_TAG);
  assert.match(TAG, /^celo_[0-9a-f]{12}$/);
});

test('attribution: the tag survives a tagged calldata round-trip', () => {
  // codesIn must decode the assigned tag out of real calldata — the same check
  // the leaderboard performs.
  const calldata = taggedCall('0xe3ee160e' + '00'.repeat(64));
  assert.ok(codesIn(calldata).includes(TAG), 'tag decodes back out of the calldata');
});

test('attribution: /attribution reports tagged vs relayed settlements honestly', async () => {
  await withServer(async (base, receipts) => {
    // one TAGGED settlement (we broadcast it ourselves) and one relayed (facilitator did)
    receipts.append({ decision: 'allow', reason: null, request: { amountMicro: '100000', payTo: '0xaa' },
      settlement: { source: 'celo-direct-tagged', txHash: '0x1111', tag: TAG, amountMicro: '100000', payTo: '0xaa' } });
    receipts.append({ decision: 'allow', reason: null, request: { amountMicro: '200000', payTo: '0xbb' },
      settlement: { source: 'x402-facilitator', txHash: '0x2222', tag: TAG, amountMicro: '200000', payTo: '0xbb' } });

    const body = await (await fetch(`${base}/attribution`)).json();
    assert.equal(body.assignedTag, ATTRIBUTION_TAG);
    // the two live txs PLUS every verified on-chain seed (all tagged by construction)
    assert.equal(body.settlements.length, 2 + VERIFIED_TAGGED_SETTLEMENTS.length);
    assert.equal(body.taggedCount, 1 + VERIFIED_TAGGED_SETTLEMENTS.length,
      'only the direct-tagged live settlement + all verified seed count as tagged');
    const tagged = body.settlements.find((s) => s.txHash === '0x1111');
    const relayed = body.settlements.find((s) => s.txHash === '0x2222');
    assert.equal(tagged.tagged, true);
    assert.equal(relayed.tagged, false, 'a facilitator relay cannot carry a data suffix');
    assert.match(tagged.explorer, /celoscan\.io\/tx\/0x1111/);
  });
});

test('attribution: /attribution reports verified on-chain evidence even when the in-memory store is empty (survives redeploys)', async () => {
  await withServer(async (base, receipts) => {
    // no live settlements — exactly the post-redeploy state that used to show zero
    assert.equal(receipts.all().length, 0);
    const body = await (await fetch(`${base}/attribution`)).json();
    const verified = body.settlements.filter((s) => s.verified);
    assert.ok(verified.length >= 1, 'verified seed must not be empty');
    assert.ok(body.taggedCount >= verified.length, 'verified settlements all count as tagged');
    const v = VERIFIED_TAGGED_SETTLEMENTS[0];
    const live = body.settlements.find((s) => s.txHash.toLowerCase() === v.txHash.toLowerCase());
    assert.equal(live.verified, true);
    assert.equal(live.tag, ATTRIBUTION_TAG, 'seed settlement carries the assigned tag');
    assert.match(live.explorer, /celoscan\.io\/tx\/0x/);
  });
});