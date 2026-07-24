# Billing architecture

## Two-provider split (intentional)

- **Web:** Stripe direct — `functions/src/stripeWebhook.ts`, `functions/src/purchasePackageStripe.ts`.
- **Native (iOS/Android):** RevenueCat — `functions/src/revenueCatWebhook.ts`.
- **Unified truth:** Cloud SQL (`subscriptions` + credit ledger `creditTransactions`).
  The client reads entitlements from the backend bootstrap (`exchangeToken`), never
  from the RC SDK, so cross-platform entitlements already work.

Why not consolidate on RevenueCat Web Billing / RC-Stripe? The ~1% RC fee on web
revenue buys nothing we don't already have (see spec 2026-07-24, Non-goals).

## Event → side-effect matrix

### RevenueCat (`revenueCatWebhook.ts`)

| Event | Product | Side effect |
|-------|---------|-------------|
| TEST | any | connectivity check only, 200, no side effects |
| environment=SANDBOX (any type) | any | ignored, 200 (checked after TEST, before the type switch) |
| INITIAL_PURCHASE / RENEWAL | subscription tier | upsert active sub (provider=revenuecat), renew credits (per-cycle key `original_transaction_id_expiration_at_ms`), GA4 purchase |
| INITIAL_PURCHASE / NON_RENEWING_PURCHASE | credit pack | add pack credits (key=`original_transaction_id`), GA4 purchase |
| PRODUCT_CHANGE | subscription tier | upsert tier (provider=revenuecat), no credit change (credits only granted on RENEWAL, to avoid double-crediting mid-cycle plan changes) |
| CANCELLATION (cancel_reason=CUSTOMER_SUPPORT) | subscription tier | downgrade to free/cancelled, claw back this cycle's renewal credits, GA4 refund |
| CANCELLATION (other/no reason) | subscription tier | auto-renew off (`cancelAtPeriodEnd=true`), entitlement stays active until EXPIRATION |
| CANCELLATION | credit pack | deduct pack credits (floored at zero), GA4 refund; subscription row untouched |
| CANCELLATION | unknown product | log only, no state change |
| EXPIRATION | subscription tier | downgrade to free/expired |
| EXPIRATION | non-subscription product | log only, no state change |
| UNCANCELLATION | subscription tier | clear `cancelAtPeriodEnd`, sub set active (provider=revenuecat) |
| UNCANCELLATION | non-subscription product | log only, no state change |
| BILLING_ISSUE | any | log only (grace period; entitlement stays active until EXPIRATION) |
| TRANSFER | any | log only (not fully handled — full entitlement re-pointing between users is backlog) |
| unrecognized type | any | log only, 200 |

A `billing_provider_collision` warning is logged (not blocked) if an
INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE event arrives for a user who already has an
active Stripe subscription — RC is still allowed to write.

GA4 purchase/refund emission for RevenueCat is best-effort: it never throws (wrapped
in try/catch, logged and swallowed) and is skipped entirely if the event lacks a
resolvable transaction id, `price_in_purchased_currency`, or `currency`.

### Stripe (`stripeWebhook.ts`)

