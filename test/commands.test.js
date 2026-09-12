// Every command the HELP text (and the README) advertises must ACTUALLY work.
// Found in the 2026-09-12 sweep: /limits was documented but answered
// "Unknown command" (the real command was /limit), and a silent-empty reply is
// indistinguishable from a dead bot for a user.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntime } from '../src/runtime.js';
import { AuditStore } from '../src/receipts.js';
import { MockSelfGate } from '../src/selfGate.js';
import { SimulatedSettlement } from '../src/settlement.js';
import { UserRegistry } from '../src/users.js';
import { P2PTeleMessageHandler } from '../src/p2p.js';
import { TeleMessageHandler } from '../src/telegram.js';
import { SpendPolicyEngine } from '../src/policy.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ctx = { chatId: 12345, chat: { id: 12345 }, from: { id: 1 } };

// a dispatcher mirroring runtime.js exactly (P2P first, legacy fallthrough)
function makeDispatcher() {
  const registry = new UserRegistry();
  const receipts = new AuditStore('cmd-secret');
  const selfGate = new MockSelfGate();
  const settlement = new SimulatedSettlement();
  const p2p = new P2PTeleMessageHandler({ registry, selfGate, settlement, receipts });
  const op = privateKeyToAccount(generatePrivateKey());
  const engine = new SpendPolicyEngine({ operatorAddress: op.address });
  const legacy = new TeleMessageHandler({
    engine, selfGate, settlement, receipts,
    operatorSign: async (r) => op.signMessage({ message: JSON.stringify(r) }), operatorAddress: op.address,
  });
  return {
    registry,
    handle: async (text, c = ctx) => {
      const r = await p2p.handle(text, c);
      return r !== null ? r : legacy.handle(text);
    },
  };
}

// Every command advertised in HELP / the README command list.
const DOCUMENTED = [
  '/start', '/help',
  '/register 0x1111111111111111111111111111111111111111 @tester',
  '/me', '/my',
  '/status', '/rail', '/proof', '/receipts',
  '/limit 1 5 10',
  '/limits 1 5 10',            // the alias that used to be "Unknown command"
  '/wallet @tester',
  '/wallet nobody-registered',
];

test('commands: every documented command returns a NON-EMPTY reply', async () => {
  const d = makeDispatcher();
  for (const cmd of DOCUMENTED) {
    const out = await d.handle(cmd);
    assert.ok(out !== null && out !== undefined, `${cmd} returned null (would render as silence)`);
    assert.ok(String(out).trim().length > 0, `${cmd} returned an empty reply`);
  }
});

test('commands: no documented command answers "Unknown command"', async () => {
  // /limit and /limits both write the policy, so use fresh dispatchers per command.
  for (const cmd of DOCUMENTED) {
    const d = makeDispatcher();
    const out = await d.handle(cmd);
    assert.doesNotMatch(String(out), /Unknown command/i, `${cmd} is documented but unrecognised: ${out}`);
  }
});

test('commands: /limit has not been replaced (both forms set the policy)', async () => {
  for (const form of ['/limit', '/limits']) {
    const d = makeDispatcher();
    // the policy is per-user, so register the wallet first (the same order a real
    // user follows: /register, then /limit)
    await d.handle('/register 0x2222222222222222222222222222222222222222 @lim');
    const out = await d.handle(`${form} 0.5 2 10`);
    assert.match(out, /policy set/, `${form} must set the policy, got: ${out}`);
  }
});

test('commands: an unknown command gives a helpful reply (never silence)', async () => {
  const d = makeDispatcher();
  const out = await d.handle('/definitely-not-a-command');
  assert.match(String(out), /Unknown command/);
  assert.match(String(out), /HumanPay/, 'the fallback should point the user at help');
});

test('commands: the README-documented HTTP-equivalent set is reachable via the dispatcher', async () => {
  // /status /rail /proof /receipts live on the legacy handler; the dispatcher must
  // still route them (the P2P handler returns null for them by design).
  const d = makeDispatcher();
  for (const cmd of ['/status', '/rail', '/proof', '/receipts']) {
    const out = await d.handle(cmd);
    assert.ok(String(out).trim().length > 0, `${cmd} must not be silent`);
    assert.doesNotMatch(String(out), /Unknown command/i, `${cmd} must route to the legacy handler`);
  }
});

test('commands: HELP lists the same commands the handlers implement', async () => {
  const d = makeDispatcher();
  const help = await d.handle('/help');
  for (const cmd of ['/register', '/limit', '/me', '/wallet', '/tip', '/tipsign', '/status', '/rail', '/receipts', '/proof']) {
    assert.ok(String(help).includes(cmd), `HELP should document ${cmd}`);
  }
});
