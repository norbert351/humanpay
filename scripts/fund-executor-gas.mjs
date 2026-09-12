// Fund the EXECUTOR with gas (CELO) so it can pay for settlement txs.
// x402 on Celo is gasless in USAT via EIP-3009 (the facilitator relays), but a
// little native CELO removes any dependency on the relay and lets the executor
// sign/settle directly if the rail is ever run without the sponsored path.
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import fs from 'node:fs';

const RPC = 'https://forno.celo.org';
const EXECUTOR = '0x3360DA7D976D7ED5Fe79Ee8022f539fb9af8f7C2';
const AMOUNT = process.argv[2] || '1';

const env = Object.fromEntries(fs.readFileSync('/home/ubuntu/humanpay/.env','utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const account = privateKeyToAccount(env.OP_OPERATOR_PK);
const wc = createWalletClient({ account, chain: celo, transport: http(RPC) });
const pc = createPublicClient({ chain: celo, transport: http(RPC) });

const before = await pc.getBalance({ address: EXECUTOR });
const value = parseEther(AMOUNT);
console.log('executor before:', formatEther(before), 'CELO');
console.log(`sending ${AMOUNT} CELO from ${account.address} ...`);
const hash = await wc.sendTransaction({ to: EXECUTOR, value });
await pc.waitForTransactionReceipt({ hash });
const after = await pc.getBalance({ address: EXECUTOR });
console.log('tx:', hash);
console.log('executor after :', formatEther(after), 'CELO');
if (after <= before) throw new Error('balance did not increase');
console.log('gas funded ✓');
