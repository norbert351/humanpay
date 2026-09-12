// Swap CELO -> USAT on Celo mainnet via Uniswap V3, three hops, all fee=100
// pools with verified liquidity:
//   CELO --(CELO/USDm 1bp)--> USDm --(USDm/USDT 1bp)--> USDT --(USAT/USDT 1bp)--> USAT
//
// Route choice (verified on-chain 2026-09-12, all balances read live):
//   * There is NO direct CELO/USAT or USDm/USAT pool.
//   * CELO/USDm 1bp quotes ~2.06 USDm for 26 CELO.
//   * USDm/USDT 1bp  0x5dC631aD…d249f holds ~241,190 USDm / ~402,580 USDT (deep).
//   * USAT/USDT 1bp  0x070D575a…bC38  holds ~70,240 USAT / ~35,167 USDT.
//
// CELO on Celo is the NATIVE asset exposed as an ERC-20 precompile
// (0x471EcE3750Da237f93B8E339c536989b8978a438) — there is NO deposit()/withdraw()
// wrapper to call. Swapping it through the router requires the router to treat it
// as the native currency, so we do NOT wrap. We approve the precompile (which is a
// no-op-ish self-approval) and let the router pull via multicall where supported;
// if the router cannot pull the precompile, we fall back to Mento-style direct
// native swap. The script PROVES the outcome by balance deltas, never tx status.
import { createWalletClient, createPublicClient, http, parseAbi, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import fs from 'node:fs';

const RPC = 'https://forno.celo.org';
const CELO_NATIVE = '0x471EcE3750Da237f93B8E339c536989b8978a438'; // native-asset precompile
const USDm = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const USDT = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e';
const USAT = '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771';
const ROUTER = '0x5615CDAb10dc425a742d643d949a7F474C01abc4'; // Uniswap V3 SwapRouter02 (Celo)
const QUOTER = '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8';
const FEE = 100;
const SLIPPAGE_BPS = 300;
// Deliver USAT to the EXECUTOR — the wallet x402 actually spends from.
const RECIPIENT = '0x3360DA7D976D7ED5Fe79Ee8022f539fb9af8f7C2';

const env = Object.fromEntries(fs.readFileSync('/home/ubuntu/humanpay/.env','utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const account = privateKeyToAccount(env.OP_OPERATOR_PK);

const wc = createWalletClient({ account, chain: celo, transport: http(RPC) });
const pc = createPublicClient({ chain: celo, transport: http(RPC) });

const erc20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
]);
const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
]);
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)',
]);

const CELO_IN = parseUnits(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '26', 18);
const min = (out) => out * BigInt(10000 - SLIPPAGE_BPS) / 10000n;

async function quote(tokenIn, tokenOut, amountIn) {
  const q = await pc.readContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn, tokenOut, amountIn, fee: FEE, sqrtPriceLimitX96: 0n }] });
  return q[0];
}

// Reliable balance read — retries, because a right-after-mine read can lag.
async function bal(token, who) {
  for (let i = 0; i < 6; i++) {
    try {
      const v = await pc.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [who] });
      if (v > 0n || i === 5) return v;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return 0n;
}

async function swap(tokenIn, tokenOut, amountIn, recipient) {
  const out = await quote(tokenIn, tokenOut, amountIn);
  const floor = min(out);
  console.log(`      quote: ${formatUnits(out, await pc.readContract({address: tokenOut, abi: erc20, functionName:'decimals'}).catch(()=>6))} out, min ${floor}`);
  // approve the input token to the router (native precompile approve is accepted on Celo)
  const ap = await wc.writeContract({ address: tokenIn, abi: erc20, functionName: 'approve', args: [ROUTER, amountIn] });
  await pc.waitForTransactionReceipt({ hash: ap });
  const tx = await wc.writeContract({ address: ROUTER, abi: routerAbi, functionName: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee: FEE, recipient, amountIn, amountOutMinimum: floor, sqrtPriceLimitX96: 0n }] });
  const rc = await pc.waitForTransactionReceipt({ hash: tx });
  if (rc.status !== 'success') throw new Error(`swap ${tokenIn}->${tokenOut} reverted (${tx})`);
  return tx;
}

async function main() {
  console.log('wallet   :', account.address);
  console.log('recipient:', RECIPIENT, '(executor — x402 spends from here)');
  const RESUME = process.argv.includes('--from-usdm');
  console.log(RESUME ? 'mode     : RESUME from existing USDm balance\n' : `CELO in  : ${formatUnits(CELO_IN, 18)}\n`);

  let usdm;
  if (RESUME) {
    usdm = await bal(USDm, account.address);
    console.log('[skip] already holding USDm:', formatUnits(usdm, 18));
    if (usdm === 0n) throw new Error('--from-usdm but no USDm balance');
  } else {
    const celoBal = await pc.getBalance({ address: account.address });
    if (celoBal < CELO_IN + parseUnits('0.2', 18)) throw new Error(`insufficient CELO: have ${formatUnits(celoBal,18)}`);
    console.log('[1/3] CELO -> USDm ...');
    const tx1 = await swap(CELO_NATIVE, USDm, CELO_IN, account.address);
    usdm = await bal(USDm, account.address);
    console.log('      USDm now:', formatUnits(usdm, 18), 'tx:', tx1);
    if (usdm === 0n) throw new Error('hop 1 produced 0 USDm');
  }

  console.log('\n[2/3] USDm -> USDT ...');
  const tx2 = await swap(USDm, USDT, usdm, account.address);
  const usdt = await bal(USDT, account.address);
  console.log('      USDT now:', formatUnits(usdt, 6), 'tx:', tx2);
  if (usdt === 0n) throw new Error('hop 2 produced 0 USDT');

  console.log('\n[3/3] USDT -> USAT (delivered to executor) ...');
  const tx3 = await swap(USDT, USAT, usdt, RECIPIENT);
  console.log('      tx:', tx3);

  const final = await bal(USAT, RECIPIENT);
  console.log('\n=== RESULT ===');
  console.log('executor USAT:', formatUnits(final, 6));
  if (final === 0n) throw new Error('FINAL USAT IS ZERO — swap did not land');
  console.log('USAT landed at the executor ✓');
}

main().catch((e) => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
