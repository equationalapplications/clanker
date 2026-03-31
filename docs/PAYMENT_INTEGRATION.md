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

Refunds are handled provider-side: Stripe, Apple App Store, and Google Play manage refund mechanics. The webhook handlers sync the resulting state back to `user_app_subscriptions` automatically — no local transaction table is required.

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
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

#### Event → Action Mapping

| Stripe Event | Action |
|---|---|
| `checkout.session.completed` | Subscription product → upsert `user_app_subscriptions` with matching tier. Credit pack → call `add_user_credits` RPC. |
| `customer.subscription.updated` | Update `plan_tier`, `plan_status`, `plan_renewal_at` |
| `customer.subscription.deleted` | Set `plan_status = 'cancelled'` |
| `invoice.payment_succeeded` | For one-time PAYG invoices → call `add_user_credits` |
| `charge.refunded` | Credit pack refund → deduct via `update_user_credits`. Subscription refund → set `plan_status = 'cancelled'`. |

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
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

#### Authentication

RevenueCat sends an `Authorization: Bearer <secret>` header. The handler verifies this matches `REVENUECAT_WEBHOOK_SECRET`.

#### Event → Action Mapping

| RevenueCat Event | Action |
|---|---|
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` | Subscription → upsert `user_app_subscriptions`. Credit pack → call `add_user_credits`. |
| `NON_RENEWING_PURCHASE` | Credit pack → call `add_user_credits` |
| `CANCELLATION` | Set `plan_status = 'cancelled'` |
| `EXPIRATION` | Set `plan_status = 'expired'` |

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
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
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
  → stripeWebhook Cloud Function upserts user_app_subscriptions or adds credits
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

1. **Primary**: look up Supabase user by `customer_details.email`
2. **Fallback**: if email lookup fails, resolve Firebase UID from `session.client_reference_id` → get email from `admin.auth().getUser(uid)` → retry email lookup → finally try `findSupabaseUserByFirebaseUid` (queries `auth.users` by `raw_user_meta_data->>'firebaseUid'`)

This fallback requires the `get_user_id_by_firebase_uid` Supabase RPC function (migration: `20260327000000_create_get_user_id_by_firebase_uid.sql`).
