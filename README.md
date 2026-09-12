# HumanPay — bounded auto-pay agent

Celo **Agents at Work 2026** · tracks `real-world-adoption` + `judges-favorite` · bounties `best-real-world-adoption`, `best-stablecoin-adoption`, `judges-favorite`
ERC-8021 tag: **`celo_131f6e57e5b5`** · agent wallet `0x10b4064504D3d0D400A607164190B04dE679A4A6`

> Your agent pays small real asks (tips, gigs, subs) in USAT over x402 — but only
> after proof-of-human (Self), only up to a **spend-limit you set once**, never
> holding your seed, with every payment on a **tamper-evident receipt**.
> The anti-drain control layer IS the product.

## Why this exists (the evidenced problem)

AI agents holding wallets are being drained, and the accountability layer doesn't exist yet:

- **May 2026** — prompt injection hidden in a Morse-code tweet drained ~**$150K** from a Grok-linked agent wallet.
- **Jan 2026** — over-permissioned agents amplified the ~**$40M Step Finance** breach.
- Forbes (Aug 14 2026): *"Rogue AI agents are turning crypto risk into a financial-control issue."* TRM Labs: *"who is accountable when AI agents execute transactions?"*

Infra is only now racing to answer it (TEE agentic wallets Feb 2026, MetaMask Agent Wallet Jun 2026, Ledger Agent Stack Jul 2026) — i.e. this is **recently possible**. The two primitives Celo judges flagged as under-used (**Self** proof-of-personhood, **fee abstraction**) are the load-bearing mechanism here.

## The load-bearing anti-drain spine

A payment request is only ALLOWED if **all** of these hold; otherwise it is BLOCKED (and blocked decisions are still receipted):

1. **Proof-of-human (Self)** — the requester is a person, not a bot (`src/selfGate.js`).
2. **Operator authorization** — the human signs each exact request `{nonce, amount, payTo, token, chainId, ts}`; the agent **never holds the master seed** and cannot self-authorize (`src/policy.js`, ECDSA recover).
3. **Bounded spend** — per-tx max, daily cap (midnight rollover), lifetime cap, all integer micro-units.
4. **payTo allowlist** — money can only flow to declared addresses.
5. **ERC-8021 attribution** — every settlement calldata carries the assigned tag via `@celo/attribution-tags` (`src/attribution.js`), verified with `fromDataSuffix`.
6. **Tamper-evident receipts** — every allow/block is hash-chained; `GET /proof` recomputes the whole chain (`src/receipts.js`).

So even a prompt-injected agent cannot exceed its bounds, self-authorize, or move money to an undeclared recipient.

## Architecture

```
src/
  policy.js       SpendPolicyEngine — the anti-drain decision kernel (operator-signed, bounded, allowlisted) + per-user checkBudget (self-custody)
  settlement.js   SimulatedSettlement (hermetic/demo) + offlineAuth/settleWithSignature/payFrom (per-user from)
  x402Celo.js     X402FacilitatorSettlement — real USAT-over-x402 EIP-3009, ERC-8021-tagged, per-user from/signer
  auth.js         shared EIP-3009 TransferWithAuthorization typed-data builder (from = sender's own wallet)
  users.js        UserRegistry — bind each user's own wallet to their chat; the peer roster (== payTo allowlist)
  p2p.js          P2PTeleMessageHandler — /register /key /limit /me /tip /tipsign /wallet (self-custody + DEV)
  p2pSign.js      DEV-mode policy auth (signMessage from the user's own key)
  selfGate.js     MockSelfGate + SelfRegistryGate switch (demo ↔ on-chain)
  selfRegistry.js SelfAgentRegistry on-chain proof-of-personhood gate
  receipts.js     AuditStore — hash-chained allow/block ledger
  attribution.js  ERC-8021 toDataSuffix/taggedCall wrapper
  railcheck.js    honest live rail-readiness: funding (CELO/USAT), settlement, Self (/rails, /rail)
  api.js          HTTP surface: /health /rails /limits /pay /block /receipts /receipts/:id /proof
  runtime.js      single-source live wiring: resolveSettlement/resolveSelfGate/buildRuntime + startBotPoller
  server.js       combined durable production entry: HTTP API + Telegram bot in ONE process (Render)
  constants.js    chain 42220, tag, agent wallet, verified USAT address + EIP-3009 domain
test/             31 hermetic tests (node --test) proving allow/block/attribution/tamper/rail + P2P flows
```

