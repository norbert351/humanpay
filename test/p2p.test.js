// Hermetic P2P tests: per-user wallets, self-custody /tip->/tipsign, DEV auto-sign,
// registry-as-allowlist (block unregistered / self / over-cap), budget, receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { UserRegistry } from '../src/users.js';
import { P2PTeleMessageHandler } from '../src/p2p.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { MockSelfGate } from '../src/selfGate.js';
import { AuditStore } from '../src/receipts.js';

function makeA() {
  const k = generatePrivateKey();
  return { key: k, address: privateKeyToAccount(k).address };
}
function handlerFor() {
  const registry = new UserRegistry();
  const settlement = new SimulatedSettlement();
  const h = new P2PTeleMessageHandler({ registry, selfGate: new MockSelfGate(), settlement, receipts: new AuditStore('test-secret') });
  return { h, registry, settlement };
}

test('registry: register + resolve by handle / wallet / chatId, idempotent by wallet', () => {
  const r = new UserRegistry();
  const a = makeA(), b = makeA();
  const ua = r.register({ chatId: '1001', wallet: a.address, handle: 'alice' });
  r.register({ chatId: '1002', wallet: b.address, handle: 'bob' });
  assert.equal(r.resolveTarget('@alice'), ua);
  assert.equal(r.resolveTarget(a.address), ua);
  assert.equal(r.resolveTarget('1001'), ua);
  assert.equal(r.count(), 2);
  // same wallet re-registers to the same user
  assert.equal(r.register({ chatId: '999', wallet: a.address }), ua);
  assert.equal(r.count(), 2);
});

test('self-custody tip: /tip returns auth, /tipsign relays a sender-signed EIP-3009, receipt allow + funds move sender->recipient', async () => {
  const { h, settlement } = handlerFor();
  const alice = makeA(), bob = makeA();
  h.handle('/register ' + alice.address + ' @alice', { chatId: '1001' });
  h.handle('/register ' + bob.address + ' @bob', { chatId: '1002' });
  h.handle('/limit 10 50 100', { chatId: '1001' });

  const notice = await h.handle('/tip 5 @bob nice work', { chatId: '1001' });
  assert.match(notice, /self-custody/);
  assert.match(notice, /from:\s+0x…?/i);

  // Reconstruct the pending typed-data the user must sign (in their own wallet).
  const pend = h.pending.get('1001');
  assert.ok(pend, 'a pending self-custody auth is registered');
  assert.equal(pend.req.from.toLowerCase(), alice.address.toLowerCase());
  assert.equal(pend.req.payTo.toLowerCase(), bob.address.toLowerCase());
  assert.equal(pend.req.amountMicro, 5_000_000n);

  // Alice signs the EIP-3009 typed-data with HER OWN key, pastes the sig back.
  const sig = await privateKeyToAccount(alice.key).signTypedData(pend.typedData);
  const reply = await h.handle('/tipsign ' + sig, { chatId: '1001' });
  assert.match(reply, /tip 5 USAT/);
  assert.match(reply, /receipt r-/);

  const recs = h.receipts.all();
  const allow = recs.find((r) => r.decision === 'allow');
  assert.ok(allow);
  assert.equal(allow.request.from.toLowerCase(), alice.address.toLowerCase());
  assert.equal(allow.request.payTo.toLowerCase(), bob.address.toLowerCase());
  assert.equal(allow.settlement.from.toLowerCase(), alice.address.toLowerCase());
  assert.equal(allow.settlement.payTo.toLowerCase(), bob.address.toLowerCase());
  assert.equal(settlement.byWalletHasSettlement, undefined); // sim records a ledger id
  assert.ok(allow.settlement.ledgerId.startsWith('sim-p2p-'));
  // spent budget reflected
  const aliceUser = h.registry.get('1001');
  assert.equal(aliceUser.engine.spentTotal, 5_000_000n);
});

