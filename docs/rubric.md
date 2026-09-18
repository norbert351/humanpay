# HumanPay — Rubric ↔ Evidence Map (judge-verification doc)

Every claim below maps to the **exact live endpoint, on-chain tx, repo path, or
command** that proves it. A judge can open any "Where" column in < 2 minutes.
Criterion facts from the LIVE celobuilders.xyz API (`GET /hackathons` →
submissionDeadline **2026-09-21T09:00:00Z**, winners Sep 25) and the Agents at
Work rules — see `docs/SUBMISSION.md` and the `celo-agents-at-work-2026` fact
base.

> **Anti-overclaim table.** A row marked ❌ is a claim we deliberately do NOT
> make, or make honestly-disclosed only. The signature of the whole doc.
> Anything a judge can disprove in one curl is either proven below or not
> claimed.

## Registered tracks & bounties

| Field | Value | Live source |
|---|---|---|
| `primaryTrack` | `real-world-adoption` (flipped 2026-09-15; see recommendation §6) | celobuilders.xyz `/submissions/me` |
| `trackIds` | `value-moved`, `real-world-adoption`, `judges-favorite` | `/submissions/me` |
| `bountyIds` | `value-moved-1st`, `best-real-world-adoption`, `best-stablecoin-adoption`, `judges-favorite` | `/submissions/me` |
| Attribution tag | `celo_131f6e57e5b5` (locked, derived from repo slug) | `/attribution` → `assignedTag` |
| Agent wallet | `0x10b4…4A6` on Celo mainnet (42220) | `/health` → `agentWallet` |
| ERC-8004 Agent ID | 9836 | `ownerOf(9836)` on `0x8004A169…932` |

## Track: value-moved ($2,000) — ⚠️ NOT actively claimed (see §6)

| Criterion | Where the evidence is | Status |
|---|---|---|
| Adjusted volume between **independent parties** (excluded: self-transfers, own-contract txs, TVL re-counts) | On-chain: tagged tx `0xe2a94c11…77bc` (0.15 USAT). **Gated on distinct signers + independent parties — not satisfiable by self-funded test tips.** | ❌ NOT CLAIMED — correctly excluded |

## Track: real-world-adoption ($1,750) — primaryTrack, latent-not-filled

| Criterion (weight) | Where the evidence is | Depth |
|---|---|---|
| Strongest **genuine user base** — verified users (wallets with Celo activity pre-Aug 28), **returning** users (≥2 distinct days), distinct signers + **EIP-3009 authorisers + sponsored-relay signers** | Live `/users` → roster (each binding a wallet into the payTo allowlist); `/receipts` → distinct day/signer rollups. **Today: `peers: 0`.** | ⚠️ Structures in place (owned Telegram channel + P2P signer flow), **0 real users at audit time** — the open gap |
| Owned distribution channel (the winner pattern: "a distribution channel it already owned") | Telegram `@tokenscanner2_bot` (live, `getMe`-verified long-poll) + pay-link/QR surface (`GET /paylinks`, `/app`) | ✅ LIVE + measurable |

## Bounty: best-stablecoin-adoption ($750) — PROVABLE, the strongest USAT case

| Criterion | Where the evidence is | Status |
|---|---|---|
| Counts cNGN / Ripio wFIAT (wARS, wBRL, wMXN…) / **USAT** anywhere on Celo mainnet, **or any value settled over the x402 facilitator** (USDC/USDT/USAT) | On-chain tagged settlement `0xe2a94c11…77bc` — **USAT, 0.15, ERC-8021-tagged `celo_131f6e57e5b5` verified IN the calldata** (`fromDataSuffix`). USAT covers BOTH halves of this bounty on its own. Live: `/attribution` → `taggedCount: 1`. | ✅ **VERIFIED on-chain** — the only fully-proven scored axis |
| USAT is "the one stablecoin that counts for both halves" | `usatAddr` `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` confirmed live (`/rails`) | ✅ FACT |

## Bounty: judges-favorite ($500) — PROVABLE mechanism + owned channel