The settlement rail is a seam: default `SimulatedSettlement` (no mainnet gas, hermetic tests) swaps to the real `X402FacilitatorSettlement` once `X402_API_KEY`/`X402_EXECUTOR_PK`/`X402_USAT` are set. The Self gate is a seam: `MockSelfGate` for demo, `SelfRegistryGate` once `SELF_AGENT_ID` is set. `GET /rails` / the `/rail` Telegram command report this live so the demo never misrepresents what is real vs simulated.

## Run

```bash
npm install
npm test                          # 35 hermetic tests
OPERATOR_ADDRESS=<0x…> npm start  # HTTP API (:8080)
OP_OPERATOR_PK=<0x…> npm run bot  # Telegram bot (transcript mode w/o token; live polling with TELEGRAM_BOT_TOKEN)
OP_OPERATOR_PK=<0x…> npm run serve  # combined: HTTP API + Telegram bot in ONE process (Render / durable PaaS)
```

## Real integrations (all wired + live-probed)

### Telegram transport — the channel
`src/telegram.js` turns `/limit <perTx> <dayCap> <totalCap> <payTo …>` and `/pay <amount> <payTo>` into the full policy→settle→receipt flow; `bot.mjs` / `src/server.js` long-polls the Bot API when `TELEGRAM_BOT_TOKEN` is set. Commands: `/start /limit /pay /status /rail /proof /receipts`. **Live**: `@tokenscanner2_bot` is polling (verified via 409 — a second `getUpdates` conflicts with the bot's open long-poll). Send `/start`, `/rail`, `/limit`, `/pay`, `/status` to it.

### P2P tips — bring your own wallet, tip your people
The peer lane (`src/p2p.js`) turns HumanPay from one-operator-holds-the-wallet into **user-funded, peer-to-peer**: each user binds their OWN Celo wallet to their chat and tips OTHER registered users through the bot. A tip moves USAT from the **sender's** wallet to the **recipient's** wallet over gasless EIP-3009/x402 — the bot never consolidates funds.

Commands: `/register <0xWallet> [@handle]` · `/key <pk>` (DEV seam) · `/limit <perTx> <dayCap> <totalCap>` · `/me` · `/wallet <@user>` · `/tip <amount> <@user|0xWallet>` · `/tipsign <sig>`.

Two sign paths, both shipped:
- **Self-custody (primary):** `/tip` returns the exact EIP-3009 `TransferWithAuthorization` typed-data to sign in the sender's own wallet app; `/tipsign <sig>` relays it. The bot never sees a key — the drain story stays intact.
- **DEV seam (demo):** `/key <pk>` binds the sender's own key so `/tip` auto-signs from their wallet in one step (honest, labeled `DEV mode`).

The anti-drain spine is now **per-user**: each user's self-set spend caps bound THEIR OWN wallet, and the `UserRegistry` **is** the payTo allowlist — you can only tip registered users, so money can never flow to an undeclared address. Every allow/block is hash-chained into the shared `AuditStore` and ERC-8021-tagged. Proven by 5 hermetic P2P tests + a live `buildRuntime` smoke run (→ `test/p2p.test.js`).

### Real x402 settlement (Celo facilitator)
`src/x402Celo.js` — the hosted facilitator `api.x402.celo.org/settle` (USDC/USD₮/USA₮ gasless via EIP-3009, one prepaid credit per settlement, non-custodial). Set `X402_API_KEY` (get by signing a message at x402.celo.org), `X402_EXECUTOR_PK`, `X402_USAT`.
**USAT verified on-chain (2026-09-04):** mainnet token = `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` (Tether America USD, 6 decimals) and its EIP-3009 signing-domain name is **`"Tether America USD"`** — confirmed with a live `eth_call` (that name verifies; every other candidate reverts `TetherToken: invalid signature`). The client defaults to this; `X402_DOMAIN_NAME`/`X402_DOMAIN_VERSION` override if a token quirk ever differs. `/settle` live-probed: returns the real `unauthorized` contract without a valid key.

### Real Self proof-of-human (on-chain)
`src/selfRegistry.js` — `SelfAgentRegistry` proxy on Celo mainnet (`0xaC3DF9…5944`, verified deployed): `hasHumanProof(agentId)` + `isProofFresh(agentId)` + `getAgentWallet(agentId) == signer`. Rejects unaccepted agents without any on-chain call. Set `SELF_AGENT_ID`.

### Rail readiness (`/rails` API + `/rail` Telegram)
`src/railcheck.js` reads live state — executor CELO + USAT balances on-chain, settlement rail class + key presence, Self agent state — so you (or a judge) can see in one call exactly what is LIVE vs SIM vs BLOCKED and what to fund/enable.

## HTTP surface (judge-inspectable)

Every claim in this README is verifiable with `curl` against the live service — no Telegram client needed:

| Route | What it proves |
|---|---|
| `GET /` | landing/status: tag, chain, endpoint index |
| `GET /health` | live operator address + peer count |
| `GET /rails` | honest SIM/MOCK/LIVE labels for settlement + Self, funding balances, peer roster |
| `GET /users` | the P2P roster **= the payTo allowlist** (the anti-drain rule made visible) |
| `GET /users/:chatId\|@handle\|0x…` | one peer's wallet + registered bound policy |
| `POST /users` | register a wallet into the allowlist |
| `POST /tip/offline-auth` | returns the EIP-3009 `TransferWithAuthorization` typed-data the **sender** signs (self-custody) |
| `GET /receipts`, `GET /receipts/:id`, `GET /proof` | the tamper-evident hash-chained ledger + chain verification |
| `POST /limits`, `POST /pay` | single-operator bounded-pay path (policy kernel, ERC-8021-tagged settlement) |

## Status & honest limits (2026-09-12 — REAL settlement verified)

- **Implemented + tested:** **42 hermetic tests green** — policy spine, ERC-8021 attribution, tamper-evident receipts, HTTP API (incl. the P2P lane + `/attribution`), Telegram transport, P2P self-custody + DEV tips, x402 EIP-3009 signer (verified USAT domain), **tagged direct settlement**, SelfRegistry gate, rail-readiness.
- **✅ REAL VALUE MOVED ON CELO MAINNET** (the thing this hackathon scores):
  | Tx | What | Rail |
  |---|---|---|
  | `0xb4d75077…d3d5` | 0.10 USAT executor → recipient | x402 facilitator (gas sponsored) |
  | `0x2286bf54…5a27` | 1.00 USAT executor → operator | x402 facilitator |
  | `0x60049376…5b54` | 0.25 USAT sender → peer (**P2P**) | x402 facilitator |
  | `0xc58f7f9b…7422` | 0.05 USAT (**ERC-8021 tagged**) | celo-direct-tagged |
  | `0xe2a94c11…77bc` | 0.15 USAT P2P, on-chain tag `celo_131f6e57e5b5` verified via `fromDataSuffix` | celo-direct-tagged |
- **✅ Live:** settlement rail = `X402FacilitatorSettlement` (`apiKeySet: true`), executor `0x3360DA…f7C2` funded with USAT + CELO, Telegram `@tokenscanner2_bot` polling, Render deploy current.
- **✅ ERC-8004 identity:** agent **ID 9836** minted on the rotated operator `0x10b4…A4A6` (the old #9813 was owned by the compromised wallet). `ownerOf(9836)` verified; card at `agents/humanpay.json`.
- **⚠️ Attribution caveat (important, judge-facing):** the x402 facilitator builds and broadcasts the settlement calldata itself, so a **facilitator-relayed payment can never carry the ERC-8021 data suffix** — the x402 spec has no data-suffix concept at all. Since the leaderboard credits only tagged txs, `settleTagged()` submits the *same* EIP-3009 authorization directly from the executor with the tag appended (executor pays ~0.001 CELO gas). `/attribution` reports which settlements are actually credited.
- **⚠️ Self proof-of-human is still `MOCK`.** The on-chain `SelfRegistryGate` is implemented and wired; it needs a **Self Agent ID registration (QR scan in the Self app, human-in-the-loop)** → set `SELF_AGENT_ID` and the gate flips LIVE automatically. This is the one rail still simulated.
- **✅ Three real defects found and fixed while proving the live rail** (all invisible under the default `SimulatedSettlement`): a `JSON.stringify` BigInt crash, a wrong flat payment-payload shape (rejected as the misleading `unsupported_scheme`), and a **1e6 unit bug** that submitted every settlement 1,000,000× too large (surfacing as `insufficient_funds`).

Sources: agent-drain incidents (Algo Alpha, Forbes, TRM Labs), Celo Agents at Work rules (celobuilders.xyz), Celo docs (Self, x402), `@celo/attribution-tags`, x402 spec v2 (`specs/x402-specification-v2.md`), USAT mainnet verification (cast + EIP-3009 eth_call).