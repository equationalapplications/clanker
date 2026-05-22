# Credits Model Redesign

**Date:** 2026-05-21  
**Status:** Implemented

## Overview

Remove the concept of "unlimited" credits from Clanker. The `monthly_20` subscription plan now grants 300 credits per billing cycle instead of bypassing credit consumption entirely. All features previously gated to premium subscribers only are now open to any user with sufficient credits. Credits expire after 31 days (except free signup credits, which never expire).

Credit consumption uses a **decrementing balance model**: each credit grant row tracks its own `remaining_balance`, and spending decrements that row directly. This keeps queries fast, expiration precise, and enables per-transaction refunds when downstream APIs fail.

> **Breaking architecture change.** This redesign touches every layer of the stack simultaneously. All six areas below must ship together — a partial deploy leaves the system in an inconsistent state.
>
> | Area | Nature of break |
> |---|---|
> | **DB schema** | `credit_transactions` gains `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at`; `subscriptions` gains `next_expiry_date`. Existing rows require backfill before backend deploys. |
> | **`creditService`** | `getCredits`, `addCredits`, and `spendCredits` all change call signatures or return types. New `refundCredit` function added. Any caller of these functions must be updated. |
> | **Webhook handlers** | `stripeWebhook.ts` and `revenueCatWebhook.ts` change how subscription renewals are processed — now expire old credits before granting new ones. Idempotency guard ordering is a hard requirement (see § What Does Not Change). |
> | **Callable gating** | `generateImage.ts`, `generateReply.ts`, `generateVoiceReply.ts`, `characterFunctions.ts`, `documentExtract.ts`, `memoryFunctions.ts` — all replace tier-check guards with `spendCredits` / `refundCredit`. The `UNLIMITED_TIERS`, `PREMIUM_TIERS`, `hasUnlimited` constants are deleted. |
> | **Frontend credit utilities and UI** | `getUserCredits.ts`, `useAuthSnapshot.ts`, `ChatView.tsx`, `useVoiceChat.ts`, `CreditCounterIcon.tsx`, `CreditsDisplay.tsx`, `constants.ts` — all remove unlimited-state logic. UI switches from plan-tier gates to balance-only gates. |
> | **Tests** | Any test that stubs `hasUnlimited`, `isUnlimited`, tier membership, or the old `spendCredits` / `addCredits` signatures must be rewritten. Tests that mock webhook handlers must cover the idempotency-before-write ordering and the expiration `UPDATE` path. |

---

## Credit Model Rules

| Plan | Price | Credits Granted | Expiry |
|---|---|---|---|
| Free (signup) | $0 | 50 | Never (`expires_at = NULL`) |
| One-time pack | $10 | 100 | 31 days from purchase |
| Monthly subscription | $20/mo | 300 per renewal cycle | At next billing cycle end |
| Monthly $50 | — | Reserved, not active | — |

**Key rules:**

- No unlimited bypass. Every server-side feature call costs credits. Voice replies cost 2 credits; all other features cost 1 credit.
- Free signup credits: `expires_at = NULL`. Never expire regardless of account activity.
- Subscription renewal: grant 300 new credits with `expires_at = billing_cycle_end`. Previous subscription-cycle credits expire immediately — targeted by `transaction_type = 'subscription'` so one-time credits are never touched.
- One-time purchase: add 100 credits with `expires_at = NOW() + 31 days`.
- Separate pools (subscription vs one-time) tracked independently via `transaction_type` and `expires_at` per `credit_transactions` row.
- Spend order: earliest-expiring grant first (`ORDER BY expires_at NULLS LAST ASC`). Free credits (`expires_at = NULL`) spent last.
- Credit costs: voice replies = 2 credits; all other features = 1 credit. Since the max cost per action is 2, `spendCredits` always finds a single row with sufficient `remaining_balance` — no cross-row splitting required.
- **Known limitation (accepted for MVP):** If a user has 1 credit in an expiring pool and ≥ 2 credits in a non-expiring or later-expiring pool, `spendCredits` skips the expiring pool (insufficient balance for a 2-credit feature) and spends from the other pool. That single credit becomes "trapped" — it expires unused if the user only invokes 2-credit features before that pool expires. Accepted behavior: the trapped credit remains usable for any 1-credit feature, and cross-row splitting is explicitly out of scope for this release.
- Local inference (future feature): client handles AI call on-device and never calls `spendCredits`. No credits consumed. No code change required — credit deduction is explicit/opt-in per callable.