| Criterion | Where the evidence is | Depth |
|---|---|---|
| Most innovative on **under-used Celo primitives** (judges named **fee abstraction** + **Self** proof of personhood) | Fee abstraction (gas paid in the stablecoin) = **LIVE** x402 facilitator sponsorship on the settlement rail (`/rails` → `X402FacilitatorSettlement`). Self proof-of-personhood = `MockSelfGate` **DISCLOSED-MOCK** (impl + tests green, needs a human Q R-scan to flip). | ✅ Fee-abstraction live; ⚠️ Self gated on human-in-the-loop |
| A **real distribution channel** it owns | Telegram channel + pay-link/QR surface (`/paylinks`, `/app`) | ✅ LIVE |

## Cross-cutting rules (anti-sybil audit — we can be probed)

| Rule | Our honest position |
|---|---|
| Pre-existing wallet history, first-funder collapse, spawn-window clustering, self-similarity | We claim **no organic volume** — `/health` reports `peers: 0`. Everything on-chain is disclosed self-funded test settlement (`taggedCount: 1`). No farm-shaped signal to exclude. |
| Public repo AT registration, still resolving at judging | `github.com/norbert351/humanpay` — verified PUBLIC 2026-09-18 (`api.github.com` → `visibility: public`), must still resolve at judging (2 entries 404'd last hackathon). |
| Sponsored gas ≠ builder contribution | Facilitator-relayed txs honestly disclosed as NOT leaderboard-credited (`/attribution` note + per-row table in README). The credited rail is `celo-direct-tagged` (executor pays own ~0.001 CELO gas). |
| Commit history reviewed | 116 hermetic tests; commits span the window (registration → live rail → honest-count fix 2026-09-17). |

## Verification matrix (all probed live 2026-09-18)

| Claim | Verified how | Status |
|---|---|---|
| 116 hermetic tests green | `node --test test/*.test.js` → `# pass 116` | ✅ VERIFIED |
| Settlement rail LIVE + funded | `/rails`: X402FacilitatorSettlement, apiKeySet, executor 0.258 USAT / 0.711 CELO | ✅ VERIFIED |
| Tagged settlement on mainnet | `/attribution`: tag `celo_131f6e57e5b5`, `taggedCount: 1`, tx `0xe2a94c11…` verified on-chain | ✅ VERIFIED |
| ERC-8004 Agent #9836 owned by operator | `ownerOf(9836)` eth_call = `0x10b4…A4A6` | ✅ VERIFIED (2026-09-15) |
| Repo public | `api.github.com/repos/norbert351/humanpay` → `public` | ✅ VERIFIED |
| Demo video | `https://humanpay.onrender.com/humanpay-demo.mp4` → 200 `video/mp4` (GET+HEAD) | ✅ VERIFIED |
| Keep-alive through judging window | cron `humanpay-keepalive` every 10m, `enabled: true, last_status: ok` | ✅ VERIFIED |
| Web app renders live | `/app` → rail cards live, `browser_console` 0 JS errors | ✅ VERIFIED |
| Judge-facing endpoints up | `/health /rails /attribution /receipts /proof /users /resources` → all 200 | ✅ VERIFIED |
| Self proof-of-human | `/rails` → `MockSelfGate`, live: false | ⚠️ DISCLOSED-MOCK (human Q R-scan required) |
| Real users / independent parties | `/health` → `peers: 0` | ❌ UNVERIFIED (the open gap) |

## §6 — Recommendation on primaryTrack (surface, do not silently change)

At audit time `peers: 0` and `taggedCount: 1` (one disclosed self-funded tx). Per
the organizer's own anti-sybil rules, `real-world-adoption` rewards a **genuine
user base** (verified users, returning users, distinct EIP-3009 authorisers) —
**none of which is demonstrable yet**. The two PROVABLE scored axes for this
build as submitted are:

1. **`best-stablecoin-adoption`** ($750) — real **USAT** settled on mainnet over
   the x402 facilitator = provable today ✓.
2. **`judges-favorite`** ($500) — under-used primitives (fee abstraction LIVE +
   Self gated-but-implemented) + owned Telegram/pay-link channel ✓.

If keeping `real-world-adoption` as primary, the pitch must lead with the OWNED
channel (the winner pattern) and honest "onboarding is the open gap" — never
claim volume we cannot attribute to independents. The docs already frame this
honestly (§5 matrix row `peers: 0`); the registration field is the user's call.