# Power Meter & 100x Credit Inflation — Design Spec

**Date:** 2026-07-07
**Status:** Implemented
**Goal:** Reduce credit-spend anxiety (the "taxi meter" effect) by inflating credit units 100x, renaming the user-facing unit to **Power**, and replacing the numeric credit badge with a plan-relative power meter.

---

## Problem

Users watch a small credit number tick down with every message. Each action has a visible, countable price, which makes casual conversation feel metered like a taxi ride. Small balances (50, 300) amplify this: every single message visibly consumes a meaningful fraction of the balance.

## Product Decisions (locked in)

| # | Topic | Decision |
|---|---|---|
| 1 | Scaling | True backend migration: all stored balances, grants, and per-action costs multiplied by exactly 100. Straight ×100 — no cost rebalancing in this spec. |
| 2 | Unit name | User-facing unit renamed **"Power"**. Backend schema, service names, and code identifiers keep `credit*` naming. "Energy" is reserved for a possible future free daily recharging grant (see Appendix). |
| 3 | Badge | `CreditCounterIcon` numeric badge replaced by a plan-relative **power meter** with coarse (5%-step) fill rendering and no visible number. |
| 4 | Low balance | Soft low-power UX: amber/red meter bands, gentle pre-emptive prompts, friendly "Out of Power" copy instead of raw insufficient-credit errors. |
| 5 | Cost visibility | Per-action costs removed from chat surfaces; costs appear only in one pricing section of the subscribe screen. |
| 6 | Subscription framing | "Power refills monthly" copy on subscribe screen. |
| 7 | Free daily Energy | **Not implemented in this spec.** Research retained as non-normative Appendix A. |
| 8 | Rollout | Approach A: big-bang SQL migration + coordinated deploy. Acceptable because there are currently no users. |

---

## 1. Backend ×100 Migration

### Unit convention

All runtime constants are written as **final literal values** (e.g. `SIGNUP_CREDITS = 5000`), not `50 * CREDIT_SCALE`. No runtime scaling code exists anywhere. A `CREDIT_SCALE = 100` value appears only in the migration commentary and docs as the historical conversion factor.

### SQL migration

Hand-written migration at the next index (per `docs/db-migrations.md` workflow — do **not** run `drizzle-kit generate`):

```sql
UPDATE credit_transactions
SET initial_amount = initial_amount * 100,
    remaining_balance = remaining_balance * 100;
```

No schema change. Columns remain integers.

### Grant amounts

| Grant | Old | New |
|---|---|---|
| Free signup (`getOrCreateDefaultSubscription` → `creditService.addCredits`) | 50 | 5,000 |
| Monthly subscription (Stripe + RevenueCat webhooks) | 300/cycle | 30,000/cycle |
| One-time pack (Stripe + RevenueCat webhooks) | 100 | 10,000 |

### Per-action costs (straight ×100)

| Action | Old | New |
|---|---|---|
| Text chat reply, grounded (`generateReply`, default googleSearch) | 3 / round-trip | 300 |
| Text chat reply, standard (`generateReply`, explicit tools) | 1 / round-trip | 100 |
| Image generation (`generateImage`) | 2 | 200 |
| Document text conversion (`convertDocumentText`) | 2 | 200 |
| Summarization (`summarizeText`) | 1 | 100 |
| Embeddings (`generateEmbedding`) | 1 / 50,000 chars | 100 / 50,000 chars |
| Wiki LLM / sync, memory write/heal | 1 each | 100 each |
| Agent turn, per internal tool-call loop iteration (cap 5) | 1 (max 5) | 100 (max 500) |
| Live voice connect + per 60s | 5 + 5/60s | 500 + 500/60s |
| Scheduler trigger | 1 | 100 |
| `browser_action` (voice path) | 1 | 100 |

Live voice connect gate raised to **≥ 500**, enforced in both client (`useLiveVoiceChat`) and server (cloud-agent `/agent/live`).

Refund logic is unaffected: `spendCredits` allocations and `refundCredit` operate on amounts, and `charge.refunded` proration is ratio-based.

### Touched surfaces

