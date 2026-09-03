import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHumanPayApp } from '../src/api.js';
import { SpendPolicyEngine, newOperatorKey, authMessage } from '../src/policy.js';
import { AuditStore } from '../src/receipts.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { AGENT_WALLET, CHAIN_ID, USAT } from '../src/constants.js';
import { TAG, codesIn } from '../src/attribution.js';

const MICRO = 1_000_000n;
const PAYEE = '0x1111111111111111111111111111111111111111';
const BADPEE = '0x2222222222222222222222222222222222222222';

async function withServer(fn) {
  const op = newOperatorKey();
  const app = createHumanPayApp({ engine: new SpendPolicyEngine({ operatorAddress: op.address }), receipts: new AuditStore('e2e-secret'), settlement: new SimulatedSettlement(), selfGate: new MockSelfGate() });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, op); } finally { server.closeAllConnections?.(); server.close(); }
}

test('e2e: regists limit -> operator-signed pay succeeds + tagged receipt -> drain attempt blocked', async () => {
  await withServer(async (base, op) => {
    // 1. set the bounded policy
    const l = await (await fetch(`${base}/limits`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perTxMaxMicro: String(5n * MICRO), dayCapMicro: String(20n * MICRO), totalCapMicro: String(100n * MICRO), allowlist: [PAYEE] }) })).json();
    assert.equal(l.registered, true);

    // 2. a legit, operator-signed, in-caps request -> settles, tagged, receipted
    const req = { nonce: '1', amountMicro: String(2n * MICRO), payTo: PAYEE, token: USAT, chainId: CHAIN_ID, ts: Date.now() };
    const signature = await op.sign(authMessage(req));
    const ok = await (await fetch(`${base}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...req, signature, proof: {} }) })).json();
    assert.equal(ok.receipt.decision, 'allow');
    assert.ok(codesIn(ok.receipt.settlement.calldata).includes(TAG), 'receipt settlement carries the celo_ tag');
    assert.equal(ok.receipt.request.payTo, PAYEE.toLowerCase());

    // 3. a drain attempt: wrong recipient would be keyed only if it must never move — 
    //    operator signs a request to a NON-allowlisted address -> must be blocked, written to receipt
    const badReq = { nonce: '2', amountMicro: String(MICRO), payTo: BADPEE, token: USAT, chainId: CHAIN_ID, ts: Date.now() };
    const badSig = await op.sign(authMessage(badReq));
    const blocked = await (await fetch(`${base}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...badReq, signature: badSig, proof: {} }) })).json();
    assert.equal(blocked.error, 'PAYTO_NOT_ALLOWED');

    // 4. an over-limit drain (the $150K analog) -> blocked
    const drainReq = { nonce: '3', amountMicro: String(150n * MICRO), payTo: PAYEE, token: USAT, chainId: CHAIN_ID, ts: Date.now() };
    const drainSig = await op.sign(authMessage(drainReq));
    const drain = await (await fetch(`${base}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...drainReq, signature: drainSig, proof: {} }) })).json();
    assert.equal(drain.error, 'OVER_PER_TX_CAP');

    // 5. proof endpoint: the whole audit chain is verifiable + un-tampered
    const proof = await (await fetch(`${base}/proof`)).json();
    assert.equal(proof.ok, true);
    assert.equal(proof.records, 1, 'only the ALLOW was recorded as a receipt; blocks were returned as errors');
    assert.equal(AGENT_WALLET.length, 42);
  });
});