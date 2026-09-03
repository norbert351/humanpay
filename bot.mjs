// HumanPay Telegram long-poll bot. Works with a real token (TELEGRAM_BOT_TOKEN)
// against the Bot API getUpdates; without a token it runs a README "transcript"
// mode so the same handler is exercisable for a demo.
// Env:
//   TELEGRAM_BOT_TOKEN   token from @BotFather (live polling when present)
//   OP_OPERATOR_PK       operator private key (signs each payment auth; seed never touches executor)
//   X402_API_KEY | X402_EXECUTOR_PK | X402_USAT   real x402 facilitator settlement
//   SELF_AGENT_ID (mainnet registry)               on-chain Self Agent ID proof-of-human
import { privateKeyToAccount } from 'viem/accounts';
import { SpendPolicyEngine, authMessage } from './src/policy.js';
import { AuditStore } from './src/receipts.js';
import { MockSelfGate } from './src/selfGate.js';
import { SelfRegistryGate } from './src/selfRegistry.js';
import { SimulatedSettlement } from './src/settlement.js';
import { X402FacilitatorSettlement } from './src/x402Celo.js';
import { TeleMessageHandler } from './src/telegram.js';

function build() {
  const operatorPk = process.env.OP_OPERATOR_PK;
  if (!operatorPk) throw new Error('OP_OPERATOR_PK required');
  const opAcc = privateKeyToAccount(operatorPk);
  const engine = new SpendPolicyEngine({ operatorAddress: opAcc.address });
  const operatorSign = async (req) => opAcc.signMessage({ message: authMessage(req) });

  // settlement rail: real x402 facilitator when configured, else sim
  let settlement;
  if (process.env.X402_API_KEY && process.env.X402_EXECUTOR_PK && process.env.X402_USAT) {
    settlement = new X402FacilitatorSettlement({
      apiKey: process.env.X402_API_KEY,
      executorPrivateKey: process.env.X402_EXECUTOR_PK,
      usatAddress: process.env.X402_USAT,
      facilitatorUrl: process.env.X402_URL || 'https://api.x402.celo.org',
    });
  } else {
    settlement = new SimulatedSettlement();
    console.log('[humanpay] settlement=sim (set X402_API_KEY/X402_EXECUTOR_PK/X402_USAT for real x402)');
  }

  // Self gate: on-chain SelfAgentRegistry proof-of-human when agent id set, else mock
  const selfGate = process.env.SELF_AGENT_ID
    ? new SelfRegistryGate({ acceptedAgentIds: [process.env.SELF_AGENT_ID] })
    : new MockSelfGate();

  const receipts = new AuditStore(process.env.AUDIT_SECRET);

  const handler = new TeleMessageHandler({ engine, selfGate, settlement, receipts, operatorSign, operatorAddress: opAcc.address });
  return { handler, receipts };
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  // transcript mode: read lines on stdin, print replies (demo without live token)
  const { createInterface } = await import('node:readline');
  console.log('[humanpay] transcript mode (no TELEGRAM_BOT_TOKEN). Type /help /limit /pay …');
  const { handler } = build();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    try { console.log('\n' + (await handler.handle(line.trim()))); }
    catch (e) { console.log('ERR: ' + e.message); }
  }
  process.exit(0);
}

// live long-poll
const base = `https://api.telegram.org/bot${TOKEN}`;
const { handler } = build();
let offset = 0;
const send = async (chatId, text) => { await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) }); };
setInterval(async () => {
  try {
    const up = await (await fetch(`${base}/getUpdates?timeout=30&offset=${offset}`)).json();
    for (const u of up.result || []) {
      offset = u.update_id + 1;
      const m = u.message || u.edited_message;
      if (!m || !m.text) continue;
      const reply = await handler.handle(m.text);
      if (reply) await send(m.chat.id, reply);
    }
  } catch (e) { console.error('poll error', e.message); }
}, 100);
console.log('[humanpay] live bot polling via ' + base.replace(/[^:]+$/, '…'));