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

> **Docs:** `ARCHITECTURE.md` · `docs/TECHNICAL.md` · **`docs/rubric.md`** (every
> judging criterion → its exact evidence file/tx/endpoint) · `docs/ROADMAP.md` ·
> `docs/SUBMISSION.md` (paste-ready entry form).

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
  api.js          HTTP surface: /health /rails /limits /pay /block /receipts /receipts/:id /proof + auth + tools
  book.js         HumanPayBook — bills, subscriptions (auto-run scheduler), escrow, invoices, webhooks, API keys, insights
  bookStore.js    PersistentBook — the same book on node:sqlite (AUDIT_DB_PATH), fail-safe degrade
  authn.js        AuthService — scrypt email/password + HMAC sessions + OAuth2 (PKCE S256)
  google.js       Google Sign-In — verify ID tokens against Google's public JWKS (no client secret)
  notify.js       TelegramNotifier — push receipts to both parties on every settlement
  paylinks.js     pay-me links + QR (the owned distribution channel)
  independence.js the hackathon's independent-party rule, checked on-chain
  fx.js           FX corridors — USAT ↔ cNGN/wBRL/wARS quotes (live vs labelled estimate)
  ratelimit.js    token-bucket abuse guard on public/mutating routes
  scheduler       server.runDueSubscriptions() — auto-charges due subs every SUB_SCHED_MS (default 60s)
  runtime.js      single-source live wiring: resolveSettlement/resolveSelfGate/buildRuntime + startBotPoller
  server.js       combined durable production entry: HTTP API + Telegram bot in ONE process (Render)
  constants.js    chain 42220, tag, agent wallet, verified USAT address + EIP-3009 domain
