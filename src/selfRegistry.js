// Real Self Agent ID verifier — the on-chain proof-of-human for agents.
// contract: SelfAgentRegistry (UUPS proxy) on Celo
//   mainnet  0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
//   sepolia  0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379
// Docs: https://docs.self.xyz/docs/agent-id/smart-contracts/
//
// An agent request like an EVM-signed one can be verified as follows:
//   1. recover the request signer from its signature (viem) — deterministic.
//   2. the SelfAgentRegistry binds a signer key to an agentId backed by a
//      human's unique nullifier (sybil limit 1) with a ZK proof freshness window.
//   3. gate = hasHumanProof(agentId) AND isProofFresh(agentId) AND getAgentWallet(agentId) == signer.
import { recoverMessageAddress, createPublicClient, http } from 'viem';
import { CELO_RPC } from './constants.js';

export const SELF_REGISTRY = {
  mainnet: '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944',
  sepolia: '0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379',
};

const REGISTRY_ABI = [
  { type: 'function', name: 'hasHumanProof', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'agentId' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isProofFresh', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'agentId' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'agentId' }], outputs: [{ type: 'address' }] },
];

export class SelfRegistryGate {
  constructor({ registry = SELF_REGISTRY.mainnet, rpcUrl = CELO_RPC, acceptedAgentIds = [] } = {}) {
    this.registry = registry;
    this.publicClient = createPublicClient({ transport: http(rpcUrl) });
    this.accepted = new Set(acceptedAgentIds.map(BigInt));
  }

  /** Recover the signer of an EVM-signed request. */
  async recoverSigner({ message, signature }) {
    const addr = await recoverMessageAddress({ message, signature });
    return addr.toLowerCase();
  }

  /** Query the registry for an agent's human-proof state. Returns null if no agent. */
  async agentProofState(agentId) {
    const id = BigInt(agentId);
    try {
      const [human, fresh, wallet] = await Promise.all([
        this.publicClient.readContract({ address: this.registry, abi: REGISTRY_ABI, functionName: 'hasHumanProof', args: [id] }),
        this.publicClient.readContract({ address: this.registry, abi: REGISTRY_ABI, functionName: 'isProofFresh', args: [id] }),
        this.publicClient.readContract({ address: this.registry, abi: REGISTRY_ABI, functionName: 'getAgentWallet', args: [id] }),
      ]);
      return { agentId: id.toString(), hasHumanProof: human, isProofFresh: fresh, agentWallet: wallet.toLowerCase() };
    } catch (e) {
      return null; // no agent under this id on this registry
    }
  }

  /**
   * Verify a Self Agent ID request end to end.
   * @param {{ agentId: string|number|bigint, message: string, signature: string }} r
   */
  async verify({ agentId, message, signature }) {
    const id = BigInt(agentId);
    // allowlist first (no on-chain call / signature required to reject unknown agents)
    if (this.accepted.size && !this.accepted.has(id)) {
      return { ok: false, reason: 'AGENT_NOT_ACCEPTED', agentId: id.toString() };
    }
    let signer;
    try { signer = await this.recoverSigner({ message, signature }); }
    catch (e) { return { ok: false, reason: 'BAD_SIGNATURE', agentId: id.toString() }; }
    const state = await this.agentProofState(id);
    if (!state) return { ok: false, reason: 'AGENT_NOT_REGISTERED', signer, agentId: id.toString() };
    if (!state.hasHumanProof) return { ok: false, reason: 'NO_HUMAN_PROOF', signer, state };
    if (!state.isProofFresh) return { ok: false, reason: 'PROOF_STALE', signer, state };
    if (state.agentWallet !== signer) return { ok: false, reason: 'SIGNER_IS_NOT_AGENT_WALLET', signer, state };
    return { ok: true, signer, agentId: id.toString(), human: true, state, registry: this.registry };
  }
}