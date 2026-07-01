# Billing Hardening (Stripe + RevenueCat) — Design Spec

**Date:** 2026-07-01
**Status:** Draft
**Source:** External code review of the Stripe + RevenueCat billing integration (subscriptions + PAYG credit packs)

---

## Overview

Six targeted fixes to the billing stack addressing cross-platform subscription tracking and webhook idempotency gaps found in review. The core architecture (append-only `credit_transactions` ledger, `syncSubscriptionCache` reconciliation, row-locking spend) is unchanged — these are hardening fixes, not a redesign.

**In scope:** cross-platform subscription collision (#1), RevenueCat credit-pack double-grant on retry (#2), partial-refund over-deduction (#3), Stripe customer lookup fallback (#4), Stripe event-level idempotency (#5), RevenueCat cancellation "won't renew" signal (#6).

**Out of scope (deferred, low severity):** dead price-id constant cleanup, client `any`-cast on checkout response, stale client-side balance display during mid-session expiry, missing warn log for subscription grants without `original_transaction_id`, `getOrCreateStripeCustomer` duplicate-email risk. None of these affect correctness of money/credit movement; can be addressed opportunistically or in a later pass.

---

## Schema Changes

New migration `functions/drizzle/0018_billing_hardening.sql` (hand-written, not `drizzle-kit generate` — journal is out of sync with hand-applied history per prior project convention).

### `subscriptions` table — two new columns

| Column | Type | Default | Purpose |
|---|---|---|---|
| `subscription_provider` | `text`, nullable | `NULL` | `'stripe' \| 'revenuecat'`. Identifies which platform currently owns the active paid subscription. Written every time a paid tier is upserted; left untouched on non-billing updates (e.g. terms acceptance). |
| `cancel_at_period_end` | `boolean` | `false` | True when the subscription is active but will not renew (Stripe `cancel_at_period_end` flag, or RevenueCat `CANCELLATION`). Reset to `false` on any new active purchase/renewal. |

Add a check constraint on `subscription_provider`: `IN ('stripe', 'revenuecat')` (nullable, so free-tier/no-subscription rows stay `NULL`).

### New `processed_stripe_events` table

| Column | Type | Notes |
|---|---|---|
| `event_id` | `text primary key` | Stripe `event.id` |
| `created_at` | `timestamptz default now()` | For retention/debugging only |

No foreign keys — this is a pure dedupe log, not tied to a user.

---

## Fix #1 — Cross-Platform Subscription Collision

**Problem:** `subscriptions.user_id` is unique; both Stripe and RevenueCat webhooks upsert the same row. A user subscribing on both web and mobile gets the second webhook silently overwrite `plan_tier`/`stripe_subscription_id`, while both platforms bill independently — cancelling one leaves an orphaned active subscription the app can no longer see.

**Approach: block the second platform from being purchased, rather than tracking both.**

### Web (Stripe) — hard block, no charge occurs

`purchasePackageStripe` (onCall), before creating a Checkout Session for a *subscription* price (not PAYG credit pack): look up the caller's Cloud SQL subscription row. If `plan_status === 'active' && plan_tier !== 'free' && subscription_provider === 'revenuecat'`, reject the callable with a client-facing error such as "You already have an active subscription on mobile — manage it in the App Store or Play Store." No Stripe API call is made, so no charge risk.

### Mobile (RevenueCat) — best-effort client gate, no server-side prevention possible

RevenueCat purchases go through the native store billing sheet (`Purchases.purchasePackage`), which charges the user *before* our backend is involved. We cannot block the charge server-side. Mitigation:

- `subscriptionProvider` is added to the `SubscriptionSnapshot` returned by bootstrap/`exchangeToken`, alongside existing `planTier`/`planStatus`.
- `SubscribeButton` (and any other purchase entry point) checks this client-side before calling `purchaseProduct`: if `planStatus === 'active' && planTier !== 'free' && subscriptionProvider === 'stripe'`, show an alert and skip the purchase call instead of opening the store sheet.
- This is best-effort only — a stale client cache or a bypass could still let a store purchase go through.

### Webhook race / bypass handling (defense-in-depth)

If the RevenueCat webhook fires while an active Stripe-provider subscription already exists on the row (client gate missed or was bypassed): **upsert anyway and grant the entitlement.** The user has already been charged by the store; refusing the entitlement at this point produces a "you took my money" support ticket, which is strictly worse than an accidental double-bill (refundable on the Stripe side). Log a high-severity warning tagged `billing_provider_collision` with both provider identifiers so support can manually reconcile (typically: refund/cancel the now-orphaned Stripe subscription).

### `upsertSubscription` signature change

`subscriptionService.upsertSubscription` and both webhook `deps.upsertSubscription` call sites gain a `subscriptionProvider: 'stripe' | 'revenuecat' | null` parameter, written whenever the subscription's ownership changes. Existing Stripe call sites pass `'stripe'`; RevenueCat call sites pass `'revenuecat'`. On full termination (`handleSubscriptionDeleted`, RevenueCat `EXPIRATION`) the call explicitly passes `null`, clearing the column rather than leaving a stale provider string behind — the DB should reflect that nobody currently owns the subscription, so a future gate check never trips on a leftover value from a long-ended subscription.

---

## Fix #2 — RevenueCat Credit-Pack Grant Without `original_transaction_id`

**Problem:** `INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE` credit-pack branches call `addCredits(..., original_transaction_id ?? undefined)`. With no reference id, `addCredits`'s idempotency guard (unique index on `(user_id, reason, reference_id)` where `reference_id IS NOT NULL`) does not apply, so a webhook retry double-grants credits.

**Fix:** if `original_transaction_id` is absent on a credit-pack event, log a warning and return a **non-2xx** response without calling `addCredits` at all. RevenueCat retries the event later; per RevenueCat's own delivery guarantees, `original_transaction_id` is expected to always be present in practice, so this should be effectively unreachable in normal operation and only guards a malformed/unexpected payload.

---

## Fix #3 — Partial Refund Over-Deduction (Stripe)

**Problem:** `handleChargeRefunded` always deducts the full `CREDIT_PACK_AMOUNT * creditPackQty` regardless of how much was actually refunded. `charge.refunded` fires for partial refunds too.

**Fix:** compute `refundRatio = charge.amount_refunded / charge.amount` and deduct `Math.floor(CREDIT_PACK_AMOUNT * creditPackQty * refundRatio)` via `adjustCredits`. A full refund (`amount_refunded === amount`) still claws back the entire grant; a partial refund claws back a proportional amount. Guard against division producing `NaN`/`Infinity` if `charge.amount` is ever `0`.

---

## Fix #4 — Stripe Customer Lookup Fallback

**Problem:** `handleSubscriptionUpdated` and `handleSubscriptionDeleted` retrieve the Stripe customer and bail if `customer.email` is missing/deleted, unlike `handleCheckoutCompleted` which falls back to `client_reference_id`. If the Stripe email is missing or has changed, renewals and cancellations silently no-op.

**Fix — two-step fallback chain**, checked in order when `customer.email` is unavailable:

1. `customer.metadata.firebase_uid → findUserByFirebaseUid`. This is populated at customer-creation time in `getOrCreateStripeCustomer` (`purchasePackageStripe.ts`), so it should be present for every customer created through the normal checkout flow.
2. If still unresolved, match against `subscriptions.stripe_customer_id` already persisted from a prior successful checkout/webhook — new repository method `findUserByStripeCustomerId(customerId)`.

Only if both fail does the handler log a warning and no-op, same as today.

---

## Fix #5 — Stripe Event-Level Idempotency

**Problem:** There is no event-level dedupe; correctness relies entirely on per-grant `referenceId` guards inside `addCredits`/`renewSubscriptionCredits`. The `charge.refunded` subscription-cancellation branch and plain `upsertSubscription` calls have no guard at all — naturally idempotent today only by coincidence.

**Fix:** `processed_stripe_events` table (see Schema Changes). At the top of `stripeWebhookHandler`, after signature verification succeeds, attempt `INSERT INTO processed_stripe_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`. If the insert affects 0 rows, the event was already processed — return `200` immediately without dispatching to a handler. If it affects 1 row, proceed to the existing `switch (event.type)` dispatch as today.

This guard must run **before** dispatch (guard first, side effects second — consistent with the existing "guard first, write second" rule already used for credit renewals).

---

## Fix #6 — RevenueCat/Stripe "Won't Renew" Signal

**Problem:** RevenueCat `CANCELLATION` keeps `plan_status = 'active'` (correct — entitlement continues until period end) but there's no stored signal that auto-renew is off. The UI can't distinguish "active, will renew" from "active, ending on `billing_cycle_end`."

**Fix:** `cancel_at_period_end` boolean (see Schema Changes).

- **RevenueCat `CANCELLATION`** (known product branch): set `cancel_at_period_end = true`. Tier/status/renewal date unchanged.
- **RevenueCat `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE`**: set `cancel_at_period_end = false` (covers resubscribe-after-cancel and plan changes).
- **Stripe `customer.subscription.updated`**: map the Stripe event payload's own `subscription.cancel_at_period_end` boolean directly onto the column on every update — Stripe already tracks this natively, so no derived logic is needed here, just pass the value through in the `upsertSubscription` call.
- **Stripe `checkout.session.completed`** (new subscription): `cancel_at_period_end = false`.

Exposed in `SubscriptionSnapshot` (client bootstrap payload) alongside `subscriptionProvider`, so the UI can render "Ends on X" instead of inferring it from `plan_status` alone.

---

## What Does NOT Change

- `credit_transactions` ledger structure, FIFO expiry ordering, row-locking spend logic (`spendCredits`) — untouched.
- Cloud-agent `spendCredit` — untouched, not part of this review.
- `syncSubscriptionCache` reconciliation point — untouched.
- Low-severity items listed under "Out of scope" above.

---

## Open Implementation Details (to resolve in the plan, not here)

- Exact wording of the web-side rejection error surfaced to the client in `makePackagePurchase.ts`.
- Test coverage for: web block (existing active RevenueCat sub), RevenueCat webhook race granting anyway + warning log, missing-`original_transaction_id` non-2xx, partial-refund proration math, Stripe customer fallback chain (both steps), `processed_stripe_events` dedupe skipping a replayed event, `cancel_at_period_end` transitions for both providers, `subscription_provider` nulled on `handleSubscriptionDeleted`/`EXPIRATION`.
