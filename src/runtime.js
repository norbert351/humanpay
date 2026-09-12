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
import { P2PTeleMessageHandler } from './p2p.js';
import { UserRegistry } from './users.js';
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
  const legacyHandler = new TeleMessageHandler({
    engine, selfGate, settlement, receipts, operatorSign, operatorAddress: opAcc.address,
  });
  const registry = new UserRegistry();
  const p2p = new P2PTeleMessageHandler({ registry, selfGate, settlement, receipts });
  // Dispatcher: P2P commands (register/key/limit/tip/…) route to the peer handler;
  // anything else (legacy agent /pay) falls through to the single-operator handler.
  const handler = {
    async handle(text, ctx = {}) {
      const r = await p2p.handle(text, ctx);
      return r !== null ? r : legacyHandler.handle(text);
    },
    legacy: (t) => legacyHandler.handle(t),
    p2p,
  };
  return { handler, p2p, registry, settlement, selfGate, receipts, engine, operatorAddress: opAcc.address };
}

/**
 * Start the live Telegram long-poll loop. Self-scheduling (never stacks polls).
 * Returns nothing; intended to run for the process lifetime.
 *
 * Resilience notes (learned the hard way — the process must never silently stop
 * owning the getUpdates slot):
 *  - Errors are retried with EXPONENTIAL BACKOFF (capped), so a transient network
 *    blip (or this VM's broken IPv6 egress) can't turn into a hot error loop.
 *  - `409 Conflict` means ANOTHER poller owns the slot (e.g. a stale instance or
 *    a local `npm run bot`); that needs a longer pause, not a tight retry.
 *  - The inter-poll delay is deliberately small but non-zero so we re-acquire the
 *    slot promptly after the 30s long-poll returns.
 */
export function startBotPoller({ token, handler, log = console.log }) {
  const base = `https://api.telegram.org/bot${token}`;
  let offset = 0;
  let failures = 0;
  let stopped = false;
  const send = async (chatId, text) => {
    try {
      await fetch(`${base}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (e) { log('[humanpay:bot] sendMessage failed', (e && e.message) || e); }
  };
  const onError = (e) => log('[humanpay:bot] poll error', (e && e.message) || e);
  let timer = null;

  const schedule = async (delay = 500) => {
    if (stopped) return;
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    if (stopped) return;
    let delay = 500;
    try {
      const res = await fetch(`${base}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(70_000) });
      if (res.status === 409) {
        // Another getUpdates caller grabbed the slot. IMPORTANT: this is usually
        // OUR OWN probe/monitoring, and Telegram terminates the OLDER poll — so
        // the correct response is to re-poll QUICKLY and take the slot back, not
        // to back off. (Backing off here created a self-inflicted starvation
        // loop: every external health probe knocked the poller out for up to 30s,
        // which made the bot look dead to the next probe.)
        onError(new Error('409 Conflict — another getUpdates caller holds the slot; re-polling'));
        delay = 250;
      } else {
        const up = await res.json().catch(() => ({ result: [] }));
        if (up.ok === false) {
          failures++;
          delay = Math.min(30_000, 1_000 * failures);
          onError(new Error(`getUpdates not ok: ${up.description || JSON.stringify(up).slice(0, 120)}`));
        } else {
          failures = 0;
          for (const u of up.result || []) {
            offset = u.update_id + 1;
            const m = u.message || u.edited_message;
            if (!m || !m.text) continue;
            try {
              const ctx = { chatId: m.chat && m.chat.id, chat: m.chat, from: m.from };
              const reply = await handler.handle(m.text, ctx);
              if (reply) await send(m.chat.id, reply);
            } catch (e) { onError(e); }
          }
        }
      }
    } catch (e) {
      failures++;
      delay = Math.min(30_000, 1_000 * failures); // exponential-ish backoff, capped
      onError(e);
    }
    schedule(delay);
  };

  schedule(0);
  log(`[humanpay:bot] live polling via ${base.replace(/bot[^:]+:[^/]+/, 'bot…')}…`);
  return { stop: () => { stopped = true; clearTimeout(timer); } };
}