// HumanPay constants — Celo Agents at Work 2026
export const CHAIN_ID = 42220;                 // Celo mainnet
export const CELO_RPC = 'https://forno.celo.org';
export const ATTRIBUTION_TAG = 'celo_131f6e57e5b5';   // assigned at registration, locked
export const AGENT_WALLET = '0x73b16058d57a6337060677496d4A8e97A9554539'; // agentWalletAddress + ERC-8004 #9813 owner
export const USAT = 'USAT';
export const MICRO = 1_000_000n;               // 1 unit = 1e6 micro (integer math only)

// ERC-20 transfer(address,uint256) — the USAT settlement call we tag
export const ERC20_TRANSFER_SIG = '0xa9059cbb';