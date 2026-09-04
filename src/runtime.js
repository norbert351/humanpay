// HumanPay runtime wiring — single source of truth for how the live process
// (either `bot.mjs` or the combined `server.js`) builds its rails. Keeps the
// settlement / self-gate seams honest: X402FacilitatorSettlement only when the
// facilitator creds + USAT are configured (verified domain), else SimulatedSettlement;
// SelfRegistryGate only when a SELF_AGENT_ID is set, else MockSelfGate.
import { privateKeyToAccount } from 'viem/accounts';
import { SpendPolicyEngine, authMessage } from './policy.js';
import { AuditStore } from './receipts.js';
import { MockSelfGate } from './selfGate.js';
import { SelfRegistryGate } from './selfRegistry.js';
import { SimulatedSettlement } from './settlement.js';
import { X402FacilitatorSettlement } from './x402Celo.js';
import { TeleMessageHandler } from './telegram.js';
import { USAT_ADDRESS } from './constants.js';

/** Resolve the settlement rail: real x402 facilitator when creds are present, else sim. */
export function resolveSettlement() {
  const { X402_API_KEY, X402_EXECUTOR_PK, X402_USAT, X402_URL, X402_DOMAIN_NAME, X402_DOMAIN_VERSION } = process.env;
  if (X402_API_KEY && X402_EXECUTOR_PK && (X402_USAT || USAT_ADDRESS)) {
    return new X402FacilitatorSettlement({
      apiKey: X402_API_KEY,
      executorPrivateKey: X402_EXECUTOR_PK,
      usatAddress: X402_USAT || USAT_ADDRESS,
      facilitatorUrl: X402_URL || 'https://api.x402.celo.org',
      domainName: X402_DOMAIN_NAME || undefined,
      domainVersion: X402_DOMAIN_VERSION || undefined,
    });
  }
  return new SimulatedSettlement();
}

/** Resolve the self (proof-of-human) rail: on-chain registry when agent id set, else mock. */
export function resolveSelfGate() {
  const id = process.env.SELF_AGENT_ID;
  return id ? new SelfRegistryGate({ acceptedAgentIds: [id] }) : new MockSelfGate();
}

/** Build the full live runtime (engine + rails + receipt log + telegram handler). */
export function buildRuntime() {
  const operatorPk = process.env.OP_OPERATOR_PK;
  if (!operatorPk) throw new Error('OP_OPERATOR_PK required');
  const opAcc = privateKeyToAccount(operatorPk);
  const engine = new SpendPolicyEngine({ operatorAddress: opAcc.address });
  const operatorSign = async (req) => opAcc.signMessage({ message: authMessage(req) });
  const settlement = resolveSettlement();
  const selfGate = resolveSelfGate();
  const receipts = new AuditStore(process.env.AUDIT_SECRET);
  const handler = new TeleMessageHandler({
    engine, selfGate, settlement, receipts, operatorSign, operatorAddress: opAcc.address,
  });
  return { handler, settlement, selfGate, receipts, engine, operatorAddress: opAcc.address };
}

/**
 * Start the live Telegram long-poll loop. Self-scheduling (never stacks polls).
 * Returns nothing; intended to run for the process lifetime.
 */
export function startBotPoller({ token, handler, log = console.log }) {
  const base = `https://api.telegram.org/bot${token}`;
  let offset = 0;
  const send = async (chatId, text) => {
    await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  };
  const onError = (e) => log('[humanpay:bot] poll error', (e && e.message) || e);
  let timer = null;
  const schedule = async () => {
    try {
      const up = await (await fetch(`${base}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(70_000) })).json();
      for (const u of up.result || []) {
        offset = u.update_id + 1;
        const m = u.message || u.edited_message;
        if (!m || !m.text) continue;
        try {
          const reply = await handler.handle(m.text);
          if (reply) await send(m.chat.id, reply);
        } catch (e) { onError(e); }
      }
    } catch (e) { onError(e); }
    timer = setTimeout(schedule, 500);
  };
  schedule();
  log(`[humanpay:bot] live polling via ${base.replace(/bot[^:]+:[^/]+/, 'bot…')}…`);
  return { stop: () => clearTimeout(timer) };
}