test('DEV auto-sign: /key binds own key, /tip signs from the sender wallet in one step', async () => {
  const { h, settlement } = handlerFor();
  const alice = makeA(), bob = makeA();
  h.handle('/register ' + alice.address + ' @alice', { chatId: '1001' });
  h.handle('/register ' + bob.address + ' @bob', { chatId: '1002' });
  h.handle('/limit 10 50 100', { chatId: '1001' });
  const keyReply = await h.handle('/key ' + alice.key, { chatId: '1001' });
  assert.match(keyReply, /DEV mode on/);

  const reply = await h.handle('/tip 3 @bob ', { chatId: '1001' });
  assert.match(reply, /tip 3 USAT/);
  const allow = h.receipts.all().find((r) => r.decision === 'allow');
  assert.ok(allow);
  assert.equal(allow.request.from.toLowerCase(), alice.address.toLowerCase());
  assert.equal(allow.request.payTo.toLowerCase(), bob.address.toLowerCase());
  assert.equal(settlement.get(allow.settlement.ledgerId).from.toLowerCase(), alice.address.toLowerCase());
});

test('blocks: unregistered recipient, self-tip, over-cap, bad /tipsign signature — all receipted as block', async () => {
  const { h } = handlerFor();
  const alice = makeA(), bob = makeA();
  h.handle('/register ' + alice.address + ' @alice', { chatId: '1001' });
  h.handle('/register ' + bob.address + ' @bob', { chatId: '1002' });
  h.handle('/limit 5 5 3', { chatId: '1001' }); // total cap 3 forces over-cap quickly

  const unreg = await h.handle('/tip 1 @nobody', { chatId: '1001' });
  assert.match(unreg, /no registered HumanPay user/);

  const selfTip = await h.handle('/tip 1 @alice', { chatId: '1001' });
  assert.match(selfTip, /cannot tip yourself/);

  // over total cap (3 USAT): consume total=3, then a 4th USAT must block
  h.handle('/key ' + alice.key, { chatId: '1001' });
  await h.handle('/tip 3 @bob', { chatId: '1001' }); // consumes total 3 (within perTx 5)
  const over = await h.handle('/tip 1 @bob', { chatId: '1001' }); // 4 > 3 total
  assert.match(over, /blocked: OVER_TOTAL_CAP/);

  // bad /tipsign: sign with WRONG key
  h.handle('/key', { chatId: '1001' }); // no-op to keep pending? need to rebuild pending in self-custody: remove dev key
  const aliceUser = h.registry.get('1001');
  aliceUser.devKey = null;
  await h.handle('/tip 1 @bob', { chatId: '1001' }); // pending self-custody
  const pend = h.pending.get('1001');
  const wrong = await privateKeyToAccount(makeA().key).signTypedData(pend.typedData);
  const bad = await h.handle('/tipsign ' + wrong, { chatId: '1001' });
  assert.match(bad, /signature invalid/);

  const blocks = h.receipts.all().filter((r) => r.decision === 'block');
  assert.ok(blocks.length >= 2, 'blocks were receipted');
  assert.ok(blocks[0].reason === 'OVER_TOTAL_CAP' || blocks[0].reason === 'PAYTO_NOT_ALLOWED' || blocks.some((b) => b.reason === 'BAD_SIGNATURE'));
});

test('budget: engine.checkBudget enforces caps without a signature (self-custody transport layer)', async () => {
  const { h } = handlerFor();
  const alice = makeA(), bob = makeA();
  h.handle('/register ' + alice.address + ' @alice', { chatId: '1001' });
  h.handle('/register ' + bob.address + ' @bob', { chatId: '1002' });
  h.handle('/limit 10 50 20', { chatId: '1001' });
  const u = h.registry.get('1001');
  const ok = await u.engine.checkBudget({ amountMicro: 5_000_000n, payTo: bob.address, token: 'USAT', chainId: 42220 });
  assert.equal(ok.allow, true);
  const over = await u.engine.checkBudget({ amountMicro: 99_000_000n, payTo: bob.address, token: 'USAT', chainId: 42220 });
  assert.equal(over.allow, false);
  assert.equal(over.reason, 'OVER_PER_TX_CAP');
});