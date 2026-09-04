// HumanPay constants — Celo Agents at Work 2026
export const CHAIN_ID = 42220;                 // Celo mainnet
export const CELO_RPC = 'https://forno.celo.org';
export const ATTRIBUTION_TAG = 'celo_131f6e57e5b5';   // assigned at registration, locked
export const AGENT_WALLET = '0x73b16058d57a6337060677496d4A8e97A9554539'; // agentWalletAddress + ERC-8004 #9813 owner
export const USAT = 'USAT';
export const MICRO = 1_000_000n;               // 1 unit = 1e6 micro (integer math only)

// Verified on Celo mainnet 2026-09-04 (cast + live EIP-3009 eth_call probe):
//   - token = Tether America USD (Tether's Celo-native USAT), issuer Anchorage Digital.
//   - EIP-3009 signing domain name MUST be the token's name() "Tether America USD" —
//     any other name (USAT / USD₮ / USD Tether) reverts "TetherToken: invalid signature".
//     Only this name lets the transferWithAuthorization signature verify.
export const USAT_ADDRESS = '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771';
export const USAT_DECIMALS = 6;
export const USAT_SIGNER_DOMAIN = { name: 'Tether America USD', version: '1', chainId: CHAIN_ID, verifyingContract: USAT_ADDRESS };

// ERC-20 transfer(address,uint256) — the USAT settlement call we tag
export const ERC20_TRANSFER_SIG = '0xa9059cbb';