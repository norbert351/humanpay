// HumanPay HTTP API — the software-callable surface.
// Wire a SpendPolicyEngine (bounded, operator-signed) to a Self gate, a
// settlement rail (sim default), and the tamper-evident AuditStore.
import { createServer } from 'node:http';
import { SpendPolicyEngine } from './policy.js';
import { MockSelfGate } from './selfGate.js';
import { SimulatedSettlement } from './settlement.js';
import { AuditStore } from './receipts.js';
import { ATTRIBUTION_TAG, CHAIN_ID, AGENT_WALLET } from './constants.js';

export function createHumanPayApp({ engine, selfGate = new MockSelfGate(), settlement = new SimulatedSettlement(), receipts = new AuditStore() }) {
  engine = engine || new SpendPolicyEngine({ operatorAddress: '*' });
  const json = (res, { code, body }) => {
    if (res.writableEnded) return;
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  };

  return createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    let result = { code: 404, body: { error: 'not found' } };
    try {
      const readBody = () => new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
      });

      if (req.method === 'GET' && u.pathname === '/health') {
        result = { code: 200, body: { ok: true, tag: ATTRIBUTION_TAG, chainId: CHAIN_ID, agentWallet: AGENT_WALLET } };
      } else if (req.method === 'GET' && u.pathname === '/receipts') {
        result = { code: 200, body: receipts.all() };
      } else if (req.method === 'GET' && u.pathname.startsWith('/receipts/')) {
        const r = receipts.get(u.pathname.split('/').pop());
        result = r ? { code: 200, body: r } : { code: 404, body: { error: 'not found' } };
      } else if (req.method === 'GET' && u.pathname === '/proof') {
        result = { code: 200, body: receipts.verifyChain() };
      } else if (req.method === 'POST' && u.pathname === '/limits') {
        const b = await readBody();
        try { result = { code: 200, body: { registered: true, limit: engine.registerLimit(b) } }; }
        catch (e) { result = { code: 409, body: { error: e.message } }; }
      } else if (req.method === 'POST' && u.pathname === '/pay') {
        const b = await readBody();
        const gate = await selfGate.verify(b.proof);
        if (!gate.ok) { result = { code: 403, body: { error: 'NOT_HUMAN' } }; }
        else {
          const verdict = await engine.check({
            nonce: b.nonce, amountMicro: b.amountMicro, payTo: b.payTo,
            token: b.token, chainId: b.chainId, ts: b.ts, signature: b.signature,
          });
          if (!verdict.allow) result = { code: 403, body: { error: verdict.reason } };
          else {
            const settled = await settlement.pay({ amountMicro: b.amountMicro, payTo: b.payTo, token: b.token, chainId: b.chainId, signature: b.signature });
            const receipt = receipts.append({ decision: 'allow', reason: null, request: b, settlement: settled });
            result = { code: 201, body: { receipt } };
          }
        }
      } else if (req.method === 'POST' && u.pathname === '/block') {
        const b = await readBody();
        result = { code: 200, body: { receipt: receipts.append({ decision: 'block', reason: b.reason, request: b, settlement: null }) } };
      }
    } catch (e) {
      result = { code: 500, body: { error: e.message } };
    }
    json(res, result);
  });
}

// Runnable: `npm start`
//   OPERATOR_ADDRESS=<0x...>   the human operator whose signature authorizes payments
//   SETTLE=x402                use the real Celo x402 facilitator (else in-memory sim)
//   X402_API_KEY / X402_EXECUTOR_PK / X402_USAT   required for SETTLE=x402
//   SELF_AGENT_ID              on-chain SelfAgentRegistry proof-of-human (else MockSelfGate)
//   PORT=<n>                   default 8080
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  const engine = process.env.OPERATOR_ADDRESS
    ? new SpendPolicyEngine({ operatorAddress: process.env.OPERATOR_ADDRESS })
    : new SpendPolicyEngine({ operatorAddress: '*' });

  let settlement;
  if (process.env.SETTLE === 'x402') {
    const { X402FacilitatorSettlement } = await import('./x402Celo.js');
    settlement = new X402FacilitatorSettlement({
      apiKey: process.env.X402_API_KEY,
      executorPrivateKey: process.env.X402_EXECUTOR_PK,
      usatAddress: process.env.X402_USAT,
      facilitatorUrl: process.env.X402_URL || 'https://api.x402.celo.org',
    });
  }

  let selfGate;
  if (process.env.SELF_AGENT_ID) {
    const { SelfRegistryGate } = await import('./selfRegistry.js');
    selfGate = new SelfRegistryGate({ acceptedAgentIds: [process.env.SELF_AGENT_ID] });
  }

  const server = createHumanPayApp({ engine, settlement, selfGate });
  server.listen(port, () => console.log(`HumanPay API on :${port} (tag ${ATTRIBUTION_TAG}, operator ${engine.operatorAddress}, settle=${settlement ? 'x402' : 'sim'})`));
}