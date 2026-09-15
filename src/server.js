// HumanPay combined production entry (Render / any PaaS): one durable process
// that serves BOTH the HTTP API and the live Telegram long-poll bot. Because the
// bot keeps an open getUpdates long-poll, the free-tier service never sleeps
// (no separate keepalive needed); the API stays reachable alongside it.
//
// Env: same as bot.mjs + api.js — TELEGRAM_BOT_TOKEN, OP_OPERATOR_PK, AUDIT_SECRET,
// X402_API_KEY/X402_EXECUTOR_PK/X402_USAT (real settle), SELF_AGENT_ID (real self).
import { createHumanPayApp } from './api.js';
import { buildRuntime, startBotPoller } from './runtime.js';
import { ATTRIBUTION_TAG } from './constants.js';

const PORT = Number(process.env.PORT || 8080);
const rt = buildRuntime();

const server = createHumanPayApp({
  engine: rt.engine,
  selfGate: rt.selfGate,
  settlement: rt.settlement,
  receipts: rt.receipts,
  registry: rt.registry,
  book: rt.book,
});

server.listen(PORT, () => {
  console.log(`[humanpay] API on :${PORT} (tag ${ATTRIBUTION_TAG}, operator ${rt.operatorAddress}, settle=${rt.settlement.constructor.name}, self=${rt.selfGate.constructor.name})`);
});

// Auto-run recurring subscriptions: charge due active subs through the bounded
// spine every SUB_SCHED_MS (default 60s). Honest degradation: a missing payer
// limit or an unfunded rail SKIPS the charge (reported under /subscriptions),
// never mints phantom credit. Timer is unref'd so it never blocks shutdown.
const SUB_SCHED_MS = Number(process.env.SUB_SCHED_MS || 60_000);
if (SUB_SCHED_MS > 0) {
  const tick = async () => {
    try { const r = await server.runDueSubscriptions(); if (r.charged) console.log(`[humanpay:sched] charged ${r.charged}/${r.due}`); }
    catch (e) { console.log('[humanpay:sched] tick failed', (e && e.message) || e); }
  };
  tick();
  setInterval(tick, SUB_SCHED_MS).unref();
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  startBotPoller({ token: process.env.TELEGRAM_BOT_TOKEN, handler: rt.handler });
} else {
  console.log('[humanpay] no TELEGRAM_BOT_TOKEN — API only (set it to run the Telegram channel)');
}

function shutdown() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);