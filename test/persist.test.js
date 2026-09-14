// Persistent tamper-evident ledger + the self-custody /tip/sign HTTP settlement
// path. Proves: (a) receipts survive a store reopen (restart/redeploy), keeping
// the exact hash-chain invariant, and (b) /tip/sign settles a signed EIP-3009
// authorization via the TAGGED path when the rail supports it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentAuditStore } from '../src/receiptStore.js';
import { DatabaseSync } from 'node:sqlite';
import { createHumanPayApp } from '../src/api.js';
import { SpendPolicyEngine, newOperatorKey } from '../src/policy.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { UserRegistry } from '../src/users.js';
import { AuditStore } from '../src/receipts.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hp-'));
  return { dir, path: join(dir, 'audit.db') };
}

test('persistence: receipts survive a reopen and the hash chain stays verifiable', () => {
  const { dir, path } = tmpDb();
  try {
    const a = new PersistentAuditStore({ secret: 's1', path });
    a.append({ decision: 'allow', reason: null, request: { amountMicro: '100000', payTo: '0xaa' }, settlement: { source: 'x', txHash: '0x1' } });
    a.append({ decision: 'block', reason: 'OVER_DAILY_CAP', request: { amountMicro: '999', payTo: '0xbb' }, settlement: null });
    assert.equal(a.all().length, 2);
    assert.equal(a.verifyChain().ok, true);
    a.close();

    // Reopen — fresh instance, same file + secret. Chain must reload intact.
    const b = new PersistentAuditStore({ secret: 's1', path });
    assert.equal(b.all().length, 2, 'receipts reloaded from disk');
    assert.equal(b.get('r-0').settlement.txHash, '0x1');
    assert.equal(b.get('r-1').reason, 'OVER_DAILY_CAP');
    assert.equal(b.verifyChain().ok, true, 'reloaded chain still verifies');
    // appending after reload must chain onto the persisted prevHash
    const third = b.append({ decision: 'allow', reason: null, request: { amountMicro: '200000', payTo: '0xcc' }, settlement: { source: 'celo-direct-tagged', txHash: '0x3' } });
    assert.equal(third.prevHash, b.get('r-1').hash, 'appends chain onto the last persisted record');
    assert.equal(b.verifyChain().ok, true);
    assert.equal(b.all().length, 3);
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persistence: tampering a persisted record is caught by recompute', () => {
  const { dir, path } = tmpDb();
  try {
    const a = new PersistentAuditStore({ secret: 's2', path });
    a.append({ decision: 'allow', reason: null, request: { amountMicro: '100000', payTo: '0xaa' }, settlement: { source: 'x', txHash: '0x1' } });
    a.close();
    // tamper directly in the DB
    const db = new DatabaseSync(path);
    const rec0 = JSON.parse(db.prepare('SELECT record FROM receipts WHERE idx=0').get().record);
    rec0.settlement.txHash = '0xDEADBEEF';
    db.prepare('UPDATE receipts SET record=? WHERE idx=0').run(JSON.stringify(rec0));
    db.close();
    const b = new PersistentAuditStore({ secret: 's2', path });
    const v = b.verifyChain();
    assert.equal(v.ok, false, 'mutated record must fail chain verification');
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function withApp(fn) {
  const op = newOperatorKey();
  const registry = new UserRegistry();
  const receipts = new AuditStore('secret');
  const app = createHumanPayApp({
    engine: new SpendPolicyEngine({ operatorAddress: op.address }),
    receipts, settlement: new SimulatedSettlement(), selfGate: new MockSelfGate(), registry,
  });
  registry.register({ chatId: 'c1', wallet: '0x1111111111111111111111111111111111111111', handle: 'alice' });
  registry.register({ chatId: 'c2', wallet: '0x2222222222222222222222222222222222222222', handle: 'bob' });
  // Give alice spend limits so her self-custody tips clear checkBudget.
  registry.get('c1').engine.registerLimit({ perTxMaxMicro: '500000', dayCapMicro: '5000000', totalCapMicro: '50000000', allowlist: ['0x2222222222222222222222222222222222222222'] });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections?.(); server.close(); }
}

test('tip/sign: rejects a non-EIP-3009 signature shape', async () => {
  await withApp(async (base) => {
    const r = await fetch(base + '/tip/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountMicro: '100000', payTo: '0x2222222222222222222222222222222222222222', from: '0x1111111111111111111111111111111111111111', signature: 'not-a-signature' }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /PAYMENT-SIGNATURE/);
  });
});

test('tip/sign: a self-custody signature settles via the rail and is receipted', async () => {
  await withApp(async (base) => {
    const sig = '0x' + 'ab'.repeat(65);
    const r = await fetch(base + '/tip/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountMicro: '100000', payTo: '0x2222222222222222222222222222222222222222', from: '0x1111111111111111111111111111111111111111', signature: sig }) });
    const body = await r.json();
    assert.equal(r.status, 201, JSON.stringify(body));
    assert.ok(body.receiptId, 'has a receipt id');
    assert.ok(['simulated', 'x402', 'celo-direct-tagged'].includes(body.rail), 'records the rail source: ' + body.rail);
  });
});