- `functions/src/` — cost/grant constants in `generateReply`, `generateImage`, `convertDocumentText`, `summarizeText`, `generateEmbedding`, `wikiLlm`, `wikiSync`, memory callables, `stripeWebhook`, `revenueCatWebhook`, `subscriptionService`.
- `cloud-agent/` — per-iteration spend, live-voice billing controller (500/60s), connect gate, scheduler trigger, `browser_action` billing.
- `src/` — client-side gate checks and any client constants mirroring costs.
- Bootstrap/`exchangeToken` credits payload — add `grantedTotal` (`SUM(initial_amount)` over live rows: `remaining_balance > 0` and not expired) to power the meter denominator.
- `docs/billing-and-credits.md` — cost tables rewritten in new units with a note: *user-facing name is "Power"*.

### Deploy order

1. Run SQL migration (balances ×100).
2. Deploy Functions + cloud-agent (new constants).
3. Publish app update / OTA (Power meter UI).

Between steps 1 and 2, old server code spends old-unit amounts against inflated balances (users undercharged ~99% per action). Accepted: window is minutes and there are no users. No compatibility flag needed.

---

## 2. Terminology

- All user-facing strings: "Credits" → "Power". Includes badge/meter, subscribe screen, purchase copy, error messages, accessibility labels.
- No database, table, column, function, or service renames. `credit_transactions`, `creditService`, `getUserCredits` etc. all keep their names.
- **Frontend boundary rule:** new and modified frontend components, props, and interfaces use `power*` naming. The credit→power translation is isolated to a single hook, `usePowerBalance` (wraps `useUserCredits` + `useAuthCredits`, returns `{ totalPower, grantedPower, rawFill, barFill, band, isLoading }`). `useCurrentPlan` stays owned by `PowerMeter`. Existing hooks keep their names; components consume only the new hook.

---

## 3. Power Meter Component

New `PowerMeter` component replaces the contents of `CreditCounterIcon` in the same header slot (upper right). Still a `Pressable` navigating to `/(drawer)/subscribe`.

### Fill computation

Capacity is **server-derived**: the bootstrap credits payload adds `grantedTotal = SUM(initial_amount)` of the user's **live** credit rows — `remaining_balance > 0` AND not expired — alongside the existing balance. No client-side capacity constants table.

The `remaining_balance > 0` filter is required: exhausted rows must drop out of the denominator even if unexpired (`expires_at` NULL or future), otherwise non-expiring rows (signup, manual grants) and repeat pack purchases inflate the denominator forever — ten exhausted 10,000-Power packs would make a fresh pack render as 10% full. The denominator reflects only the pools the user is currently drawing from.

**Accepted artifact:** when a row is fully drained it leaves the denominator and fill recomputes upward (e.g. signup 5,000 + pack 10,000: pack exhausts → fill jumps 33% → 100%). Jump direction is always upward ("good news"), expiring pools are spent first (`expires_at NULLS LAST`), and quantization smooths small cases — acceptable.

```text
rawFill   = grantedTotal > 0 ? min(totalCredits / grantedTotal, 1) : 0
barFill   = round(rawFill * 20) / 20            // quantize bar width to 5% steps
if (totalCredits > 0 && barFill === 0) barFill = 0.03   // minimum visible sliver
band      = rawFill >= 0.20 ? normal : rawFill >= 0.05 ? amber : red   // bands use rawFill, not barFill
```

- **Capacity semantics:** fill = remaining/granted across active rows. Meter reads full at any grant (signup, monthly renewal, pack) and drains smoothly — no overfill peg. Works for every tier and pack combination with no client knowledge of plan amounts.
- **Zero-state guard:** while `totalCredits > 0`, the bar never renders fully empty — a minimum sliver (~3%) stays visible so a usable balance never looks dead.
- **Bands from rawFill:** color thresholds (20% / 5%) are computed from the unquantized ratio so amber/red trigger accurately despite the coarse bar.
- **Coarse updates:** with quantization, a single 100-Power message against a 30,000 grant moves the bar zero visual steps; the bar changes only after ~5% of granted Power is consumed.

### Visual

- Horizontal battery/bolt-style bar, styled via react-native-paper theme.
- Color bands: theme primary at fill ≥ 20%; amber at 5–20%; red < 5%.
- **No numeric balance in the header.** Exact Power number and refill info live on the subscribe screen only.

### States

- Loading (plan or credits loading): dimmed meter, accessibility label "Power loading".
- Loaded: accessibility label "Power at N%" plus ", refills monthly" for subscribers.

---

## 4. Soft Low-Power UX, Cost Desurfacing, Refill Framing

### Low-power progression

