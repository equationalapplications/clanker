# Credit Improvements — Design Spec

**Date:** 2026-07-01  
**Status:** Implemented  
**PR:** #506  
**Plan:** `docs/superpowers/plans/2026-07-01-credit-improvements.md`  
**Supersedes:** § Credit Model Rules in `2026-05-21-credits-model-redesign.md` (cross-row splitting limitation)

---

## Overview

Five targeted fixes to the shared credit system: correct multi-credit spends when balances are fragmented across `credit_transactions` rows, remove an unused client-controlled spend callable, reconcile two billing policy contradictions between code and docs, and consolidate per-action credit costs into a single documentation table.

**Problem:** `creditService.spendCredits` (Firebase Functions) passed a net-balance check, then selected **one** row with `remaining_balance >= amount`. When a user's balance was fragmented (e.g. 1 signup credit + 1 subscription credit, net = 2), no single row held 2, so `generateVoiceReply` (amount = 2) spuriously returned `null` → "Insufficient credits" despite sufficient net balance.

**Scope:** Functions `creditService`, dead callable removal, cloud-agent billing policy alignment, billing documentation. Cloud-agent `spendCredit` is **not** modified — it only ever spends 1, which cannot fragment.

---

## Product Decisions (locked in)

| # | Topic | Decision |
|---|---|---|
| 2 | `browser_action` `EXECUTION_TIMEOUT` | **No refund** — extension connected and burned compute; aligns with `SELECTOR_NOT_FOUND` and `docs/billing-and-credits.md` |
| 4 | Live-voice connect gate | **Require ≥ 2 credits** — raise server gate to match client (`useLiveVoiceChat`) and `docs/real-time-voice-chat.md` |

---

## 1. Multi-Row Spend (`spendCredits`)

### Algorithm

After the existing net-balance check passes under the `subscriptions` row lock:

1. Select all active rows with `remaining_balance > 0`, ordered by `expires_at NULLS LAST`, then `id` (deterministic tiebreaker).
2. Lock rows `FOR UPDATE`.
3. Loop rows, deducting `min(row.remaining_balance, remaining)` per row until `amount` is satisfied or rows exhausted.
4. Early-exit when `remaining <= 0` to avoid no-op `UPDATE ... - 0` on trailing locked rows.
5. Return `allocations` — an array of `{ transactionId, amount }` for each row debited.

If net balance was sufficient under lock but rows could not cover the amount, log a warning and throw `InsufficientCreditsError` (should be unreachable given the net check).

### Refund contract

- `spendCredits` returns `CreditSpendAllocation[] | null` — one entry per row debited, with amounts summing to the spent total.
- `refundCredit(userId, allocations)` restores each row by its debited `amount`.
- Multi-row spends are fully reversible: credits return to the exact rows they were taken from.

### What changes

| File | Change |
|---|---|
| `functions/src/services/creditService.ts` | Replace single-row `gte(remainingBalance, amount).limit(1)` with multi-row loop |
| `functions/src/services/creditService.test.ts` | Add fragmented-balance test; extend single-row mock for `orderBy().for()` chain |

### What does NOT change

- Cloud-agent `spendCredit` — fixed 1-credit spends only
- Wiki/memory/character callers — still pass through allocations to `refundCredit` on failure

---

## 2. Remove Dead `spendCredits` Callable

`functions/src/spendCredits.ts` deployed an `onCall` that trusted a client-supplied `amount` with no call site in `src/` or `app/`. Security surface with no product value.

### Changes

| Action | Path |
|---|---|
| Delete | `functions/src/spendCredits.ts` |
| Delete | `functions/src/spendCredits.test.ts` |
| Modify | `functions/src/index.ts` — remove export |
| Modify | `src/config/firebaseConfig.ts` — remove `spendCreditsFn` const + export |
| Modify | `src/config/firebaseConfig.web.ts` — remove `spendCreditsFn` const + export |
| Modify | `__tests__/getUserCredits.test.ts` — remove mock `spendCreditsFn` |

