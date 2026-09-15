# HumanPay — Architecture

Bounded auto-pay agent for Celo **Agents at Work 2026**. A payments layer where an
AI agent can move real USAT on Celo — but only inside human-set limits, only with a
proof of personhood, and only after an operator signs each exact request.

**One-line thesis:** *the anti-drain control layer IS the product — every payment
must clear a human-proof gate, bounded caps, a payTo allowlist, and an operator
signature before it can settle, and every ALLOW and BLOCK is on a tamper-evident
receipt.*

---

## System diagram

```
┌───────────────────────────  Clients  ───────────────────────────┐
│  Telegram bot (@tokenscanner2_bot)   Web app (/app)   Pay links │
│  /register /limit /tip /tipsign      email·Google·MetaMask      │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                        ┌──────┴────────┐
                ▼                        ▼               ▼
┌────────────────────────────────────────────────────────────────┐
│                    HTTP API  (src/api.js)                      │
│   auth (email/Google/session) · tips · bills · subscriptions · │
│   escrow · invoices · webhooks · API keys · insights · fx ·   │
│   independence · rate-limit · CSV · pay links/QR · inbox      │
└───────────────┬───────────────────────────────┬────────────────┘
                │                               │
   ┌────────────▼────────────┐     ┌────────────▼─────────────┐
   │   _settle() SPINE       │     │  HumanPayBook            │
   │  (every money path)     │     │  (bills/subs/escrow/     │
   │  1 Self human-proof     │     │   invoices/webhooks/keys)│
   │  2 spend caps+allowlist │◄────│  PersistentBook (sqlite) │
   │  3 EIP-3009 signature   │     │  + runDueSubscriptions() │
   │  4 tag-first settlement │     └──────────────────────────┘
   └───────────────┬─────────┘
                   │
   ┌───────────────▼──────────────────┐
   │  Settlement rail (seam)          │
   │  X402FacilitatorSettlement  LIVE │  ← api.x402.celo.org (facilitator)
   │    ├─ facilitator relay          │  ← gas sponsored (NOT scored)
   │    └─ celo-direct-tagged         │  ← executor pays gas (SCORED, ERC-8021)
   │  SimulatedSettlement (tests)     │
   └───────────────┬──────────────────┘
                   ▼
   ┌──────────────────────────────────┐   ┌────────────────────────┐
   │  Tamper-evident receipts          │   │  ERC-8004 identity     │
   │  PersistentAuditStore (sqlite)    │   │  Agent #9836 on operator│
   │  hash-chained, /proof recomputes  │   │  wallet 0x10b4…A4A6     │
   └──────────────────────────────────┘   └────────────────────────┘
   Celo mainnet (chain 42220) · USAT 0xD2ab…F771
```

## The core value flow (one tip, self-custody)

1. **Sender** registers their own Celo wallet (`UserRegistry` — the register is the
   **payTo allowlist**; you can only pay registered peers).
2. Sender sets their own **limits** (`/limits` → policy caps in integer micro-units).
3. `/tip <amt> <@peer>` → `POST /tip/offline-auth` returns the exact **EIP-3009
   `TransferWithAuthorization` typed-data** for the sender to sign **in their own
   wallet app** — the server never sees a key.
4. Sender signs; `/tip/sign` (or `POST /tip/sign`) submits the signature through
   `_settle()`:
   - Self human-proof gate,
   - per-user caps + allowlist check,
   - settlement — **tagged `celo-direct-tagged` first** (executor broadcasts, pays
     gas, carries the ERC-8021 suffix → this is the ONLY rail the leaderboard
     credits), else an honestly-labelled facilitator relay,
   - tamper-evident receipt appended,
   - webhook emit + **Telegram push receipt** to both parties.
5. `GET /proof` recomputes the whole hash-chain; `GET /attribution` lists every
   settlement whose calldata was confirmed to carry `celo_131f6e57e5b5`.

## The load-bearing anti-drain spine (remove it → nothing runs)

Every money-moving route — tips, bill shares, subscription charges, escrow
release/refund, invoice pay, FX swaps — goes through the **same `_settle()`
helper** (`src/api.js`). There is no second, unguarded money path.

| After removing… | What happens |
|---|---|
| **Self human-proof gate** | Bots can drive payments; the "proof of personhood" reward axis is gone; the product becomes "pay without proving you're human" — its entire safety claim dies. |
| **Policy caps + allowlist** | A prompt-injected agent can drain the whole wallet in one tx to any address — the exact attack the product exists to stop (the $150K Morse-code drain). |
| **EIP-3009 self-custody signatures** | The server must hold keys → custodial risk returns → the "never consolidate funds" promise is broken. |
| **Tag-first settlement (`celo-direct-tagged`)** | Every settlement becomes facilitator-relayed → "sponsored gas is not builder contribution" → **zero credited volume** towards the leaderboard. The submission scores nothing. |
| **Tamper-evident receipts** | ALLOW/BLOCK history becomes forgeable; `/proof` is the audit artifact judges check. |
| **Persistent store** | Ledger + book reset on every redeploy — judge-facing proof vanishes mid-judging. |

Soft-by-design (removable without product death, documented honestly):
- FX corridors (estimates until `TEXTILE_FX_URL`) — an add-on corridor, not the spine.
- Rate limiter / API keys / webhooks — operational hardening, layer above the spine.

## Key modules

| Module | Responsibility |
|---|---|
| `src/api.js` | HTTP surface + the `_settle()` spine + scheduler entry |
| `src/policy.js` | `SpendPolicyEngine` — caps/allowlist/operator-signature decision kernel |
| `src/users.js` | `UserRegistry` = peers = the payTo allowlist |
| `src/settlement.js`, `src/x402Celo.js` | settlement rails (sim / real x402 + tagged direct) |
| `src/attribution.js` | ERC-8021 tagging (`toDataSuffix`, `fromDataSuffix`) |
| `src/selfGate.js`, `src/selfRegistry.js` | Self proof-of-personhood (mock / on-chain) |
| `src/receipts.js`, `src/receiptStore.js` | tamper-evident hash-chained receipts (+ persistence) |
| `src/book.js`, `src/bookStore.js` | bills/subs/escrow/invoices/webhooks/API keys (+ persistence) |
| `src/authn.js`, `src/google.js` | email+password / OAuth2 / client-side Google Sign-In |
| `src/notify.js` | Telegram push receipts to both parties |
| `src/paylinks.js`, `src/independence.js`, `src/fx.js`, `src/ratelimit.js` | product features on the spine |
| `src/runtime.js`, `src/server.js` | live wiring + combined Render entry (API + Telegram + scheduler) |

## Deploy

Render free tier, one durable service (`render.yaml`): HTTP API + Telegram bot
long-poll in one process (the open `getUpdates` long-poll keeps the instance
warm), `SUB_SCHED_MS` subscription timer, keep-alive cron pings `/health` every
10 minutes.