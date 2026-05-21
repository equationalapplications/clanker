# Credits Model Redesign

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Remove the concept of "unlimited" credits from Clanker. The `monthly_20` subscription plan now grants 300 credits per billing cycle instead of bypassing credit consumption entirely. All features previously gated to premium subscribers only are now open to any user with sufficient credits. Credits expire after 31 days (except free signup credits, which never expire).

---

## Credit Model Rules

| Plan | Price | Credits Granted | Expiry |
|---|---|---|---|
| Free (signup) | $0 | 50 | Never (`expires_at = NULL`) |
| One-time pack | $10 | 100 | 31 days from purchase |
| Monthly subscription | $20/mo | 300 per renewal cycle | At next billing cycle end |
| Monthly $50 | — | Reserved, not active | — |

**Key rules:**

- No unlimited bypass. Every server-side feature call costs ≥ 1 credit.
- Free signup credits: `expires_at = NULL`. Never expire regardless of account activity.
- Subscription renewal: grant 300 new credits with `expires_at = billing_cycle_end`. Previous subscription-cycle credits expire immediately (no rollover).
- One-time purchase: add 100 credits with `expires_at = NOW() + 31 days`.
- Separate pools (subscription vs one-time) are tracked independently via `expires_at` per `credit_transactions` row.
- Spend order: earliest-expiring first (`ORDER BY expires_at NULLS LAST ASC`). Free credits (NULL expiry) spent last.
- Local inference (future feature): client handles AI call on-device and never calls `spendCredits`. No credits consumed. No code change required — credit deduction is already explicit/opt-in per callable.

---

## Feature Gate Changes

All features previously restricted to `monthly_20`/`monthly_50` plan tiers are now open to any user with `currentCredits >= 1`. Cost per use remains 1 credit.

| Feature | Previous gate | New gate |
|---|---|---|
| Chat replies | Free for `UNLIMITED_TIERS`, 1 credit otherwise | 1 credit for all |
| Voice replies | Same | Same |
| Image generation | Same | Same |
| Cloud character save/sync | Blocked unless `CLOUD_CHARACTER_ALLOWED_PLANS` | 1 credit per use |
| Document ingestion | Blocked unless `PREMIUM_TIERS` | 1 credit per use |
| Memory / wiki | `hasUnlimited` bypass | 1 credit per use |

---

## Database Schema Changes

### `credit_transactions` — add column

```sql
ALTER TABLE credit_transactions ADD COLUMN expires_at TIMESTAMPTZ;
-- NULL = never expires
-- Existing rows: backfill NULL (all current credits become non-expiring)
```

### `subscriptions.currentCredits` — remains as denormalized cache

Kept for fast reads. Must be synced by `creditService` on every write. Feature gate checks recompute from `credit_transactions` for accuracy.

### Migration at launch

1. Deploy schema migration: add `expires_at` column (nullable), existing rows get `NULL`.
2. For any active `monthly_20` subscribers: run admin script to expire old credits and grant 300 new credits with `expires_at = billing_cycle_end`.
3. Deploy backend with `UNLIMITED_TIERS` / `PREMIUM_TIERS` gates removed.

---

## Backend Changes

### `creditService` (`functions/src/services/creditService.ts`)

- **`getCredits(userId)`**: query `SUM(delta)` from `credit_transactions` where `expires_at IS NULL OR expires_at > NOW()`. Sync result to `subscriptions.currentCredits`.
- **`spendCredits(userId, amount)`**: within a DB transaction — verify effective balance ≥ amount; deduct from earliest-expiring rows first (`ORDER BY expires_at NULLS LAST ASC`); update `subscriptions.currentCredits` cache. Return `false` if insufficient.
- **`addCredits(userId, amount, expiresAt?)`**: insert `credit_transactions` row with `expires_at`. Update `subscriptions.currentCredits` cache.

### Callables

| File | Change |
|---|---|
| `generateReply.ts` | Remove `UNLIMITED_TIERS`, `hasUnlimited`. Always spend 1 credit. |
| `generateVoiceReply.ts` | Same. |
| `generateImage.ts` | Same. |
| `characterFunctions.ts` | Replace `CLOUD_CHARACTER_ALLOWED_PLANS` tier check with `currentCredits >= 1` check. Spend 1 credit on use. |
| `documentExtract.ts` | Replace `PREMIUM_TIERS` tier check with `currentCredits >= 1` check. Spend 1 credit on use. |
| `memoryFunctions.ts` | Remove `hasUnlimited` bypass. Always spend credits. |
| `constants/plans.ts` | Delete file. `PREMIUM_TIERS` no longer referenced. |

### Webhooks

**`stripeWebhook.ts`:**
- `checkout.session.completed` (subscription): call `addCredits(userId, 300, billingCycleEnd)`.
- `customer.subscription.updated` / `invoice.payment_succeeded` (renewal): expire existing subscription-cycle credits (set `expires_at = NOW()` on relevant rows), grant 300 new credits with `expires_at = new billing_cycle_end`.
- `checkout.session.completed` (credit pack): call `addCredits(userId, 100, NOW() + 31 days)`.
- `charge.refunded`: deduct credits as before.
- `customer.subscription.deleted`: no credit action — credits expire naturally at their `expires_at`.

**`revenueCatWebhook.ts`:**
- `INITIAL_PURCHASE` / `RENEWAL` (subscription): expire previous subscription-cycle credits, grant 300 with `expires_at = next_renewal_date`.
- `NON_RENEWING_PURCHASE` (credit pack): grant 100 credits with `expires_at = NOW() + 31 days`.
- `EXPIRATION`: no credit action needed — credits expire via their own `expires_at`.
- `CANCELLATION`: no credit action — credits remain until their `expires_at`.

---

## Frontend Changes

### Remove `hasUnlimited` / `isUnlimited`

| File | Change |
|---|---|
| `getUserCredits.ts` | Remove `hasUnlimited`, `isUnlimited`, `SUBSCRIPTION_TIERS`. Return only `totalCredits`. |
| `useAuthSnapshot.ts` | Remove `hasUnlimited` field. |
| `ChatView.tsx` | Remove `hasUnlimited` guard. Gate only on `credits <= 0`. |
| `useVoiceChat.ts` | Update low-credit message: remove "subscribe for unlimited" → "purchase more credits". |
| `CreditCounterIcon.tsx` | Remove "Premium subscriber, unlimited credits" tooltip. |
| `CreditsDisplay.tsx` | Remove `unlimitedContainer`, `unlimitedChip`, "You have unlimited credits" UI. Show credit balance + expiry date for active subscription users. |
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
| `FIRST_LOGIN_CREDITS.md` | Note free credits have `expires_at = NULL` (never expire). |
| All other docs | Grep for "unlimited", "premium only", "monthly subscription" — update each occurrence. |

**In-app content:**

| Location | Change |
|---|---|
| `app/support.tsx` | Update FAQ entries referencing unlimited or premium-only features. |
| Any FAQ content | Explain: 300 credits/month subscription ($20), 100 credits one-time ($10), 31-day expiry for paid credits, free credits never expire, all features open to anyone with credits. |

---

## What Does Not Change

- `planTier` column and plan tier values (`free`, `monthly_20`, `monthly_50`, `payg`) remain in DB schema — used for billing/webhook routing.
- `creditTransactions` idempotency logic remains unchanged.
- Refund handling remains provider-side (Stripe, Apple, Google Play).
- `monthly_50` plan remains reserved and inactive.
- Admin credit adjustment functions remain unchanged.
