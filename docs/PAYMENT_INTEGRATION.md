# Payment Integration Guide - React Native

This guide covers integrating the payment system specifically in the Clanker React Native application.

## Quick Start

### Install Dependencies

```bash
npm install @stripe/stripe-react-native @tanstack/react-query
npx expo install react-native-purchases
```

## Cross Platform Considerations

Web uses Stripe for payments.
Android and iOS use RevenueCat.

Credits and subscriptions are shared across platforms. If a user purchases credits or a subscription on one platform, they will have access to those credits and subscription benefits on all platforms.

### Credits and Subscriptions

The user may purchase 100 credits for $10 or subscribe monthly for unlimited credits at $20/month or $50/month.

Credits  will not expire and they roll over. They are not consumed if the user has a monthly subscription so they can be used when the user cancels the subscription.

### Refunds

Refunds are handled provider-side: Stripe, Apple App Store, and Google Play manage refund mechanics. The webhook handlers sync the resulting state back to Cloud SQL subscription/credit records automatically — no local transaction table is required.

---

## Webhook Endpoints

Both webhooks are deployed as Firebase Cloud Functions in `account/functions/src/`.

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
| `checkout.session.completed` | Subscription product → upsert subscription via `subscriptionService.upsertSubscription`. Credit pack → add credits via `creditService.addCredits`. |
| `customer.subscription.updated` | Upsert Cloud SQL subscription with mapped `planTier` and Stripe-derived `planStatus`. |
| `customer.subscription.deleted` | Upsert Cloud SQL subscription as `planTier: free`, `planStatus: cancelled`. |
| `invoice.payment_succeeded` | For one-time invoices with a credit-pack price → add credits via `creditService.addCredits`. |
| `charge.refunded` | Credit pack refund → deduct via `creditService.adjustCredits`. Subscription refund → upsert subscription as `free/cancelled`. |

#### Price ID → DB Tier Mapping

Configure in `functions/src/stripeWebhook.ts` `STRIPE_PRICE_TO_TIER`:

```typescript
const STRIPE_PRICE_TO_TIER: Record<string, string> = {
  "price_TODO_monthly_20": "monthly_20",  // $20/month
  "price_TODO_monthly_50": "monthly_50",  // $50/month
};
const STRIPE_CREDIT_PACK_PRICE_ID = "price_TODO_credit_pack"; // $10/100 credits
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
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` | Subscription product → upsert Cloud SQL subscription (`active`, with renewal date when present). Credit pack product → add credits via `creditService.addCredits`. |
| `NON_RENEWING_PURCHASE` | Credit pack product → add credits via `creditService.addCredits`. |
| `CANCELLATION` | Known subscription product → keep entitlement active and upsert with latest renewal date; unknown product → fallback to `free/cancelled`. |
| `EXPIRATION` | Upsert Cloud SQL subscription as `free/expired`. |

#### Product ID → DB Tier Mapping

Configured in `functions/src/revenueCatWebhook.ts`:

```typescript
const REVENUECAT_PRODUCT_TO_TIER: Record<string, string> = {
  "monthly_20_subscription": "monthly_20",
  "monthly_50_subscription": "monthly_50",
};
const REVENUECAT_CREDIT_PACK_ID = Platform.OS === 'ios' ? "credit_100" : "credit_pack_100"; // 100 credits (iOS id differs due to App Store rename restriction)
```

These product IDs must match App Store Connect / Google Play Console exactly.

#### Google Play Console IDs

| Product ID | Type | Base Plan ID / Purchase Option ID |
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
  → stripeWebhook Cloud Function upserts Cloud SQL subscriptions or adds credits
```

### `purchasePackageStripe` Cloud Function

**Type:** `onCall` (Firebase callable — requires authenticated Firebase user)  
**Location:** `account/functions/src/purchasePackageStripe.ts`  
**Region:** `us-central1`

### Required Environment Variables

Set via Firebase Functions secrets:

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API authentication |
| `STRIPE_MONTHLY_20_PRICE_ID` | Stripe price ID for $20/month tier |
| `STRIPE_MONTHLY_50_PRICE_ID` | Stripe price ID for $50/month tier |
| `STRIPE_CREDIT_PACK_PRICE_ID` | Stripe price ID for $10 credit pack |
| `STRIPE_SUCCESS_URL` | Post-checkout success redirect (default: `https://yoursbrightly.ai/checkout/success`) |
| `STRIPE_CANCEL_URL` | Post-checkout cancel redirect (default: `https://yoursbrightly.ai/checkout/cancel`) |

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

1. **Primary**: look up Cloud SQL user by `customer_details.email`
2. **Fallback**: if email lookup fails, look up the Cloud SQL user directly by Firebase UID using `session.client_reference_id` (via `findUserByFirebaseUid(...)`).

This fallback requires Cloud SQL repository support for Firebase UID-to-user resolution.