---

## Feature Gate Changes

All features previously restricted to `monthly_20`/`monthly_50` plan tiers are now open to any user with sufficient credits. Cost is 1 credit per use except voice replies (2 credits).

| Feature | Previous gate | New gate |
|---|---|---|
| Chat replies | Free for `UNLIMITED_TIERS`, 1 credit otherwise | 1 credit for all |
| Voice replies | Free for `UNLIMITED_TIERS`, 2 credits otherwise | 2 credits for all |
| Image generation | Free for `UNLIMITED_TIERS`, 1 credit otherwise | 1 credit for all |
| Cloud character save/sync | Blocked unless `CLOUD_CHARACTER_ALLOWED_PLANS` | 1 credit per use |
| Document ingestion | Blocked unless `PREMIUM_TIERS` | 1 credit per use |
| Memory / wiki | `hasUnlimited` bypass | 1 credit per use |

---

## Database Schema Changes

### `credit_transactions` — updated schema

```sql
ALTER TABLE credit_transactions
  ADD COLUMN initial_amount     INT          NOT NULL,
  ADD COLUMN remaining_balance  INT          NOT NULL,
  ADD COLUMN transaction_type   VARCHAR(50)  NOT NULL,  -- 'signup' | 'subscription' | 'one_time' | 'legacy'
  ADD COLUMN expires_at         TIMESTAMPTZ;

-- Existing rows backfill:
-- initial_amount = delta, remaining_balance = delta, transaction_type = 'legacy', expires_at = NULL
```

`remaining_balance` is decremented in place when credits are spent. `initial_amount` is immutable — used for audit and partial-refund validation.

### `subscriptions` — add cache column

```sql
ALTER TABLE subscriptions ADD COLUMN next_expiry_date TIMESTAMPTZ;
-- Set to the earliest expires_at across rows where remaining_balance > 0 AND (expires_at IS NULL OR expires_at > NOW()).
-- Must exclude zero-balance rows: a depleted pool's expires_at must not trigger "credits expiring soon" in the UI.
-- Allows frontend to display "your credits expire on X" without querying credit_transactions.
```

`currentCredits` remains as a fast-read cache, synced by `creditService` on every write.

### Migration at launch

1. Deploy schema migration: add `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at` columns. Backfill existing rows with `initial_amount = delta`, `remaining_balance = delta`, `transaction_type = 'legacy'`, `expires_at = NULL`.
2. For any active `monthly_20` subscribers: run admin script to expire old credits (`UPDATE credit_transactions SET expires_at = NOW() WHERE user_id = ? AND transaction_type IN ('legacy','subscription') AND expires_at > NOW()`) and call `addCredits(userId, 300, billing_cycle_end, 'subscription')`.
3. For existing users with `currentCredits > 0` but no matching `credit_transactions` rows (i.e., credits seeded via the old direct-INSERT path): backfill one `credit_transactions` row per user with `initial_amount = currentCredits`, `remaining_balance = currentCredits`, `transaction_type = 'legacy'`, `expires_at = NULL`.
4. Deploy backend with `UNLIMITED_TIERS` / `PREMIUM_TIERS` gates removed.

---

## Backend Changes

### `creditService` (`functions/src/services/creditService.ts`)

- **`getCredits(userId)`**: `SUM(remaining_balance)` from `credit_transactions` where `expires_at IS NULL OR expires_at > NOW()`. Sync result to `subscriptions.currentCredits`.

- **`addCredits(userId, amount, expiresAt, transactionType)`**: insert row with `initial_amount = amount`, `remaining_balance = amount`, `expires_at`, `transaction_type`. Update `subscriptions.currentCredits` and `subscriptions.next_expiry_date` caches. `expiresAt = null` means never expires (used for signup grants).