test/             116 hermetic tests (node --test) proving allow/block/attribution/tamper/rail, P2P flows, features, auth, scheduler, persistence
```

The settlement rail is a seam: default `SimulatedSettlement` (no mainnet gas, hermetic tests) swaps to the real `X402FacilitatorSettlement` once `X402_API_KEY`/`X402_EXECUTOR_PK`/`X402_USAT` are set. The Self gate is a seam: `MockSelfGate` for demo, `SelfRegistryGate` once `SELF_AGENT_ID` is set. `GET /rails` / the `/rail` Telegram command report this live so the demo never misrepresents what is real vs simulated.

## Run

```bash
npm install
npm test                          # 116 hermetic tests
OPERATOR_ADDRESS=<0x…> npm start  # HTTP API (:8080)
OP_OPERATOR_PK=<0x…> npm run bot  # Telegram bot (transcript mode w/o token; live polling with TELEGRAM_BOT_TOKEN)
OP_OPERATOR_PK=<0x…> npm run serve  # combined: HTTP API + Telegram bot in ONE process (Render / durable PaaS)
```

## Real integrations (all wired + live-probed)

### Telegram transport — the channel
`src/telegram.js` turns `/limit <perTx> <dayCap> <totalCap> <payTo …>` and `/pay <amount> <payTo>` into the full policy→settle→receipt flow; `bot.mjs` / `src/server.js` long-polls the Bot API when `TELEGRAM_BOT_TOKEN` is set. **Full command set (all verified working):** `/start` `/help` `/register` `/key` `/limit` (= `/limits`) `/me` `/wallet` `/tip` `/tipsign` `/status` `/rail` `/proof` `/receipts`. **Live**: `@tokenscanner2_bot` is polling (verified via 409 — a second `getUpdates` conflicts with the bot's open 30s long-poll). Send any of the above to it.

### P2P tips — bring your own wallet, tip your people
The peer lane (`src/p2p.js`) turns HumanPay from one-operator-holds-the-wallet into **user-funded, peer-to-peer**: each user binds their OWN Celo wallet to their chat and tips OTHER registered users through the bot. A tip moves USAT from the **sender's** wallet to the **recipient's** wallet over gasless EIP-3009/x402 — the bot never consolidates funds.

Commands: `/register <0xWallet> [@handle]` · `/key <pk>` (DEV seam) · `/limit <perTx> <dayCap> <totalCap>` (also `/limits`) · `/me` · `/wallet <@user>` · `/tip <amount> <@user|0xWallet>` · `/tipsign <sig>`.

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
| `POST /tip/sign` | settle a user-signed EIP-3009 authorization — **tagged `celo-direct-tagged`** when the executor signs, else an honestly-labelled relay |
| `GET /receipts`, `GET /receipts/:id`, `GET /proof` | the tamper-evident hash-chained ledger + chain verification |
| `POST /limits`, `POST /pay` | single-operator bounded-pay path (policy kernel, ERC-8021-tagged settlement) |

### Product features (beyond the hackathon)

Every money-moving route below routes through the **same** `_settle()` spine: human-proof gate → policy allowlist + caps → tag-first settlement → tamper-evident receipt → webhook emit. No feature can bypass the anti-drain gates.

| Route | What it does |
|---|---|
| `GET /pay/@handle` · `GET /pay/@handle.png` · `GET /api/payqr` | **Owned pay links + QR** — a shareable/scannable channel to pay any registered peer |
| `GET /paylinks` | Enumerate every peer's pay link (the distribution surface) |
| `POST /bills`, `GET /bills(/:id)`, `POST /bills/:id/shares/:idx/pay` | **Split-a-bill** — remainder-safe integer shares, per-share settlement |
| `POST /subscriptions`, `GET /subscriptions(/:id)`, `POST …/charge`, `POST …/cancel`, `POST /subscriptions/run-due` | **Recurring bounded pay** — interval-capped, policy-gated charges; **auto-runs** every `SUB_SCHED_MS` (default 60s) through the same spine |
| `POST /escrow`, `GET /escrow(/:id)`, `POST …/release`, `POST …/refund` | **Escrow** — hold → release/refund, one-way state machine |
| `POST /invoices`, `GET /invoices(/:id)`, `POST …/pay` | **Payment requests / invoicing** |
| `GET/POST/DELETE /webhooks` | **Webhooks** — HMAC-signed `payment.settled` delivery |
| `POST /apikeys`, `GET /apikeys` | **API keys** — when ≥1 key exists, book endpoints require `Authorization: Bearer hp_…` |
| `GET /insights` | **Spend insights** — allowed/blocked, total USAT, by-day, top counterparties |
| `GET /independence` | **Independent-party rule** (60-day window) checked on-chain, honestly labeled |
| `GET /fx` · `GET /fx/quote` · `POST /fx/swap` | **FX corridors** — USAT ↔ cNGN/wBRL/wARS (live when `TEXTILE_FX_URL` set, else a labeled estimate) |
| `GET /receipts.csv` | **CSV export** of the tamper-evident ledger |
| Rate limiting | token-bucket per IP on public/mutating routes → `429 + Retry-After` |
| `GET /resources` | **On-ramp / funding guidance** — Kolibrì, MiniPay, CEX, faucet (the empty-wallet onboarding blocker) |
| `GET /inbox` | **Notification inbox** — receipts + webhook events + push receipts + subscriptions |
| `GET /auth/*` | **Sign-in** — email/password (scrypt), Google (client-side GIS, no secret), sessions |
| `GET /notifications` | Push-receipt audit trail |
| `POST /subscriptions/run-due` | Manual trigger of the auto-run recurring scheduler |

UI: `public/pay.html` (QR pay page + MiniPay deep-link) and the `/app` **Tools** panels (pay link, split bill, FX quote, insights, independence, subscriptions, webhooks, funding, CSV export). Connecting a wallet registers it as a peer so its pay link resolves.

**Persistence:** receipts AND the book (bills/subs/escrow/invoices/webhooks/API keys) both persist to the same `AUDIT_DB_PATH` SQLite volume (`PersistentAuditStore` + `PersistentBook`), each with a fail-safe in-memory degrade when the path is unwritable. On Render free tier without a mounted disk the volume resets on cold-start — attach a Persistent Disk at `/var/data` for durable storage.

### Social (OAuth) sign-in

**Google sign-in is client-side (Google Identity Services) — no client secret needed.** The browser renders the official Google button; Google returns an ID token; the server verifies it against Google's **public** JWKS (`/auth/google`, `src/google.js`) and issues a session. Only `GOOGLE_CLIENT_ID` is required (committed in `render.yaml`). In Google Cloud Console, register `https://humanpay.onrender.com` as an Authorized JavaScript origin (and `/app` as a redirect origin if you use the redirect mode). Legacy OAuth-2.0-code login (`GOOGLE_CLIENT_SECRET`) also works when the secret is present, for a confidential client — but the primary path needs only the public client id.

## Status & honest limits (2026-09-15 — REAL settlement verified)

- **Persistent receipt + book ledger:** set `AUDIT_DB_PATH` and `AuditStore` swaps to `PersistentAuditStore` AND `HumanPayBook` swaps to `PersistentBook` (both node:sqlite, zero new deps) — receipts AND business objects survive restarts/redeploys, keeping the exact hash-chain integrity (verified by a tamper-detection test that edits the DB directly). Fail-safe: an unwritable path degrades to in-memory with a loud warning instead of failing boot.

- **Implemented + tested:** **116 hermetic tests green** — policy spine (incl. read-only preflight), ERC-8021 attribution, tamper-evident receipts (**8 adversarial tamper cases**), HTTP API (incl. the P2P lane + `/attribution`, which now seeds **verified on-chain evidence** that survives redeploys), Telegram transport, P2P self-custody + DEV tips, EIP-3009 nonce uniqueness, x402 EIP-3009 signer (verified USAT domain), **tagged direct settlement + `/tip/sign`**, SelfRegistry gate, rail-readiness, **persistent store + book**, **auth (scrypt + Google GIS with JWKS verification)**, **telegram push receipts**, **subscription scheduler** (auto-runs due subs through the same spine), split bills, escrow, invoices, webhooks (+test ping), API keys, insights, FX, independence proof, rate limiting, CSV export, MiniPay detect.
- **✅ REAL VALUE MOVED ON CELO MAINNET** (the thing this hackathon scores). Credit status is exactly what `/attribution` on the live service reports — **that endpoint is the authoritative, judge-checkable ledger**, and it shows **`taggedCount: 1`** (only the tx whose calldata was verified on-chain to carry the ERC-8021 suffix):

  | Tx on Celo mainnet | What | Rail | Leaderboard credit |
  |---|---|---|---|
  | `0xb4d75077…d3d5` | 0.10 USAT executor → recipient | x402 facilitator (gas sponsored) | ❌ not tag-credited (facilitator can't carry data-suffix) |
  | `0x2286bf54…5a27` | 1.00 USAT executor → operator | x402 facilitator | ❌ not tag-credited |
  | `0x60049376…5b54` | 0.25 USAT sender → peer (P2P) | x402 facilitator | ❌ not tag-credited |
  | `0xe2a94c11…77bc` | 0.15 USAT P2P | celo-direct-tagged | ✅ **credited — on-chain tag verified** (`/attribution`) |
- **✅ Live:** settlement rail = `X402FacilitatorSettlement` (`apiKeySet: true`), executor `0x3360DA…f7C2` funded with USAT + CELO, Telegram `@tokenscanner2_bot` polling, Render deploy current.
- **✅ ERC-8004 identity:** agent **ID 9836** minted on the rotated operator `0x10b4…A4A6` (the old #9813 was owned by the compromised wallet). `ownerOf(9836)` verified; card at `agents/humanpay.json`.
- **⚠️ Attribution caveat (important, judge-facing):** the x402 facilitator builds and broadcasts the settlement calldata itself, so a **facilitator-relayed payment can never carry the ERC-8021 data suffix** — the x402 spec has no data-suffix concept at all. Since the leaderboard credits only tagged txs, `settleTagged()` submits the *same* EIP-3009 authorization directly from the executor with the tag appended (executor pays ~0.001 CELO gas). `/attribution` reports which settlements are actually credited.
- **⚠️ Self proof-of-human is still `MOCK`.** The on-chain `SelfRegistryGate` is implemented and wired; it needs a **Self Agent ID registration (QR scan in the Self app, human-in-the-loop)** → set `SELF_AGENT_ID` and the gate flips LIVE automatically. This is the one rail still simulated.
- **✅ Six real defects found and fixed while proving the live rail** — all were invisible while `SimulatedSettlement` was the default. Four were found in the adversarial verification sweep *after* the first settlements succeeded:
  1. a `JSON.stringify` BigInt crash that killed settlement before it left the process;
  2. a wrong flat payment-payload shape (rejected as the misleading `unsupported_scheme`);
  3. a **1e6 unit bug** that submitted every settlement 1,000,000× too large (surfaced as `insufficient_funds`);
  4. an **anti-drain hole**: the self-custody `/tip` path handed out a signing request for an *over-cap* payment, so the agent asked a human to authorize what it should have refused (fixed with a read-only `peekBudget` so the spend isn't double-counted);
  5. **every P2P tip reused the same all-zero EIP-3009 nonce** — the first tip worked and every later one reverted `TetherToken: auth invalid` (verified on-chain: `authorizationState(executor, 0x00…00) === true`); now every authorization gets a unique bytes32;
  6. malformed JSON returned 500 instead of 400.

Sources: agent-drain incidents (Algo Alpha, Forbes, TRM Labs), Celo Agents at Work rules (celobuilders.xyz), Celo docs (Self, x402), `@celo/attribution-tags`, x402 spec v2 (`specs/x402-specification-v2.md`), USAT mainnet verification (cast + EIP-3009 eth_call).