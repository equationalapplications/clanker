# Billing & Credits

## Overview

Credits and subscriptions are shared across platforms. Web uses Stripe for payments; Android and iOS use RevenueCat. Purchases on any platform grant access to credits and subscription benefits across all platforms.

### Credit Model Reference

| Grant type | Amount | Expiry |
|---|---|---|
| Free signup | 50 | Never |
| Monthly subscription | 300/cycle | End of billing cycle |
| One-time pack | 100 | 31 days from purchase |

### Refunds

Handled provider-side: Stripe, Apple App Store, and Google Play manage refund mechanics. Webhook handlers sync resulting state back to Cloud SQL `subscriptions` automatically — no local transaction table required.

---

## First Login Credits

New users receive **50 free credits** upon their first login, seeded by the Cloud SQL bootstrap flow.

### How it works

1. `exchangeToken` calls `subscriptionService.getOrCreateDefaultSubscription(userId)`
2. That function checks if any `credit_transactions` row exists for the user
3. If the user is new (no existing credits), it calls `creditService.addCredits(userId, 50, null, 'signup')`
4. This inserts a `credit_transactions` row with `initial_amount = 50`, `remaining_balance = 50`, `transaction_type = 'signup'`, `expires_at = NULL`

### Properties of signup credits

- **Never expire:** `expires_at = NULL`
- **Spent last:** Spend algorithm orders by `expires_at NULLS LAST`, so expiring credits are consumed first
- **Not affected by subscription expiry:** Expiry `UPDATE` targets only `transaction_type = 'subscription'` — signup credits are never touched

---

## Stripe Webhook

**Function:** `stripeWebhook` (exported from `functions/src/stripeWebhook.ts`)  
**Type:** `onRequest` HTTP handler (Stripe sends unsigned HTTP POST)  
**URL:** `https://us-central1-<project-id>.cloudfunctions.net/stripeWebhook`

### Required Secrets

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe dashboard |
| `CLOUD_SQL_CONNECTION_NAME` | Cloud SQL instance connection name |
| `CLOUD_SQL_DB_NAME` / `CLOUD_SQL_DB_USER` / `CLOUD_SQL_DB_PASS` | Cloud SQL database credentials |

### Event → Action Mapping

| Stripe Event | Action |
|---|---|
| `checkout.session.completed` (subscription) | Grant 300 credits expiring at `current_period_end`; expire old subscription credits |
| `checkout.session.completed` (credit pack) | Grant 100 credits expiring 31 days from now |
| `customer.subscription.updated` (renewal) | Grant 300 credits expiring at `current_period_end` (referenceId = `sub_${sub.id}_${periodEnd}` for idempotency); expire old subscription credits |
| `invoice.payment_succeeded` (credit pack fallback) | Grant 100 credits expiring 31 days from now |
| `charge.refunded` | Deduct credits |
| `customer.subscription.deleted` | No credit action — credits expire naturally at `expires_at` |

**Idempotency guard must run before expiring old credits or performing any other DB writes. Guard first, write second.**

### Price ID → Tier Mapping

Configure via Stripe price ID environment variables consumed by `functions/src/runtimeConfig.ts` and `functions/src/stripeWebhook.ts`:

```dotenv
STRIPE_MONTHLY_20_PRICE_ID=price_TODO_monthly_20
STRIPE_MONTHLY_50_PRICE_ID=price_TODO_monthly_50
STRIPE_CREDIT_PACK_PRICE_ID=price_TODO_credit_pack
```

---

## RevenueCat Webhook

**Function:** `revenueCatWebhook` (exported from `functions/src/revenueCatWebhook.ts`)  
**Type:** `onRequest` HTTP handler  
**URL:** `https://us-central1-<project-id>.cloudfunctions.net/revenueCatWebhook`

### Authentication

RevenueCat sends an `Authorization: Bearer <secret>` header. The handler verifies it matches `REVENUECAT_WEBHOOK_SECRET`.

### Event → Action Mapping

| RevenueCat Event | Action |
|---|---|
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` | Subscription → upsert `subscriptions`. Credit pack → add credits. |
| `NON_RENEWING_PURCHASE` | Credit pack → add credits. |
| `CANCELLATION` | Known subscription → keep `plan_status = 'active'` with auto-renew off. Unknown → fall back to `plan_tier = 'free'`, `plan_status = 'cancelled'`. |
| `EXPIRATION` | Upsert `plan_tier = 'free'`, `plan_status = 'expired'`. |

### Product ID → Tier Mapping

Configured in `functions/src/revenueCatWebhook.ts`:

```typescript
const REVENUECAT_PRODUCT_TO_TIER: Record<string, "monthly_20" | "monthly_50"> = {
  "monthly_20_subscription": "monthly_20",
  "monthly_50_subscription": "monthly_50",
};

