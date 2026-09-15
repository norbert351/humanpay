# HumanPay — Technical Documentation

Execution/craft details for the **Agents at Work 2026** submission.

**Live:** <https://humanpay.onrender.com> · **Repo:** <https://github.com/norbert351/humanpay> (public)
**Attribution tag:** `celo_131f6e57e5b5` · **Network:** Celo mainnet, chain **42220**

---

## Stack & dependencies

- **Runtime:** Node 22 (uses `node:sqlite` — built-in, zero native deps), `node:http` server (no framework)
- **Chain libs:** `viem ^2.56`, `ethers ^6.17`
- **Celo sponsor stack (genuinely load-bearing):**
  - `@celo/attribution-tags ^0.3` — ERC-8021 tagging
  - `@selfxyz/agent-sdk ^0.2`, `@selfxyz/qrcode ^1.0` — Self proof-of-personhood
  - `qrcode ^1.5` — pay-link QR
  - x402 protocol v2 implemented **natively on viem** (facilitator at `api.x402.celo.org`)
- **Storage:** `node:sqlite` via `PersistentAuditStore` + `PersistentBook` (`AUDIT_DB_PATH`)

## On-chain facts (live, Celo mainnet)

| Fact | Value |
|---|---|
| Network | Celo mainnet `42220` |
| USAT (Tether America USD) | `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` (6 decimals) |
| USAT EIP-3009 domain name | `"Tether America USD"` (verified by live `eth_call`; other names revert) |
| Agent wallet (`agentWalletAddress`) | `0x10b4064504D3d0D400A607164190B04dE679A4A6` |
| Executor (settlement) | `0x3360DA7D976D7ED5Fe79Ee8022f539fb9af8f7C2` |
| ERC-8004 Agent ID | **9836** — `ownerOf(9836)` re-verified 2026-09-15 = agent wallet ✅ |
| ERC-8004 registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (mainnet) |
| SelfAgentRegistry | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| x402 facilitator | `api.x402.celo.org` (USDC/USD₮/USA₮ gasless EIP-3009) |

## The anti-drain policy kernel (`src/policy.js`)

A payment is **ALLOWED** only when ALL of these hold (else BLOCKED, and the block is still receipted):

1. **token + chain bound** — USAT on Celo 42220 only.
2. **positive amount** — integer micro-units, no float anywhere.
3. **operator signature** — `recoverMessageAddress` over `{nonce, amountMicro, payTo, token, chainId, ts}` must recover to the registered operator address. The agent never holds the master seed.
4. **per-tx cap** ≤ `perTxMaxMicro`.
5. **daily cap** (UTC-day rollover) + **lifetime cap**.
6. **payTo allowlist** — recipient must be a registered peer (the `UserRegistry` IS the allowlist).

`checkBudget` (self-custody P2P) runs caps/allowlist without signature recovery — the
EIP-3009 transfer signature is verified over the sender's own wallet at the
transport layer. `peekBudget` is the read-only preflight that refuses an over-cap
payment *before* asking a human to sign it.

## The `_settle()` spine (every money path)

`src/api.js` — one helper, used by tips, bill shares, subscription charges, escrow
release/refund, invoice pay, FX swaps:

```
human-proof gate (selfGate.verify)
→ policy checkBudget (caps + allowlist + token + chain)
→ rebuild EIP-3009 typed-data (from = sender wallet, USAT signer domain)
→ settleTagged() first  → celo-direct-tagged (executor pays gas, carries ERC-8021)
→ else settleWithSignature() → facilitator relay (honestly labelled fallbackReason)
→ receipts.append(allow)   # tamper-evident hash-chain
→ book.emit('payment.settled')  # webhooks (HMAC-signed)
→ notifier.notifyPayment()      # Telegram push receipt to BOTH parties
```

**Why tag-first:** the x402 facilitator builds and broadcasts its own calldata, and
the x402 spec has no data-suffix concept — a relayed payment can *never* carry the
ERC-8021 tag. Since the leaderboard credits only tagged txs, `settleTagged()`
submits the same EIP-3009 authorization directly from the executor (executor pays
~0.001 CELO gas). `/attribution` reports which settlements are actually credited.

## Recurring scheduler