| Event | Side effect |
|-------|-------------|
| checkout.session.completed | subscription line item → upsert sub (provider=stripe) + renew credits from `current_period_end`, **no GA4 purchase** (fires from `invoice.payment_succeeded` instead, see B6.1); credit-pack line item(s) → add pack credits (key=session id) **and** GA4 purchase |
| customer.subscription.updated | sync tier/status/`cancelAtPeriodEnd`; if resulting status is active, renew sub credits (key=`sub_{id}_{current_period_end}`, idempotent) — no GA4 event |
| customer.subscription.deleted | downgrade to free/cancelled (provider=null) — no GA4 event |
| invoice.payment_succeeded | if tied to a subscription: `billing_reason=subscription_cycle` renews sub credits (same idempotent key as above); **`subscription_create` or `subscription_cycle`** additionally emits one GA4 purchase keyed on `invoice.id` (tier resolved from the invoice line's price id) — one event per invoice, no double-count with `checkout.session.completed`; otherwise (non-subscription invoice) add pack credits for any credit-pack line items (key=invoice id), no GA4 event |
| charge.refunded | if the underlying invoice has credit-pack line items, deduct credits proportional to the *new* refund delta (idempotent via cumulative-refund tracking) **and emit a GA4 refund** (value=delta, key=`{charge.id}_{amount_refunded}`); else if the invoice is subscription-linked, cancel the subscription (free/cancelled) **and emit a GA4 refund** (value=full `amount_refunded`, key=`charge.id`); else log as unclassifiable, no GA4 event |

Stripe events are deduplicated via `stripeEventDedupeService` (claim → process →
complete/unmark) before the switch runs, so retried webhook deliveries are a no-op.

GA4 purchase/refund emission for Stripe mirrors RevenueCat's isolation guarantee:
`emitStripePurchase`/`emitStripeRefund` never throw (wrapped in try/catch, logged and
swallowed) and skip with a `warn` log if `firebaseUid`, `value`, or `currency` is
missing (never guess revenue). Stripe refund `transaction_id` keys on `charge.id`,
which does not match the originating purchase's `transaction_id` (`session.id` /
`invoice.id`) — this breaks the GA4 UI's purchase↔refund linking for Stripe, and it
means the `refunded` convenience column on `v_purchases` purchase rows never flips
for Stripe (it only works for RevenueCat, whose refund events reuse the purchase's
transaction id). Canonical revenue reconciliation happens in BigQuery
(`v_purchases`), where every refund event lands as its own row (`type = 'refund'`),
queryable independent of whether it links back to a purchase row.

## Analytics flow

Webhook → GA4 Measurement Protocol (`functions/src/services/ga4MeasurementService.ts`,
`sendPurchaseEvent` / `sendRefundEvent`, keyed by `client_id` + `user_id` from the
Firebase UID) → GA4 property → daily BigQuery export
(`clanker-prod.analytics_544289823`) → hand-written views in `clanker_analytics`
(`analytics/bq/`). Daily export only; ~24h latency; no streaming/intraday export by
design (see `analytics/bq/README.md`).

## BQ dataset/view inventory

- `clanker-prod.analytics_544289823` — GA4-managed daily export (`events_*`), not
  hand-edited.
- `clanker-prod.clanker_analytics.v_purchases` (`analytics/bq/v_purchases.sql`) —
  one row per transaction event (`type` = `purchase` or `refund`,
  `transaction_id`, `user_id`, `user_pseudo_id`, `event_date`, `event_timestamp`,
  `value`, `currency`, `payment_provider`, `store`, `item_id`). Purchase rows carry
  a best-effort `refunded` boolean joined on matching `transaction_id` (reliable
  for RevenueCat only, see B6.4 above); query `type = 'refund'` rows directly for
  canonical refund reconciliation, including Stripe.
- `clanker-prod.clanker_analytics.v_user_journey` (`analytics/bq/v_user_journey.sql`) —
  90-day behavioral funnel.
- Known caveat (`analytics/bq/README.md`): the Firebase native SDK can auto-log
  `in_app_purchase` alongside the server-sent `purchase` event. `v_purchases`
  already filters `event_name = 'purchase'` only, so it structurally excludes
  `in_app_purchase` and does not double-count — no view-side mitigation needed.
  Raw GA4 aggregate totals *outside* `v_purchases` (e.g. the GA4 UI, or any other
  query against `events_*`) are still exposed to double-counting until
  auto-collection is disabled at the native SDK/build-config level; verify against
  the BQ export after the first real native purchase (see Verification in the spec)
  and disable auto-collection then if it fires.

## Deferred

- **B4 — RC Scheduled Data Exports → GCS → BQ** (`rc_transactions`): payout-level truth
  (store commission, tax, proceeds). Deferred until native revenue or a sale process
  needs payout reconciliation. Until then, webhook-derived GA4 + the Cloud SQL ledger
  are the transaction record; BQ answers gross (not net) revenue.
