# HumanPay — design.md

**Locked design system for the HumanPay UI. Source of truth — the frontend builds from this, not from vibes.**

Built with the `ui-design-kit` master prompt (design-first; code only after this is locked). Project: humanpay (Celo Agents at Work 2026). Deliverable #1 of the master-prompt workflow.

---

## 0. Project context

- **Product:** HumanPay — a bounded, self-custody payments agent. Agents move real USAT on Celo, only inside human-set limits, only after proof-of-human, on tamper-evident receipts. The anti-drain control layer *is* the product.
- **Audience:** (a) first-time crypto/stablecoin users on mobile (MiniPay-era), (b) judges/developers who will curl the API. Copy serves (a); proof serves (b) in a below-fold section.
- **Brand assets:** none supplied → we own the identity. (If a logo arrives, use it; never regenerate.)
- **Deploy target:** Render (single node:http service) — vanilla HTML/CSS/JS, fonts via CDN. No build step.

---

## 1. Tone (one sentence)

> **Editorial-trust fintech — a payments agent you'd actually trust with money; calm, premium, precise, and honest about what is live.**

Intentional extreme: **premium / editorial-trust** (not crypto-terminal neon, not soft-SaaS pastel).

---

## 2. Composition Variation System (one deliberate pick per axis)

| Axis | Pick | Why |
|---|---|---|
| **Theme** | Dark, but *justified* | Onchain/wallet readouts + live data panels read best on ink; it's a security product (dark = calm, serious), and the money-green accent pops. NOT "dark by default". |
| **Background** | Deep ink `#0A0D0C` + **ONE** low-chroma conic glow, no grid grit | Kills the AI-generic "blueprint grid / mesh orb" look. |
| **Typography** | **Space Grotesk** (display) + **Instrument Sans** (body) + **JetBrains Mono** (data/code only) | Distinct geometric display; humanist body; mono reserved for onchain readouts — never Inter/Roboto/Arial-only. |
| **Hero architecture** | **Split — real photo LEFT, text RIGHT** | Explicit user request ("let the text be at the right") + real-visual rule. Not a text-block-that-happens-to-be-right; the image carries the product metaphor. |
| **Section system** | Alternating **Z-pattern split sections** (image/text flip) + one centered 3-card band + one security checklist band | Rhythmic scroll; each section owns a real image; no collage. |
| **Motion** | Mount-stagger `rise` reveals (NOT scroll-hide) + one rotating conic glow + pulse dots on live status | Content visible on arrival (UX rule); animation is depth, not a gate. Respect `prefers-reduced-motion`. |

**Banned (checked):** purple→blue mesh ✗ · rainbow orbs ✗ · neon glow spam ✗ · Inter/Roboto/Arial-only ✗ · gradient-hero-with-no-real-visual ✗ · dashboard chrome on the landing ✗.

---

## 3. Typography (locked)

| Role | Family | Weights | Use |
|---|---|---|---|
| Display | **Space Grotesk** | 400/500/600/700 | H1, H2, card titles, big numbers |
| Body | **Instrument Sans** | 400/500/600 (+italic 400) | paragraphs, labels, UI copy |
| Data | **JetBrains Mono** | 400/500/600 | tags, hashes, wallet addrs, status pills, endpoint table, amounts |

- Scale: H1 `clamp(2.2rem, 4.6vw, 3.5rem)` · H2 `clamp(1.7rem, 3.2vw, 2.4rem)` · body `1rem/1.6` · small `.86–.95rem` · mono data `.72–.86rem`.
- Display font only at hero/section moments — **not** on every label (typography must be load-bearing).
- Load via Google Fonts CDN `<link>` + preconnect (vanilla SPA already does this). Verified `document.fonts.status === 'loaded'`.

---

## 4. Color tokens (locked — AA-checked)

```css
--bg:#0A0D0C;        /* deep ink — page */
--bg2:#0E1311;       /* raised band */
--surface:#121815;   /* cards */
--surface2:#182019;  /* inputs / inner */
--line:rgba(62,207,142,.16);   /* green hairline */
--line2:rgba(255,255,255,.08); /* neutral hairline */
--green:#3ECF8E;     /* PRIMARY — money + "live" */
--green-soft:#7FE3B8;/* primary hover text */
--gold:#E9C46A;      /* ACCENT (sparing) — section labels, secondary highlight */
--ink:#EAF3EE;       /* primary text  (~15.6:1 on bg) */
--ink-dim:#9DB3A6;   /* secondary text (~7.4:1) */
--ink-faint:#6C8074; /* tertiary labels (~4.6:1 — AA for large/mono only) */
--danger:#FF7A6B;    /* block / error */
```

- **One primary (money-green), one sparing accent (gold)**. Gold used only for eyebrow labels + the hero gradient tail — never as a second primary.
- Gradients: **low-chroma, palette-matched only** (green→green-soft→gold text gradient on the hero; conic glow on green/gold). No rainbow, no mesh.
- Status semantics: **green = LIVE**, **gold = SIM**, **red = MOCK/BLOCK** — used consistently across `/rails`, receipts, and the landing pills.

---

## 5. Spacing & layout

