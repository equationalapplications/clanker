# Payment Integration Guide - React Native

This guide covers integrating the payment system specifically in the Clanker React Native application.

## Quick Start

### Install Dependencies

```bash
npm install @stripe/stripe-react-native @tanstack/react-query
```

## Cross Platform Considerations

Web uses Stripe for payments.
Android and iOS use RevenueCat.

Credits and subscriptions are shared across platforms. If a user purchases credits or a subscription on one platform, they will have access to those credits and subscription benefits on all platforms.

### Credits and Subscriptions

The user may purchase 100 credits for $10 or subscribe monthly for 300 credits at $20/month.

Free signup credits never expire. Subscription credits expire at the end of each billing cycle. One-time credit pack credits expire 31 days after purchase.

### Refunds

Refunds are handled provider-side: Stripe, Apple App Store, and Google Play manage refund mechanics. The webhook handlers sync the resulting state back to `subscriptions` automatically — no local transaction table is required.

---

## Webhook Endpoints

Both webhooks are deployed as Firebase Cloud Functions in `functions/src/`.

### Stripe Webhook

**Function:** `stripeWebhook` (exported from `functions/src/stripeWebhook.ts`)  
**Type:** `onRequest` HTTP handler (not `onCall` — Stripe sends unsigned HTTP POST)  
**URL pattern:** `https://us-central1-<project-id>.cloudfunctions.net/stripeWebhook`

#### Required Environment Variables

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe dashboard |
| `CLOUD_SQL_CONNECTION_NAME` | Cloud SQL instance connection name (`project:region:instance`) |
| `CLOUD_SQL_DB_NAME` / `CLOUD_SQL_DB_USER` / `CLOUD_SQL_DB_PASS` | Cloud SQL database credentials (via Firebase Secrets) |

#### Event → Action Mapping

| Stripe Event | Action |
|---|---|
| `checkout.session.completed` (subscription) | Expire old subscription credits; grant 300 credits expiring at `current_period_end` |
| `checkout.session.completed` (credit pack) | Grant 100 credits expiring 31 days from now |
| `customer.subscription.updated` (renewal) | `renewSubscriptionCredits(userId, 300, cycleEnd, eventId)` — atomic: idempotency check → expire old → grant new |
| `invoice.payment_succeeded` (credit pack fallback) | Grant 100 credits expiring 31 days from now |
| `charge.refunded` | Deduct credits as before |
| `customer.subscription.deleted` | No credit action — credits expire naturally at `expires_at` |

> Idempotency check MUST run before any DB writes (including the expiry `UPDATE`). Guard first, write second.

#### Price ID → DB Tier Mapping

Configure via Stripe price ID environment variables consumed by `functions/src/runtimeConfig.ts` and `functions/src/stripeWebhook.ts`:

```dotenv
STRIPE_MONTHLY_20_PRICE_ID=price_TODO_monthly_20
STRIPE_MONTHLY_50_PRICE_ID=price_TODO_monthly_50
STRIPE_CREDIT_PACK_PRICE_ID=price_TODO_credit_pack
```

Replace `price_TODO_*` with real price IDs from the Stripe dashboard.

---

### RevenueCat Webhook

**Function:** `revenueCatWebhook` (exported from `functions/src/revenueCatWebhook.ts`)  
**Type:** `onRequest` HTTP handler  
**URL pattern:** `https://us-central1-<project-id>.cloudfunctions.net/revenueCatWebhook`

#### Required Environment Variables

| Variable | Description |
|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | Shared secret configured in RevenueCat dashboard |
| `CLOUD_SQL_CONNECTION_NAME` | Cloud SQL instance connection name (`project:region:instance`) |
| `CLOUD_SQL_DB_NAME` / `CLOUD_SQL_DB_USER` / `CLOUD_SQL_DB_PASS` | Cloud SQL database credentials (via Firebase Secrets) |

#### Authentication

RevenueCat sends an `Authorization: Bearer <secret>` header. The handler verifies this matches `REVENUECAT_WEBHOOK_SECRET`.

#### Event → Action Mapping

| RevenueCat Event | Action |
|---|---|
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` | Subscription → upsert `subscriptions`. Credit pack → add credits via `creditService`. |
| `NON_RENEWING_PURCHASE` | Credit pack → add credits via `creditService`. |
| `CANCELLATION` | Known subscription product → keep entitlement `plan_status = 'active'` with auto-renew off. Unknown product → fall back to `plan_tier = 'free'`, `plan_status = 'cancelled'`. |
| `EXPIRATION` | Upsert `plan_tier = 'free'` and set `plan_status = 'expired'`. |

#### Product ID → DB Tier Mapping

Configured in `functions/src/revenueCatWebhook.ts`:

```typescript
const REVENUECAT_PRODUCT_TO_TIER: Record<string, "monthly_20" | "monthly_50"> = {
  "monthly_20_subscription": "monthly_20",
  "monthly_50_subscription": "monthly_50",
};