- **Signup credit seeding**: `subscriptionService.getOrCreateDefaultSubscription()` currently sets `subscriptions.currentCredits = 50` via direct INSERT with no `credit_transactions` row. This path must be updated to also call `addCredits(userId, 50, null, 'signup')` after the subscription row is created. The DB trigger `handle_new_user()` has the same gap and must be updated to insert a matching `credit_transactions` row (`initial_amount = 50`, `remaining_balance = 50`, `transaction_type = 'signup'`, `expires_at = NULL`).

- **`spendCredits(userId, amount)`**: within a DB transaction —
  1. `SELECT ... FOR UPDATE` on the earliest-expiring row where `remaining_balance >= amount` and `(expires_at IS NULL OR expires_at > NOW())`.
  2. Decrement `remaining_balance` by `amount`.
  3. Update `subscriptions.currentCredits` cache.
  4. **Return the `transactionId`** of the decremented row (callers use this for refunds).
  5. Return `null` if no qualifying row found (insufficient credits).

- **`refundCredit(userId, transactionId, amount)`** _(new)_: within a DB transaction —
  1. Increment `remaining_balance` atomically: `UPDATE credit_transactions SET remaining_balance = remaining_balance + $1 WHERE id = $2`. Never read-then-write a cached value — concurrent spends between the read and the write would be silently overwritten.
  2. Update `subscriptions.currentCredits` cache.
  3. Credits are restored to their exact original pool — `expires_at` unchanged, no extension granted.

### Callables

Callables that invoke expensive external APIs (Vertex AI, etc.) must follow the **spend → execute → catch/refund** pattern. Credit is deducted before the API call; if the API fails, the credit is returned to the same grant row.

| File | Change |
|---|---|
| `generateImage.ts` | 1. Call `spendCredits(userId, 1)`. If `null`, throw `failed-precondition`. 2. Capture `txId`. 3. Call image generation API. 4. On API failure: `refundCredit(userId, txId, 1)`, throw `internal` to client. |
| `generateReply.ts` | Remove `UNLIMITED_TIERS`, `hasUnlimited`. 1. `spendCredits(userId, 1)`. If `null`, throw `failed-precondition`. 2. Capture `txId`. 3. Call LLM API. 4. On failure: `refundCredit(userId, txId, 1)`, throw `internal`. |
| `generateVoiceReply.ts` | 1. `spendCredits(userId, 2)`. If `null`, throw `failed-precondition`. 2. Capture `txId`. 3. Call TTS API. 4. On failure: `refundCredit(userId, txId, 2)`, throw `internal`. |
| `characterFunctions.ts` | Replace `CLOUD_CHARACTER_ALLOWED_PLANS` tier check with `spendCredits` call. Refund on failure. |
| `documentExtract.ts` | Replace `PREMIUM_TIERS` tier check with `spendCredits` call. Refund on failure. |
| `memoryFunctions.ts` | Remove `hasUnlimited` bypass. Spend 1 credit per use. Refund on failure. |
| `constants/plans.ts` | Delete file. `PREMIUM_TIERS` no longer referenced anywhere. |

### Webhooks

**`stripeWebhook.ts`:**
- `checkout.session.completed` (subscription): the session object does not expose `current_period_end` — must call `await stripe.subscriptions.retrieve(subscriptionId)` to get `sub.current_period_end` (Unix timestamp). Then call `addCredits(userId, 300, new Date(sub.current_period_end * 1000), 'subscription')`.
- `customer.subscription.updated` (renewal): `sub.current_period_end` is already on the Stripe `Subscription` object in scope. Expire previous subscription credits — `UPDATE credit_transactions SET expires_at = NOW() WHERE user_id = ? AND transaction_type = 'subscription' AND expires_at > NOW()` — then call `addCredits(userId, 300, new Date(sub.current_period_end * 1000), 'subscription')`.
- `invoice.payment_succeeded` (renewal fallback): if used for renewal credit grants, retrieve the associated subscription via `invoice.subscription` and read `current_period_end` from it.
- `checkout.session.completed` (credit pack): call `addCredits(userId, 100, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000), 'one_time')`.
- `charge.refunded`: deduct credits as before.
- `customer.subscription.deleted`: no credit action — subscription credits expire naturally at their `expires_at`.

