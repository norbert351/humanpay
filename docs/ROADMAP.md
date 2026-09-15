# HumanPay — Roadmap

Expand-after-hackathon plan. Honest: built features are claimed as built; the rest
is a plan, not a promise.

## North star

A debit card for AI agents that **cannot be drained by construction** — the
bounded, provable, self-custody payments layer becomes the default way an agent
pays for anything on Celo.

For the hackathon: **real users + real independent volume** (the axes that score)
via the two owned channels — the Telegram bot and the pay-link/QR surface.

## 1. Hackathon window (now → Sep 21)

| Item | Why |
|---|---|
| Onboard real humans through the Telegram bot + pay links | `peers: 0` today; the rules count only independent parties with pre-window Celo activity |
| Publish the X post (`socialLink`) and submit | socialLink is the last empty field; submission is a draft |
| Set a real `primaryTrack` — recommendation: **real-world-adoption** | rules: "one primary track… entering everything is not a strategy" |

**Decided: Self rail stays MOCK for the submission.** The on-chain `SelfRegistryGate` is
implemented, wired and tested; flipping LIVE requires a **Self mobile-app scan with a
real passport** (handoff page is QR-only and camera-blocked — no phone-free path).
Attempted 2026-09-15; the scan failed and it is honestly disclosed in `/rails` + README
— judges read that as integrity. The judges-favorite narrative instead rides on the
other under-used primitive (fee abstraction via x402), which is LIVE.

## 2. Product loop (post-hackathon, first month)

- **Self proof-of-human LIVE (`SELF_AGENT_ID`)** — the one rail still MOCK. Needs a
  human with a passport + the Self mobile app (scan the registration QR; mainnet does
  not accept mock documents). Code is done; the gate flips the instant the env var is
  set. This is the single highest-value post-submission flip for the proof-of-personhood
  story.

- **Durable storage** — attach a Render Persistent Disk at `/var/data` (receipts +
  book already persist; the volume is the only missing piece).
- **Live FX** — configure Textile FX so cNGN/wBRL/wARS quotes are real, and wire
  `POST /fx/swap` to an actual on-chain corridor (remittance bill-pay story).
- **Telegram deep-link onboarding** — one `/start` that registers, sets limits and
  shows pay-link/QR in 3 messages.
- **In-app escrow + dispute UI** — release/refund is API-complete; needs a
  buyer/seller-facing screen.
- **Webhook + API-key developer surface** — make HumanPay embeddable
  (agent-as-a-service: any app POSTs a payment intent, gets a signed settlement).

## 3. Scale (quarter 2)

- **MiniPay-first flow** — MiniPay is the named 18M-user channel; a one-tap pay UX
  inside MiniPay turns the owned channel into the primary funnel.
- **Agent identity UX** — one HumanPay account ↔ one ERC-8004 Agent ID, so a
  user's agent spends under a provable identity.
- **Recurring made visible** — sub runs in the inbox with receipts; cancel/limit
  from the notification itself.
- **Operations** — spend analytics charts (beyond the current metrics), budget
  alerts, and a public live-ledger page (judge-facing, shows the hash-chain).

## Demo → product

- **Demo today:** a self-custody bounded tip that settles on-chain, receipts that
  recompute, a split bill, an auto-running subscription, Google sign-in.
- **Product:**
  1. the funnel is *owned* (Telegram + pay links — a distribution channel judges
     explicitly reward),
  2. the trust primitive (anti-drain spine) is *structural*, not a setting,
  3. the roadmap extends to corridors + subscriptions + escrow rather than being a
     one-shot thesis demo.

## Who it's NOT for

- Non-crypto remitters who don't want a wallet at all (needs MiniPay/stablecoin
  UX first) — that's phase 3, not now.
- Enterprise treasury automation (needs governance/multi-sig, separate product).

## Honest status line

Implemented + tested + deployed: the bounded self-custody payments spine, x402 +
tagged settlement, ERC-8004 identity, Telegram + web app, pay links/QR, split
bills, auto-run subscriptions, escrow, invoices, webhooks, API keys, insights, FX
corridors (estimates), independence proof, rate limiting, CSV export, auth
(email + Google), push receipts, persistence. Genuinely open: Self rail LIVE,
live FX quotes, durable Render disk, real user onboarding, published submission.