// iOS (credit_100) and Android (credit_pack_100) credit-pack product IDs
const REVENUECAT_CREDIT_PACK_IDS = new Set(["credit_pack_100", "credit_100"]);
```

Note: The webhook normalizes subscription IDs before lookup — Android-style IDs with base plan suffixes are stripped and still map correctly.

### Platform Product ID Differences

Play Billing v5 requires full `{subscription_id}:{base_plan_id}` format when initiating a purchase on Android. iOS does not have base plan concepts. Resolved in `src/config/constants.ts`:

```typescript
REVENUECAT_PRODUCTS.MONTHLY_20 =
  Platform.OS === 'android'
    ? 'monthly_20_subscription:monthly-usd-20'
    : 'monthly_20_subscription'
```

#### Google Play Console IDs

| Product ID | Type | Base Plan ID |
|---|---|---|
| `monthly_20_subscription` | Auto-renewing subscription | `monthly-usd-20` |
| `monthly_50_subscription` | Auto-renewing subscription | `monthly-usd-50` |
| `credit_pack_100` (Android) / `credit_100` (iOS) | One-time product | `one-time-usd-pack` |

---

## Setting Webhook Secrets

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
firebase functions:secrets:set CLOUD_SQL_CONNECTION_NAME
firebase functions:secrets:set CLOUD_SQL_DB_NAME
firebase functions:secrets:set CLOUD_SQL_DB_USER
firebase functions:secrets:set CLOUD_SQL_DB_PASS
```

Register webhook URLs in:
- **Stripe Dashboard** → Developers → Webhooks → Add endpoint
- **RevenueCat Dashboard** → Project → Integrations → Webhooks → Add endpoint

---

## Web Checkout Flow (`purchasePackageStripe`)

On web, subscriptions and credit packs are purchased via a Stripe Checkout Session created server-side.

### Full sequence

```
Client (web)
  → calls purchasePackageStripe({ priceId }) Firebase onCall
  → Cloud Function validates auth + priceId
  → find-or-create Stripe Customer by email
  → create Stripe Checkout Session (subscription or payment mode)
  → return session.url
  → client opens url via Linking.openURL
  → user completes payment on Stripe-hosted page
  → Stripe redirects to STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL
  → Stripe fires checkout.session.completed webhook
  → stripeWebhook upserts subscriptions or adds credits
```

### `purchasePackageStripe` Cloud Function

**Type:** `onCall` (Firebase callable — requires authenticated Firebase user)  
**Location:** `functions/src/purchasePackageStripe.ts`  
**Region:** `us-central1`

### Required Environment Variables

Set via Firebase Functions secrets:

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API authentication |
| `STRIPE_MONTHLY_20_PRICE_ID` | Stripe price ID for $20/month tier |
| `STRIPE_MONTHLY_50_PRICE_ID` | Stripe price ID for $50/month tier |
| `STRIPE_CREDIT_PACK_PRICE_ID` | Stripe price ID for $10 credit pack |
| `STRIPE_SUCCESS_URL` | Post-checkout success redirect (default: `https://clanker-ai.com/checkout/success`) |
| `STRIPE_CANCEL_URL` | Post-checkout cancel redirect (default: `https://clanker-ai.com/checkout/cancel`) |

> Note: `monthly_50` purchases are intentionally disabled in `src/utilities/makePackagePurchase.ts` until RevenueCat product setup is complete. The active web checkout flow only supports `monthly_20` and `payg`.

### Client-side Price IDs

Read from `EXPO_PUBLIC_STRIPE_*` env vars (set in `.env` or `.env.local`):

```bash
EXPO_PUBLIC_STRIPE_MONTHLY_20_PRICE_ID=price_xxx
EXPO_PUBLIC_STRIPE_MONTHLY_50_PRICE_ID=price_xxx
EXPO_PUBLIC_STRIPE_CREDIT_PACK_PRICE_ID=price_xxx
```

Referenced in `src/config/constants.ts` and passed to `purchasePackageStripe` via `src/utilities/makePackagePurchase.ts`.

### Checkout Redirect Pages

| Route | File | Purpose |
|---|---|---|
| `/checkout/success` | `app/checkout/success.tsx` | Shown after successful payment; auto-navigates to app in 3s |
| `/checkout/cancel` | `app/checkout/cancel.tsx` | Shown when user cancels; offers "Try again" and "Back to app" |

### Webhook Resilience

`handleCheckoutCompleted` uses a two-stage lookup:
1. **Primary:** look up Cloud SQL user by `customer_details.email` / `customer_email`
2. **Fallback:** resolve by Firebase UID from `session.client_reference_id` using `findUserByFirebaseUid`

If neither succeeds, logs a warning and exits gracefully. Stripe retries unexpected processing errors (non-2xx) automatically.

---

## Apple Auto-Renewable Subscription Consent

### Requirements Covered

Apple requires that the purchase experience clearly exposes legal terms for subscription users:
1. The paywall must include a Terms of Use link
2. The Terms of Use destination must host custom terms and provide access to the Apple Standard EULA
3. Custom pre-purchase or sign-up consent cannot override App Store billing/refund controls

### Current Implementation

