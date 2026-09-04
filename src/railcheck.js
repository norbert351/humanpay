// HumanPay rail-readiness — honest, on-chain-backed status of every settlement
// + proof-of-human rail so the demo (and a judge) sees exactly what is LIVE vs
// SIM vs BLOCKED, and what must be funded/turned on to move real value.
// No invented readiness: each field is read live (executor balances, key flags,
// SelfAgentRegistry state) or explicitly null when unreadable.
import { createPublicClient, http, formatUnits } from 'viem';
import { CELO_RPC, USAT_ADDRESS, USAT_DECIMALS, CHAIN_ID } from './constants.js';

const ERC20_BAL_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const REGISTRY_ABI = [
  { type: 'function', name: 'hasHumanProof', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'agentId' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isProofFresh', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'agentId' }], outputs: [{ type: 'bool' }] },
];

/**
 * @param {{
 *   operatorAddress: string,           // the human operator (authorizes payments)
 *   settlement: object,                // active settlement rail (SimulatedSettlement | X402FacilitatorSettlement)
 *   selfGate: object,                  // active self gate (MockSelfGate | SelfRegistryGate)
 *   registry?: string                  // SelfAgentRegistry address (default mainnet)
 * }} deps
 */
export async function railStatus({ operatorAddress, settlement, selfGate, registry = '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944' } = {}) {
  const pub = createPublicClient({ transport: http(CELO_RPC) });
  const out = { chainId: CHAIN_ID, operator: operatorAddress || null, ts: Date.now(), rails: {} };

  // ---- Funding (the hard gate: 0 CELO / 0 USAT = real settlement impossible) ----
  try {
    const celoWei = await pub.getBalance({ address: operatorAddress });
    out.rails.funding = { celo: Number(formatUnits(celoWei, 18)), usat: null };
  } catch (e) {
    out.rails.funding = { celo: null, usat: null, err: (e.shortMessage || e.message || '').slice(0, 80) };
  }
  try {
    const usatAtomic = await pub.readContract({ address: USAT_ADDRESS, abi: ERC20_BAL_ABI, functionName: 'balanceOf', args: [operatorAddress] });
    out.rails.funding.usat = Number(formatUnits(usatAtomic, USAT_DECIMALS));
  } catch (e) {
    out.rails.funding.usatErr = (e.shortMessage || e.message || '').slice(0, 80);
  }

  // ---- Settlement rail ----
  const sClass = settlement?.constructor?.name;
  out.rails.settlement = {
    class: sClass,
    live: sClass === 'X402FacilitatorSettlement',
    apiKeySet: !!process.env.X402_API_KEY,
    executorPrivateKeySet: !!process.env.X402_EXECUTOR_PK,
    usatAddr: USAT_ADDRESS,
    executor: settlement?.executor?.address || null,
    fundedUsat: out.rails.funding?.usat,
  };

  // ---- Self (proof-of-human) rail ----
  const gClass = selfGate?.constructor?.name;
  const agentId = process.env.SELF_AGENT_ID;
  out.rails.self = {
    class: gClass,
    live: gClass === 'SelfRegistryGate',
    agentId: agentId || null,
    registry,
  };
  if (agentId && gClass === 'SelfRegistryGate') {
    try {
      const id = BigInt(agentId);
      const [human, fresh] = await Promise.all([
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'hasHumanProof', args: [id] }),
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'isProofFresh', args: [id] }),
      ]);
      out.rails.self.hasHumanProof = human;
      out.rails.self.isProofFresh = fresh;
    } catch (e) {
      out.rails.self.readErr = (e.shortMessage || e.message || '').slice(0, 80);
    }
  }

  return out;
}

/** Compact one-line text form for the Telegram /rail command. */
export function railStatusLine(s) {
  const f = s.rails.funding || {};
  const se = s.rails.settlement || {};
  const self = s.rails.self || {};
  const fmt = (n) => (typeof n === 'number' ? `$${n}` : n);
  const lines = [
    `operator ${s.operator}`,
    `funding  CELO ${f.celo ?? 'n/a'} · USAT ${f.usat ?? 'n/a'}  (${typeof f.usat === 'number' && f.usat > 0 && f.celo > 0 ? 'READY' : 'NEEDS CELO+USAT'})`,
    `settle   ${se.live ? 'LIVE x402' : 'SIM'} · apiKey ${se.apiKeySet ? 'set' : 'MISSING'} · ${se.live ? `executor ${se.executor}` : 'credits none'}`,
    `self     ${self.live ? 'LIVE registry' : 'MOCK'} · agentId ${self.agentId || 'MISSING'}${self.live ? (self.hasHumanProof && self.isProofFresh ? ' · PROOF OK' : ' · proof not OK') : ''}`,
  ];
  return lines.join('\n');
}