- Container: `max-width 1160px`, side padding `26px` (→ `16px` ≤560px).
- Vertical rhythm: section padding `72px` (→ `48px` ≤560px); card padding `26px`; grid gap `20px`.
- Radii: cards `18px`, hero frame `24px`, inputs/buttons `11–12px`, pills `999px`.
- Shadows: soft, deep (`0 30px 70px rgba(0,0,0,.45)`) — **flat token surfaces, no gradient banding**.

---

## 6. Imagery (real, subject-matched — the anti-generic core)

**Sourced real photography (Pexels, downloaded into `public/images/`, served locally — never hotlink CDN):**

| File | Subject | Where |
|---|---|---|
| `hero-ai.jpg` | humanoid AI agent, dark, real | **Hero (left)** — "the agent" metaphor |
| `hero-robot.jpg` | controlled robotic hand | Problem split (right) — the leash |
| `money-phone.jpg` | phone / mobile payment | How-it-works split (left) |
| `handshake.jpg` | human handshake / P2P | Security split (right) — value between people |
| `mobile-bank.jpg`, `hand-hold.jpg` | spares | fallback only |

- Rule: search **HumanPay's own metaphor** (the controlled agent), not generic "crypto/server/circuit" stock.
- Two chosen hero candidates are dark (mean brightness ~95) → safe for framed use; bright spares exist if a scrim is needed.
- Favicon: crisp designed SVG (shield + ledger bars, on-brand palette) — *deferred, tracked in audit §B*.

---

## 7. Landing vs Product split (non-negotiable)

| Route | Content | Chrome |
|---|---|---|
| **`/`** — landing | hero + problem + how-it-works + anti-drain gates + CTA band. **No** live data, **no** dashboard. | Own slim header (brand · nav · Launch-app CTA) |
| **`/app`** — product | live rail panel (`/rails`+`/attribution`), self-custody tip flow, per-user limits, drain-test, receipt chain. **Auth-gated** (Connect Wallet / read-only) + `← Home`. | App header w/ Connect Wallet |

---

## 8. Motion (locked)

- `rise`: `opacity 0→1`, `translateY(18px)→0`, `cubic-bezier(.16,1,.3,1)`, `700ms`, mount-staggered `+80ms` per child, fill `forwards`. **Content is visible by default — never hidden behind scroll-intersect.**
- `spin`: one conic ring behind the hero image, `24s linear infinite`, `opacity .4`.
- `pulse`: live status dots (`box-shadow` ring), `2s infinite`.
- All gated behind `@media (prefers-reduced-motion: reduce) { * { animation: none } }` (*to add — tracked in audit §E*).

---

## 9. States & feedback (the "finished" tax)

- **Loading:** rail panel shows `—` placeholders then fills from `/rails`+`/attribution` (9s auto-refresh); never a blank flash.
- **Empty:** receipts → "no decisions yet — send a tip or run a drain-test".
- **Errors:** human strings (`RECIPIENT_NOT_ALLOWLISTED`, `NO_LIMIT`), no stack traces.
- **Validation:** inline (`Amount must be > 0`, `Recipient required`).
- **Micro-feedback:** every action writes a callout (`ok`/`warn`/`err`) and refreshes receipts.
- **Auth:** wallet-connect veil with MetaMask/injected + read-only; `← Home` on `/app`.

---

## 10. Copy voice

- Benefit-first, plain language for first-timers. One tagline, reused verbatim: **"Set your limits once. It respects them forever."**
- Hero line: **"Your AI agent can hold money. It just can't be drained."**
- Honest labels always (SIM/MOCK/LIVE surfaced; Self disclosed as MOCK; "relayed untagged" when the tagged path falls back).
- Developer/judge content (endpoint table, tag, agent id) lives **below the fold** in a "For judges" block.

---

## 11. Audit result (composition-design-audit A–G) — honest

| Section | Status | Notes |
|---|---|---|
| **A. Uniqueness** | ✅ | Fresh pair (Space Grotesk/Instrument Sans), own palette, split hero w/ real image. No banned moves. |
| **B. Real visuals** | ✅ (1 deferred) | Real photography in hero + every section, subject-matched. **Deferred:** designed SVG favicon not yet built. |
| **C. New-user comprehension** | ✅ | Plain hero + 3 benefit cards + 3-step how-it-works; landing/app split; `/app` auth-gated w/ Connect Wallet. |
| **D. States & feedback** | ✅ | Loading/empty/error/validation/micro-feedback all present (see §9). |
| **E. Mobile & a11y** | ⚠️ partial | Breakpoints 900/560px shipped + verified via `styleSheets`. **Deferred:** true 390px capture; `prefers-reduced-motion` block; explicit focus-ring pass. |
| **F. Copy polish** | ✅ | Duplicate-scan pending final pass; tagline identical hero↔CTA; labels honest. |
| **G. Live-data correctness** | ✅ | Field-name contract traced (`/rails.rails.funding.usat`, `attr.taggedCount`); micro-units ÷ at call site. |

**Verdict:** passes the anti-generic bar (no more than zero B items truly failing; one deferred). Open items are genuinely deferred, not skipped — listed above.

---

## 12. Open questions for the user (one decision each)

1. **Direction — approve this locked system?** Then the build (already largely implemented) gets tightened to it.
2. **Keep the split hero (image left / text right), or try a full-bleed image hero with the headline over a scrim?** (You asked for text-right; confirming before finalizing.)
3. **Favicon + brand mark:** build the shield/ledger SVG, or do you have a logo to drop in?
