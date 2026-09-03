# HumanPay — bounded auto-pay agent

Celo **Agents at Work 2026** · tracks `real-world-adoption` + `judges-favorite` · bounties `best-real-world-adoption`, `best-stablecoin-adoption`, `judges-favorite`
ERC-8021 tag: **`celo_131f6e57e5b5`** · ERC-8004 agent #9813 · agent wallet `0x73b16058d57a6337060677496d4A8e97A9554539`

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
  policy.js       SpendPolicyEngine — the anti-drain decision kernel (operator-signed, bounded, allowlisted)
  settlement.js   SimulatedSettlement (hermetic/demo) + X402Settlement (real USAT-over-x402, tagged)
  selfGate.js     MockSelfGate + SelfSDKGate (real Self seam)
  receipts.js     AuditStore — hash-chained allow/block ledger
  attribution.js  ERC-8021 toDataSuffix/taggedCall wrapper
  api.js          HTTP surface: /health /limits /pay /block /receipts /receipts/:id /proof
  constants.js    chain 42220, tag, agent wallet
test/             11 hermetic tests (node --test) proving allow/block/attribution/tamper
```

The settlement rail is a seam: default `SimulatedSettlement` (no mainnet gas, hermetic tests) swaps to the real `X402Settlement` once `SETTLE=x402` + `EXECUTOR_PK` are set. The Self gate is a seam: `MockSelfGate` for demo, `SelfSDKGate` for the deployed verifier.

## Run

```bash
npm install
npm test                          # 11 hermetic tests
OPERATOR_ADDRESS=<0x…> npm start  # API (default :8080)
```

`OPERATOR_ADDRESS` = the human operator whose signature authorizes payments (the executor never holds the seed).

## Status & honest limits

- **Implemented + tested:** policy kernel, attribution, receipts, HTTP API, simulated settlement (all green).
- **Real x402 settlement:** client code present and guarded behind `SETTLE=x402`; not yet exercised against mainnet gas (needs executor funding — next increment).
- **Self integration:** seam built; real Self-verifier wiring pending a deployed Self proof path.
- **Telegram transport:** the channel surface is next (bot handler) — the API is the agent-callable surface today.

Sources: agent-drain incidents (Algo Alpha, Forbes, TRM Labs), Celo Agents at Work rules (celobuilders.xyz), `@celo/attribution-tags`.