**`revenueCatWebhook.ts`:**
- `INITIAL_PURCHASE` / `RENEWAL` (subscription): `next_renewal_date` is available as `event.next_renewal_date` (ISO string) in the RevenueCat webhook payload. Expire previous subscription credits — `UPDATE credit_transactions SET expires_at = NOW() WHERE user_id = ? AND transaction_type = 'subscription' AND expires_at > NOW()` — then call `addCredits(userId, 300, new Date(event.next_renewal_date), 'subscription')`.
- `NON_RENEWING_PURCHASE` (credit pack): call `addCredits(userId, 100, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000), 'one_time')`.
- `EXPIRATION`: no credit action — credits expire via their own `expires_at`.
- `CANCELLATION`: no credit action — credits remain until their `expires_at`.

---

## Frontend Changes

### Remove `hasUnlimited` / `isUnlimited`

| File | Change |
|---|---|
| `getUserCredits.ts` | Remove `hasUnlimited`, `isUnlimited`, `SUBSCRIPTION_TIERS`. Return only `totalCredits`. |
| `useAuthSnapshot.ts` | Remove `hasUnlimited` field. |
| `ChatView.tsx` | Remove `hasUnlimited` guard. Gate only on `credits <= 0`. |
| `useVoiceChat.ts` | Update low-credit message: remove "subscribe for unlimited" → "purchase more credits". Voice requires ≥ 2 credits; update insufficient-credits check accordingly. |
| `CreditCounterIcon.tsx` | Remove "Premium subscriber, unlimited credits" tooltip. |
| `CreditsDisplay.tsx` | Remove `unlimitedContainer`, `unlimitedChip`, "You have unlimited credits" UI. Show credit balance + `next_expiry_date` sourced from the auth subscription snapshot (already available via `useAuthSnapshot`). |
| `constants.ts` | Remove `SUBSCRIPTION_TIERS`. Keep `PLAN_TIERS`. |

### Pages

| Page | Change |
|---|---|
| `app/(drawer)/subscribe.tsx` | Rewrite: "300 credits/month for $20" or "100 credits for $10". Remove unlimited language. Show credit expiry info. |
| `app/(drawer)/accept-terms.tsx` | Remove unlimited references. Update credit model description. |
| `app/index.web.tsx` (landing) | Update marketing copy. Remove unlimited. Explain credit model. |
| `app/terms.tsx` | Update ToS: credit expiry policy, no unlimited tier. |
| `app/privacy.tsx` | Update any credit-related language. |

---

## Documentation Changes

All files in `docs/` must be updated to remove references to "unlimited credits", "credits not consumed for subscribers", "premium only", and "credits never expire".

| File | Change |
|---|---|
| `PAYMENT_INTEGRATION.md` | Remove "unlimited credits at $20/month". Update webhook event→action mapping. Remove "credits not consumed if user has monthly subscription" and "credits never expire". |
| `PAYMENT_API.md` | Update product descriptions. Remove unlimited language. |
| `FIRST_LOGIN_CREDITS.md` | Note free credits have `expires_at = NULL` (never expire). Note `transaction_type = 'signup'`. |
| All other docs | Grep for "unlimited", "premium only", "monthly subscription" — update each occurrence. |

**In-app content:**

| Location | Change |
|---|---|
| `app/support.tsx` | Update FAQ entries referencing unlimited or premium-only features. |
| Any FAQ content | Explain: 300 credits/month subscription ($20), 100 credits one-time ($10), 31-day expiry for paid credits, free credits never expire, all features open to anyone with credits. |

---

## What Does Not Change

- `planTier` column and plan tier values (`free`, `monthly_20`, `monthly_50`, `payg`) remain in DB schema — used for billing/webhook routing.
- Idempotency logic on `creditTransactions` remains unchanged — but the idempotency check (verify `stripe_event_id` / RevenueCat event ID has not been processed) **must execute before any DB writes begin**, including the `UPDATE` that expires old subscription credits. A duplicate webhook that reaches the expiration `UPDATE` before the idempotency guard runs could expire newly-granted credits if the timing is slightly off. Guard first, write second, unconditionally.
- Provider-side refunds (Stripe, Apple, Google Play) remain handled by webhooks, not client.
- `monthly_50` plan remains reserved and inactive.
- Admin credit adjustment functions remain unchanged.
