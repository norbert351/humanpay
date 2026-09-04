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
});

server.listen(PORT, () => {
  console.log(`[humanpay] API on :${PORT} (tag ${ATTRIBUTION_TAG}, operator ${rt.operatorAddress}, settle=${rt.settlement.constructor.name}, self=${rt.selfGate.constructor.name})`);
});

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