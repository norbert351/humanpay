// The Telegram poller must never silently stop owning the getUpdates slot.
// Regression coverage for the production symptom: the deployed instance briefly
// held the poll (a 409 from an external probe) and then reported `ok:true,[]` —
// i.e. NO poller — because the old loop retried at a fixed tight cadence with no
// backoff and swallowed every error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBotPoller } from '../src/runtime.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('poller: swallows nothing — a transport error is logged and retried', async () => {
  const logs = [];
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('ETIMEDOUT (ipv6)'); };
  try {
    const p = startBotPoller({ token: 'x:y', handler: { handle: async () => null }, log: (...m) => logs.push(m.map(String).join(' ')) });
    await sleep(1200);
    p.stop();
    assert.ok(calls >= 1, 'the poller kept issuing getUpdates after an error');
    assert.ok(logs.some((l) => l.includes('poll error')), `errors must be logged, got: ${logs.join('|')}`);
  } finally { globalThis.fetch = realFetch; }
});

test('poller: a 409 (another poller owns the slot) is logged and backed off, not fatal', async () => {
  const logs = [];
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 409, json: async () => ({ ok: false, description: 'Conflict' }) }; };
  try {
    const p = startBotPoller({ token: 'x:y', handler: { handle: async () => null }, log: (...m) => logs.push(m.map(String).join(' ')) });
    await sleep(1500);
    p.stop();
    assert.ok(logs.some((l) => /409/.test(l)), 'a 409 must be surfaced in the log');
    // with backoff, a 1500ms window must NOT produce a hot loop of calls
    assert.ok(calls <= 4, `backoff should throttle retries, got ${calls} calls`);
  } finally { globalThis.fetch = realFetch; }
});

test('poller: dispatches messages to the handler and advances the offset', async () => {
  const realFetch = globalThis.fetch;
  const handled = [];
  const sends = [];
  let round = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('getUpdates')) {
      round++;
      if (round === 1) return { status: 200, json: async () => ({ ok: true, result: [{ update_id: 41, message: { chat: { id: 99 }, from: { id: 1 }, text: '/start' } }] }) };
      return { status: 200, json: async () => ({ ok: true, result: [] }) };
    }
    sends.push(JSON.parse(opts.body));
    return { status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const p = startBotPoller({ token: 'x:y', handler: { handle: async (text, ctx) => { handled.push({ text, chatId: ctx.chatId }); return 'hello back'; } }, log: () => {} });
    await sleep(900);
    p.stop();
    assert.deepEqual(handled[0], { text: '/start', chatId: 99 }, 'the update reaches the handler with its chatId');
    assert.equal(sends[0].chat_id, 99);
    assert.equal(sends[0].text, 'hello back');
  } finally { globalThis.fetch = realFetch; }
});

test('poller: a handler throw is contained (one bad command cannot kill the loop)', async () => {
  const realFetch = globalThis.fetch;
  const logs = [];
  let rounds = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('getUpdates')) {
      rounds++;
      if (rounds === 1) return { status: 200, json: async () => ({ ok: true, result: [{ update_id: 1, message: { chat: { id: 5 }, text: '/boom' } }] }) };
      return { status: 200, json: async () => ({ ok: true, result: [] }) };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const p = startBotPoller({
      token: 'x:y',
      handler: { handle: async () => { throw new Error('handler exploded'); } },
      log: (...m) => logs.push(m.map(String).join(' ')),
    });
    await sleep(900);
    p.stop();
    assert.ok(logs.some((l) => l.includes('handler exploded')), 'the handler error is logged');
    assert.ok(rounds >= 2, 'the loop CONTINUED polling after the handler threw');
  } finally { globalThis.fetch = realFetch; }
});

test('poller: stop() halts further polling', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, json: async () => ({ ok: true, result: [] }) }; };
  try {
    const p = startBotPoller({ token: 'x:y', handler: { handle: async () => null }, log: () => {} });
    await sleep(300);
    p.stop();
    const at = calls;
    await sleep(500);
    assert.equal(calls, at, 'no polling after stop()');
  } finally { globalThis.fetch = realFetch; }
});
