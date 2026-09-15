# HumanPay — Submission (paste-ready)

Paste-ready answers to the **Celo Agents at Work 2026** entry form
(`celobuilders.xyz/hackathons/agents-at-work`). Every field verified against the
live submission API on 2026-09-15.

## Status snapshot (2026-09-15)

- Submission: **draft** (not yet published) · tag **`celo_131f6e57e5b5`** (locked)
- Deadline: **Sep 21, 09:00 GMT** (~5.5 days) — not missed
- Repo: **public**, `github.com/norbert351/humanpay` · live: `humanpay.onrender.com`
- **Missing before publish:** `socialLink` (X post), `videoUrl` (demo video),
  `primaryTrack` (currently `value-moved` — see recommendation below).

## Field-by-field

### Registration stage (present ✅ unless noted)

| Field | Value |
|---|---|
| `projectName` | HumanPay |
| `tagline` | AI agents that move real USAT — bounded by human-set limits, provable on-chain. |
| `githubUrl` | https://github.com/norbert351/humanpay (public) |
| `telegram` | zubby_crypt1 |
| `primaryTrack` | **value-moved** ⚠️ (recommend flipping to `real-world-adoption`; see below) |
| `erc8004Url` | https://8004scan.io/agents/celo/9836 |
| `agentWalletAddress` | 0x10b4064504D3d0D400A607164190B04dE679A4A6 |
| `country` | Nigeria |
| `cpayBetaOptIn` | false |
| `trackIds` | value-moved, real-world-adoption, judges-favorite |
| `bountyIds` | value-moved-1st, best-real-world-adoption, best-stablecoin-adoption, judges-favorite |
| `demoUrl` | https://humanpay.onrender.com |
| `appDomain` | https://humanpay.onrender.com |

### Submission stage (paste these)

- **`description`** (already saved, ~1,300 chars, evidence-first — includes the
  x402/Self/ERC-8004/viem sponsor stack, self-custody P2P, and the honest
  attribution caveat).
- **`additionalTrackRationale`** (already saved):
  > real-world-adoption: real users onboard through the Telegram channel and tip peers. judges-favorite: Self proof-of-personhood + fee abstraction are the two primitives the panel named as under-used.
- **`stablecoinsUsed`** — `USAT` (and `x402 settlement` recorded)
- **`celoNetwork`** — `celo-mainnet`
- **`otherWallets`** — 0x3360DA7D976D7ED5Fe79Ee8022f539fb9af8f7C2 (executor)
- **`ownContracts`** — none deployed this build (all settlement via USAT/x402)
- **`socialLink`** — 🔴 **EMPTY — must post the X thread** (draft: `docs/x-post-draft.md`; post from @zubby_crypt tagging @CeloDevs + @Celo, then paste the URL)
- **`videoUrl`** — 🔴 **EMPTY — record a short live demo** (≤20 MB mp4; landing + /app rails + one tagged settlement + /proof; host anywhere, paste the URL)

## Judgment notes for the short description / X post

- **The scored rail is `celo-direct-tagged`** (executor-broadcast, pays own gas,
  carries the ERC-8021 suffix) — facilitator-relayed gas is "not builder
  contribution". State it plainly; judges read the caveat as honesty.
- **Independent parties only** — self-funded P2P between your own wallets does
  not count. Don't claim volume you can't attribute to independent wallets with
  pre-event Celo activity.
- **USAT is "the one stablecoin that counts for both halves of Best Stablecoin
  Adoption"** — lead the stablecoin-bounty pitch with USAT-native.

## ⚠️ One decision before publishing

`primaryTrack` is currently `value-moved` (all your own test txs). The rules say
*"one primary track… entering everything is not a strategy"*, and value-moved's
independent-parties gate isn't satisfiable by self-funded test tips. **Recommendation:
flip `primaryTrack` to `real-world-adoption`** (strongest genuine story: owned
Telegram channel + USAT-native stablecoin) — keeping `judges-favorite` rationale.
`PUT /submissions/me` with the full base shape + customFields.

## Verification matrix (verified 2026-09-15)

| Claim | Verified how | Status |
|---|---|---|
| ERC-8004 Agent #9836 owned by operator | `ownerOf(9836)` via forno eth_call = 0x10b4…A4A6 | ✅ VERIFIED |
| Tagged settlements on mainnet | `/attribution` live: tag `celo_131f6e57e5b5`, taggedCount 1 | ✅ VERIFIED |
| Settlement rail LIVE | `/rails`: X402FacilitatorSettlement live, executor has USAT | ✅ VERIFIED |
| Repo public + resolving | api.github.com: visibility public | ✅ VERIFIED |
| Tests green | `node --test` = 116 pass | ✅ VERIFIED |
| Keep-alive during judging window | cron `humanpay-keepalive` enabled, last run ok | ✅ VERIFIED |
| Self proof-of-human | `/rails`: MockSelfGate | ⚠️ UNVERIFIED (MOCK — needs SELF_AGENT_ID) |
| Real users / independent parties | `/health`: peers 0 | ⚠️ UNVERIFIED (is the open gap) |
| Google sign-in | `/auth/providers` google configured | ✅ LIVE |
| Subscription scheduler | 116 tests + `/subscriptions/run-due` | ✅ VERIFIED (code+tests; no live subs yet) |

**Never tick:** value-moved volume, "Self proof-of-human LIVE", or any count that
a judge can disprove by opening `/rails` or `/health`.

## After publish

- Re-read `GET /submissions/me` and confirm `socialLink` + `publishedAt` land.
- Verify the repo URL still resolves at judging (rules: 2 entries 404'd last time).
- Keep the keep-alive cron running through Sep 25 (winners announced).