**Paywall Legal Surface** (`app/(drawer)/subscribe.tsx`):
- Terms of Use link (routes to `/terms`)
- Privacy Policy link (routes to `/privacy`)
- Apple EULA link (opens Apple URL)
- Explanatory copy that auto-renewable subscriptions are billed through Apple

**Terms Destination** (`app/terms.tsx`):
- Existing custom terms content
- Notice that Apple Standard EULA applies to iOS auto-renewable subscriptions
- Direct link to Apple Standard EULA

**Consent Scope Safety**:
- Sign-up consent (`I Accept` in `AcceptTerms`) remains supported for custom terms
- Terms copy clarifies App Store provider terms govern billing/refunds for iOS purchases
- Implementation: `src/config/termsConfig.ts`, `src/components/AcceptTerms.tsx`

**Apple EULA URL**: Centralized in `src/config/constants.ts` as `APPLE_EULA_URL` — single source of truth.

### Notes for App Review

1. Confirm paywall legal links are visible without extra navigation
2. Confirm Terms route displays custom terms and Apple EULA access
3. Confirm no custom policy text claims control over App Store-managed refunds for iOS subscriptions

---

## Multi-Tab Checkout Robustness & Stripe Return-Tab Recovery

The checkout flow maintains robustness across multiple browser tabs and recovers safely when users return from a Stripe redirect in a different tab. Uses `localStorage`, `BroadcastChannel`, focus/visibility tracking, and per-product locks.

### Same-Tab Stripe Redirect

1. A unique `attemptId` is generated and persisted to `localStorage` before Stripe redirect
2. Stripe redirects back to `/checkout/success?attemptId=...` or `/checkout/cancel?attemptId=...`
3. The return page reads `attemptId` from query params, updates the matching attempt record, broadcasts the terminal event

### Multi-Tab Awareness

When Stripe redirects in one tab:
- The return tab broadcasts via `BroadcastChannel` to all other open tabs
- Other tabs clean up their checkout state to avoid stale UI
- Prevents Tab A showing a pending button while Tab B already completed

### localStorage + BroadcastChannel Architecture

**localStorage** stores `checkout:attempts:${uid}` — JSON object keyed by `attemptId` with `CheckoutAttemptRecord` values (`attemptId`, `productType`, `status`, `at`, `sourceTabId`, `schemaVersion`). Pending records drive derived lock state. Terminal records persist until explicitly cleared.

**BroadcastChannel** broadcasts lifecycle events (`CHECKOUT_STARTED`, `CHECKOUT_SUCCEEDED`, `CHECKOUT_CANCELLED`, `CHECKOUT_STALE_CLEARED`) and UID changes across tabs.

### Per-Product Locks

- A `pending` attempt record is written before starting checkout
- Locks are derived from `pending` records (not separate lock keys)
- Other tabs consume channel events and re-derive lock state
- Locks clear when attempts move to `succeeded`, `cancelled`, or `expired`

### TTL Stale Recovery

When returning from Stripe:
1. Load attempt map from `checkout:attempts:${uid}`
2. Compare pending records against TTL window
3. Stale records transition to `expired`; `CHECKOUT_STALE_CLEARED` broadcast
4. Remaining non-stale records continue driving lock state

### Sign-Out & UID Changes

- BroadcastChannel message triggers cleanup of pending checkout attempts and invalidates checkout UI state
- Prevents stale purchase state leaking into a new user's session

### No Polling

State recovery relies on:
- **Focus/visibility recovery**: On tab focus, re-hydrates from localStorage, re-derives lock state, expires stale pending attempts
- **BroadcastChannel events**: Explicit broadcasts trigger immediate reconciliation across tabs
- **Convergence via `requestBootstrapRefresh`**: Event-driven, deduped; on successful checkout, a purchase-scoped refresh converges server-backed state

### Stripe Return-Tab Recovery Flow

1. User completes Stripe payment → redirected to success/cancel URL in possibly different tab
2. Return page reads `attemptId` from URL query string
3. Matching record transitions to `succeeded` or `cancelled`
4. BroadcastChannel publishes terminal event
5. Other tabs unlock affected product flows
6. On success, return tab triggers `requestBootstrapRefresh('purchase')`
7. Bootstrap refresh is event-driven and deduped

### Testing

**Manual checklist:**
- Single-tab flow: purchase → Stripe → same-tab return → state cleanup
- Multi-tab: Tab A checkout, Tab A → Stripe, Tab B return → Tab A receives terminal update
- Tab closure: close return tab, other tabs recover via focus event
- Stale recovery: wait past TTL, regain focus → stale attempt expired
- Sign-out: complete purchase, sign out, sign in as different user → old attemptId inaccessible

**Automated tests:**
- attemptId generation and validation
- BroadcastChannel message delivery and cleanup
- Per-product lock acquisition and release
- TTL stale detection
- Focus/visibility recovery flow
- State clearing on sign-out

### Security Considerations

- `attemptId` is scoped to UID
- Locks are per-product + UID
- `localStorage` is per-origin (web checkout only; native uses in-memory state)
- TTL handling prevents stale pending attempts from persisting
- Sign-out clears pending state