| Band | Trigger | Behavior |
|---|---|---|
| Amber | fill 5–20% | One gentle snackbar/banner per session: "Power getting low" + recharge link. Non-blocking. |
| Red | fill < 5% | Inline hint in composer: "Low Power — recharge to keep chatting." Shown before a send can fail. |
| Empty | insufficient balance on action | Friendly "Out of Power" message with recharge CTA. Raw insufficient-credit error text never shown to the user. |

### Cost desurfacing

Audit `ChatComposer` (native + web), `ChatView`, and subscribe screen for any "this costs N credits" copy and remove it. Per-action costs (in Power units) appear only in a single pricing-info section of the subscribe screen.

### Refill framing

Subscribe screen copy sells capacity + refill: "30,000 Power, refills every month." If `subscription.currentPeriodEnd` is available client-side, show the next refill date on the subscribe screen; otherwise omit the date for v1 and keep the "refills monthly" text.

---

## 5. Error Handling

- Migration is a single idempotent-by-inspection statement; run once, verify, no retry logic needed. Verify by comparing `SUM(remaining_balance)` before/after (×100).
- Client tolerates transitional states: if `grantedTotal` is missing or 0 (stale client cache, transitional bootstrap), meter renders the loading/dimmed state rather than a false empty bar.
- All existing spend/refund/insufficient-balance paths unchanged in structure — only constants and user-facing copy change.

---

## 6. Testing

- **Migration:** on local docker Postgres (`migrate:dev` + `seedLocal.ts`), assert every row's `initial_amount`/`remaining_balance` is ×100 and totals match.
- **PowerMeter unit tests:** quantization steps, band thresholds at rawFill boundaries (5%, 20%), minimum-sliver guard (balance > 0 never renders empty), full-at-grant behavior (remaining == granted), missing `grantedTotal` fallback, loading state, accessibility labels.
- **Backend:** `grantedTotal` computation over live rows — excludes expired rows AND exhausted (`remaining_balance = 0`) rows; covers signup + subscription + pack mixes and the upward-jump-on-exhaustion case.
- **Functions tests:** updated cost/grant constants across existing credit-flow tests (mechanical sweep); webhook grant amounts (5,000 / 30,000 / 10,000).
- **Voice gate:** client + server tests assert ≥ 500 connect gate.
- **Copy audit test-pass:** grep-level check that no user-facing "credit" strings remain in chat surfaces.

---

## Appendix A — Free Daily "Energy" (exploratory, NOT in scope)

Research retained for a possible future free daily recharging grant. The name **"Energy"** is reserved for this feature because mobile-app convention leads users to expect "Energy" to recharge over time, whereas "Power" (the paid unit) carries no recharge expectation.

### Model options for a free plain-text lane

`generateReply` uses the standard `@google/genai` `generateContent` shape (currently `gemini-3.5-flash`, thinking budget 0) — any Gemini model is a drop-in string change.

| Model | $/1M tokens in / out (July 2026) | Notes |
|---|---|---|
| gemini-3.5-flash (current) | 1.50 / 9.00 | Paid-lane quality; ~$0.006 per typical turn |
| gemini-3.1-flash-lite | 0.25 / 1.50 | ~$0.001/turn |
| gemini-2.5-flash-lite | 0.10 / 0.40 | ~$0.0003/turn; cheapest viable |

Typical turn ≈ 2K input tokens (persona + history) + 300 output. At 25 free texts/day × 1,000 DAU: 2.5-flash-lite ≈ $8/day; 3.1-flash-lite ≈ $25/day; 3.5-flash ≈ $150/day.

### Candidate designs

1. **Daily expiring credit grant** — grant N credits as a `credit_transactions` row with `expires_at` +24h, lazily on first activity of the day. Reuses existing spend/expiry machinery (`expires_at NULLS LAST` already spends expiring credits first). Full quality (normal 3.5-flash lane), simplest code, highest cost exposure.
2. **Cheap-model free lane** — plain-text-only path on a flash-lite model, N/day per-user counter, billing bypassed. Cheapest, but a second model path to maintain and a visible quality gap on the free tier.

### Viral cost controls (defense in depth)

1. Per-user daily cap (the grant/counter itself is the primary limiter).
2. Global kill switch: Remote Config / env flag checked in `generateReply`; flips free lane off, falls back to paid Power.
3. GCP budget alert → Pub/Sub → Cloud Function auto-flips the kill switch at a daily spend threshold.
4. Vertex per-model quota ceilings in console as a hard backstop.
5. `maxOutputTokens` bounded, thinking budget 0 on the free lane.
6. Free lane gated to verified accounts to blunt bot farming.
