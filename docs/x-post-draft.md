# HumanPay — X submission post (draft)

Required `socialLink` field: a public X post tagging **@CeloDevs** and **@Celo**.
Post from **@zubby_crypt**. Keep it evidence-first: real txs, real receipts.

---

## Primary draft (single post, ~1,050 chars)

Your AI agent can now hold money without being drainable. 🛡️

Built **HumanPay** for @CeloDevs Agents at Work — an agent that moves real USAT
between real people, but only inside human-set limits.

The anti-drain spine:
• Self proof-of-personhood before anything moves
• One-time spend caps (per-tx / daily / lifetime)
• The peer roster IS the payTo allowlist — funds can't reach an undeclared address
• Every allow AND block written to a hash-chained tamper-evident receipt
• Self-custody: each user signs their own EIP-3009 auth, the bot never holds a seed

Real value already moved on @Celo mainnet — not a mock:
0xe2a94c11…77bc · 0.15 USAT peer-to-peer · ERC-8021 tagged celo_131f6e57e5b5

Fee abstraction: the facilitator pays the gas. Gas in the stablecoin.

Live + inspectable (every claim curl-able):
🔗 humanpay.onrender.com/attribution
🤖 t.me/tokenscanner2_bot

Agent ID 9836 · EIP-155:42220

@CeloDevs @Celo #AgentsAtWork

---

## Thread version (if you prefer a thread)

**1/**
Your AI agent can hold a wallet. Can it be drained?

May 2026: a prompt injection hidden in a Morse-code tweet drained ~$150K from an
agent wallet.

Built **HumanPay** for @CeloDevs Agents at Work: agents that move real money,
only inside bounds a human set once. 🧵

**2/**
The spine — a payment is ALLOWED only if every one holds, else BLOCKED (and
blocks are receipted too):

1. Self proof-of-personhood
2. Operator-signed authorization (the agent never holds the seed)
3. Per-tx + daily + lifetime caps in integer micro-units
4. payTo allowlist = the registered peer roster
5. ERC-8021 attribution on every settlement
6. Hash-chained receipts — /proof recomputes the whole chain

**3/**
It's peer-to-peer, self-custody:

Each user funds their OWN @Celo wallet and tips other registered users. The bot
never consolidates funds. A tip moves USAT sender → recipient over gasless
EIP-3009/x402. The server never sees a private key — the sender signs in their
own wallet.

**4/**
Real value on @Celo mainnet (not a mock):

0xe2a94c11…77bc — 0.15 USAT, peer to peer
ERC-8021 tag celo_131f6e57e5b5 verified IN the calldata

The facilitator sponsors the gas — fee abstraction, the primitive we built on.

**5/**
Two @Celo primitives the judges called under-used, load-bearing here:
• Self for proof-of-personhood
• fee abstraction (gas paid in the stablecoin)

Plus honest rails: /rails reports LIVE vs SIM so nothing is overclaimed.

**6/**
Inspect every claim yourself:
🔗 humanpay.onrender.com/attribution
🔗 humanpay.onrender.com/rails
🤖 t.me/tokenscanner2_bot

Agent ID 9836 · chain 42220

@CeloDevs @Celo #AgentsAtWork

---

## Notes before posting

- **Only claim what's verified.** Self proof-of-human is still MOCK on the live
  rail (needs a QR-scan Agent ID registration) — do NOT say "Self-verified" as a
  live claim; say "Self-gated" (implemented) or complete the Self registration first.
- Link the actual tx so a judge can click it:
  https://celoscan.io/tx/0xe2a94c11fd5ea393865337f471e984840a503276a3110cfd8b75079a64b577bc
- Paste the resulting post URL into the submission's `socialLink` field.