`server.runDueSubscriptions()` — every `SUB_SCHED_MS` (default 60 s, `unref`'d
timer in `src/server.js`) it charges every **active** subscription whose
`nextDueAt` has passed, **through the same `_settle()` spine** (no gate bypass:
unfunded/no-limit payers are SKIPPED and reported, never fabricated). Manual
trigger: `POST /subscriptions/run-due`. `nextDueAt` advances only on a settled
charge → idempotent per tick.

## Auth

- **Email/password:** scrypt (`scrypt$N$salt$hash`, constant-time compare) — never stored raw.
- **Google:** client-side **Google Identity Services** — the official button returns an ID token; the server verifies its **RS256 signature against Google's public JWKS** (`oauth2/v3/certs`: aud=clientId, iss, exp/iat, then `crypto.createVerify`). **No client secret needed.** (`src/google.js`)
- **Sessions:** stateless HMAC-signed Bearer tokens (`AUTH_SECRET`, 7-day TTL).
- **OAuth2 code flow** (Google/GitHub, PKCE S256) also implemented for confidential clients.

## API surface (key endpoints)

| Route | Purpose |
|---|---|
| `GET /health` | live operator, peers, rail classes |
| `GET /rails` | honest SIM/MOCK/LIVE labels + funding balances |
| `GET /users`, `POST /users` | peer roster = payTo allowlist |
| `POST /tip/offline-auth`, `POST /tip/sign` | self-custody tip |
| `GET /receipts`, `GET /receipts/:id`, `GET /proof`, `GET /receipts.csv` | tamper-evident ledger + verify + export |
| `GET /attribution` | ERC-8021-tagged settlements |
| `GET /independence` | the 60-day independent-party rule, on-chain |
| `POST /bills …`, `/subscriptions …`, `/escrow …`, `/invoices …` | product features |
| `/webhooks`, `/apikeys`, `/insights`, `/fx(+/quote/swap)`, `/resources`, `/inbox`, `/notifications` | platform |
| `/auth/register|login|logout|me|providers|google` | sign-in |

## Test suite

**116 hermetic tests** — `npm test` (`node --test test/*.test.js`). Coverage:
policy spine incl. read-only preflight · ERC-8021 attribution · tamper-evident
receipts (8 adversarial tamper cases) · HTTP API + P2P + `/tip/sign` · EIP-3009
nonce uniqueness · USAT domain · SelfRegistry gate · rail-readiness · persistent
store & book (reopen + tamper + fallback) · auth (scrypt, sessions, PKCE, JWKS
verify/aud/iss/exp/tamper) · Google route integration · Telegram push receipts ·
scheduler auto-charge · subscriptions/webhooks/escrow/invoices · rate-limit ·
CSV · FX honesty.

Run: `npm test`. On this dev VM prefix with `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Production env (Render)

| Env | Purpose |
|---|---|
| `PORT`, `NODE_VERSION` | runtime |
| `OP_OPERATOR_PK` | operator (human authorizer) key |
| `TELEGRAM_BOT_TOKEN` | Telegram channel (bot long-poll) |
| `AUDIT_DB_PATH`, `AUDIT_SECRET` | persistent ledger + book (SQLite) |
| `X402_API_KEY`, `X402_EXECUTOR_PK`, `X402_USAT` | real x402 settlement rail |
| `SELF_AGENT_ID` | on-chain Self proof-of-human (else MOCK — honest) |
| `GOOGLE_CLIENT_ID` | Google Sign-In (public; committed) |
| `GOOGLE_CLIENT_SECRET` | optional — legacy confidential OAuth only |
| `AUTH_SECRET` | session signing |
| `SUB_SCHED_MS` | subscription scheduler interval (default 60000) |
| `TEXTILE_FX_URL` | FX live quotes (else labelled estimate) |

Secrets never live in the repo; `render.yaml` marks `sync: false` on secret keys.

## Honest limits

- **Self proof-of-human is `MOCK` on the live instance** — `MockSelfGate`. The
  on-chain `SelfRegistryGate` is implemented and wired; it flips LIVE the moment
  `SELF_AGENT_ID` is set (a Self app QR registration — human-in-the-loop).
- **FX corridors quote labelled estimates** until `TEXTILE_FX_URL` is configured.
- **Render free tier wipes the SQLite volume on cold start** unless a Persistent
  Disk is mounted at `/var/data`.
- Facilitator-relayed settlements are real on-chain but **not** leaderboard-credited
  (tagged direct path is the credited rail).