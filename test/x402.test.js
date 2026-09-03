import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X402FacilitatorSettlement, recoverTransferAuthAddress, tagResource } from '../src/x402Celo.js';
import { privateKeyToAccount } from 'viem/accounts';
import { TAG } from '../src/attribution.js';

const EXEC = '0x5ca2b3a6f53507107efbffc4152fdd75b787f6980121aa7286ca662cf6fdc088'; // SENTINEL (dummy usat address below)
const USAT = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';
const PAYEE = '0x1111111111111111111111111111111111111111';

test('x402: EIP-3009 transfer-authorization recovers to the executor (gasless signer)', async () => {
  const s = new X402FacilitatorSettlement({ apiKey: 'dummy', executorPrivateKey: EXEC, usatAddress: USAT, facilitatorUrl: 'https://api.x402.celo.org' });
  const { typedData, signature } = await s.signTransferAuthorization({ amountMicro: 2_000_000n, payTo: PAYEE, token: 'USAT', chainId: 42220 });
  const recovered = await recoverTransferAuthAddress({ typedData, signature });
  assert.equal(privateKeyToAccount(EXEC).address.toLowerCase(), recovered.toLowerCase());
  assert.equal(typedData.message.value, 2000000000000n); // 2 USAT * 1e6 micro * 1e6 atomic
});

test('x402: settlement resource string carries the assigned tag', () => {
  const r = tagResource(PAYEE, '2000000');
  assert.ok(r.includes(TAG));
  assert.ok(r.includes('humanpay:'));
});

test('x402: toAtomic scales micro-units to atomic', () => {
  const s = new X402FacilitatorSettlement({ apiKey: 'dummy', executorPrivateKey: EXEC, usatAddress: USAT });
  assert.equal(s.toAtomic(3_000_000n), 3_000_000_000_000n); // 6 decimals
});