// Support iOS (credit_100) and Android (credit_pack_100) credit-pack product IDs
const REVENUECAT_CREDIT_PACK_IDS = new Set([
  "credit_pack_100",
  "credit_100",
]);
```

Note: the webhook normalizes subscription IDs before lookup. If RevenueCat sends Android-style IDs with a base plan suffix (for example `monthly_20_subscription:monthly-usd-20`), the handler strips the suffix and still maps to the correct tier.

These product IDs must match App Store Connect / Google Play Console exactly.

#### Platform Product ID Differences

Play Billing v5 requires the full `{subscription_id}:{base_plan_id}` format when **initiating a purchase** on Android. iOS App Store has no concept of base plans. The client resolves this at runtime in `src/config/constants.ts`:

```typescript
REVENUECAT_PRODUCTS.MONTHLY_20 =
  Platform.OS === 'android'
    ? 'monthly_20_subscription:monthly-usd-20'   // Android: subscription_id:base_plan_id
    : 'monthly_20_subscription'                  // iOS: product ID only
```

The RevenueCat webhook mapping is resilient to either format: base ID (`monthly_20_subscription`) or Android base-plan-suffixed ID (`monthly_20_subscription:monthly-usd-20`).

#### Google Play Console IDs

| Product ID | Type | Base Plan ID |
|---|---|---|
| `monthly_20_subscription` | Auto-renewing subscription | `monthly-usd-20` |
| `monthly_50_subscription` | Auto-renewing subscription | `monthly-usd-50` |
| `credit_pack_100` (Android) / `credit_100` (iOS) | One-time product | `one-time-usd-pack` |

---

## Setting Webhook Secrets

```bash
# Set Firebase Function environment variables
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
firebase functions:secrets:set CLOUD_SQL_CONNECTION_NAME
firebase functions:secrets:set CLOUD_SQL_DB_NAME
firebase functions:secrets:set CLOUD_SQL_DB_USER
firebase functions:secrets:set CLOUD_SQL_DB_PASS
```

Register the webhook URLs in:
- **Stripe Dashboard** → Developers → Webhooks → Add endpoint
- **RevenueCat Dashboard** → Project → Integrations → Webhooks → Add endpoint

---

## Web Checkout Flow (`purchasePackageStripe`)

On web, subscriptions and credit packs are purchased via a Stripe Checkout Session created server-side. The full sequence:

```
Client (web)
  → calls purchasePackageStripe({ priceId }) Firebase onCall
  → Cloud Function validates auth + priceId
  → find-or-create Stripe Customer by email
  → create Stripe Checkout Session (subscription or payment mode)
  → return session.url
  → client opens url via Linking.openURL
  → user completes payment on Stripe-hosted page
  → Stripe redirects user to STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL
  → Stripe fires checkout.session.completed webhook
  → stripeWebhook Cloud Function upserts subscriptions or adds credits
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

> Note: In the current codebase, `monthly_50` purchases are intentionally disabled in `src/utilities/makePackagePurchase.ts` until RevenueCat product setup is complete. The active web checkout flow only supports `monthly_20` and `payg` for now.

```bash
firebase functions:secrets:set STRIPE_MONTHLY_20_PRICE_ID
firebase functions:secrets:set STRIPE_MONTHLY_50_PRICE_ID
firebase functions:secrets:set STRIPE_CREDIT_PACK_PRICE_ID
firebase functions:secrets:set STRIPE_SUCCESS_URL
firebase functions:secrets:set STRIPE_CANCEL_URL
```

### Client-side Price IDs

The client reads price IDs from `EXPO_PUBLIC_STRIPE_*` env vars (set in `.env` or `.env.local`):

```bash
EXPO_PUBLIC_STRIPE_MONTHLY_20_PRICE_ID=price_xxx
EXPO_PUBLIC_STRIPE_MONTHLY_50_PRICE_ID=price_xxx
EXPO_PUBLIC_STRIPE_CREDIT_PACK_PRICE_ID=price_xxx
```

These are referenced in `src/config/constants.ts` and passed to `purchasePackageStripe` via `src/utilities/makePackagePurchase.ts`.

### Checkout Redirect Pages

| Route | File | Purpose |
|---|---|---|
| `/checkout/success` | `app/checkout/success.tsx` | Shown after successful payment; auto-navigates to app in 3 s |
| `/checkout/cancel` | `app/checkout/cancel.tsx` | Shown when user cancels; offers "Try again" and "Back to app" |

### Webhook Resilience

`handleCheckoutCompleted` in `stripeWebhook.ts` uses a two-stage lookup:

1. **Primary**: look up Cloud SQL user by `customer_details.email` / `customer_email`.
2. **Fallback**: if email lookup fails, resolve by Firebase UID from `session.client_reference_id` using `findUserByFirebaseUid`.

If neither lookup succeeds, the webhook logs a warning and exits gracefully for that
event. Stripe retries unexpected processing errors (non-2xx) automatically.
