import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRegistryGate, SELF_REGISTRY } from '../src/selfRegistry.js';
import { privateKeyToAccount } from 'viem/accounts';

test('self: registry constants point at the documented Celo mainnet proxy', () => {
  assert.equal(SELF_REGISTRY.mainnet, '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944');
});

test('self: recovers a request signer from its signature (local, no RPC)', async () => {
  const pk = privateKeyToAccount('0x5ca2b3a6f53507107efbffc4152fdd75b787f6980121aa7286ca662cf6fdc088');
  const gate = new SelfRegistryGate(); // rpcUrl default forno (not used for recovery)
  const sig = await pk.signMessage({ message: 'humanpay:settle 2 USAT' });
  const signer = await gate.recoverSigner({ message: 'humanpay:settle 2 USAT', signature: sig });
  assert.equal(signer, pk.address.toLowerCase());
});

test('self: gate rejects an agent outside the accepted allowlist before any on-chain call', async () => {
  const gate = new SelfRegistryGate({ acceptedAgentIds: [1n, 2n] });
  const res = await gate.verify({ agentId: 999n, message: 'x', signature: '0x' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'AGENT_NOT_ACCEPTED');
});