`creditService.spendCredits(...)` service method and all server-side call sites remain.

---

## 3. `browser_action` EXECUTION_TIMEOUT — No Refund

In `cloud-agent/src/tools/browserAction.ts`, the 30s `EXECUTION_TIMEOUT` branch must **not** call `refundCredit`. The extension connected and attempted the task.

**Unchanged:** `EXTENSION_OFFLINE` (12s wake timeout, extension never connected) still refunds.

---

## 4. Live-Voice Connect Gate ≥ 2

In `cloud-agent/src/handlers/wsLiveAgentHandler.ts` `handleAuthMessage`:

```typescript
if (balance < 2) {
  // INSUFFICIENT_CREDITS, ws.close(4402, ...)
}
```

Replaces `balance <= 0`. Error code, message, and close code unchanged.

**Test:** `balance === 1` → rejected with 4402; `balance === 0` → rejected (existing test); `balance >= 2` → accepted.

---

## 5. Credit Consumption Documentation

Add a **Credit Consumption** table to `docs/billing-and-credits.md` immediately after `### Refunds`, consolidating costs previously scattered across `ai-and-chat.md`, `edge-agent.md`, `architecture-and-data.md`, `real-time-voice-chat.md`, and in-code-only voice = 2.

| Action | Path | Cost | Refund on failure |
|---|---|---|---|
| Text chat reply | `generateReply` (Functions) | 1 / round-trip (incl. tool rounds) | Yes |
| Image generation | `generateImage` | 1 | Yes |
| Document text conversion | `convertDocumentText` | 1 | Yes |
| Wiki LLM / sync, memory write/heal | `wikiLlm`, `wikiSync`, `memoryWrite`, `memoryHeal` | 1 each | Yes |
| Agent turn (text) | cloud-agent `POST /agent/run` | 1 / turn (flat) | Yes |
| Live voice | cloud-agent `/agent/live` | 1 / 60s timer | Partial minute not billed |
| Scheduler trigger | cloud-agent scheduler-trigger | 1 (deduped) | Yes |
| `browser_action` tool | contextual | Voice: 1; Text: pre-billed (skipped) | See Browser Action Billing |

Note the intentional edge-vs-cloud difference: Firebase text/chat charges per round-trip; cloud-agent charges flat 1 per turn.

Existing **Browser Action Billing** `Refunds:` line already lists `EXECUTION_TIMEOUT` under no-refund — no wording change required after Task 3.

---

## Implementation Notes (post-ship)

- **`id` tiebreaker:** `ORDER BY expires_at NULLS LAST, id` added during implementation for deterministic spend order when expiry values tie.
- **Allocations-based refunds:** During implementation, `firstTouchedId` was replaced with per-row `CreditSpendAllocation[]` so `refundCredit` restores exact rows rather than collapsing to the earliest bucket.
- **Test fixture hygiene:** Functions test mocks updated with `expoPushToken: null` after `users.expo_push_token` was added to schema (`generateImage`, `generateReply`, `generateVoiceReply`, `wikiLlm`, `wikiSync`, `exchangeToken` tests).

---

## Verification

| Suite | Command | Expected |
|---|---|---|
| Functions | `cd functions && npm run typecheck && npm run lint && npm test` | 299/299 pass |
| Cloud-agent | `cd cloud-agent && npm run typecheck && npm test` | 198/198 pass (1 skipped live test) |
| Root | `npm run typecheck && npm run lint` | pass |

**Regression checks:**

- Fragmented balance (2×1-credit rows) → `spendCredits(userId, 2)` succeeds, both rows decremented
- `spendCreditsFn` / `spendCreditsHandler` / `./spendCredits` — no references in `functions/src`, `src`, `app`
- `EXECUTION_TIMEOUT` — no `refundCredit` call; `EXTENSION_OFFLINE` — refund preserved
- Live voice `balance 1` → 4402; `balance 0` → 4402
