# Handoff — Stripe pack purchase smoke test

**Created:** 2026-07-20
**Updated:** 2026-07-20 (later session — see "Correction" below)
**Status:** Task A (smoke test) outstanding. Task B (analytics) shipped and removed from this doc.

---

## Correction — what actually fixed the payment outage

An earlier revision of this doc reported the first-customer incident as resolved by rolling `STRIPE_WEBHOOK_SECRET` and trimming it in code, and listed `https://us-central1-equationalapplications-com.cloudfunctions.net/stripeWebhook` as the live destination to "keep." **Both were wrong, and the outage continued for roughly a day afterward.**

The real cause: there are **two GCP projects**, `clanker-prod` (live) and `equationalapplications-com` (legacy, ~March 2026). Both had a full set of deployed functions with the same names. The Stripe webhook destination pointed at the **legacy** project, while every fix — the rolled secret, the `.trim()` code change, the GA4 purchase event — was deployed to `clanker-prod`, which received no real Stripe traffic. The legacy function kept running March code with an old secret and rejected every live event with `Stripe signature verification failed`.

The fix was **repointing the endpoint URL**, not the secret. The stored `STRIPE_WEBHOOK_SECRET` (v4, 38 bytes) had been correct all along.

Two lessons worth carrying forward:

- A `<region>-<projectId>.cloudfunctions.net` hostname encodes its project. Read the project id out of the URL before assuming which deployment it hits.
- A self-signed probe returning 200 only proves the function *you aimed at* is healthy. It says nothing about where the vendor is delivering. Close a payments incident on real vendor traffic (`GET /v1/webhook_endpoints` plus a genuine delivery in the logs), never on a synthetic probe.

### Second bug found in the same pass

The endpoint's `enabled_events` barely overlapped the handler's `switch`. Stripe was sending `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, and three `customer.*.updated` types; the code handles `invoice.payment_succeeded`, `customer.subscription.updated`, and `charge.refunded` — none of which were subscribed. Net effect: **subscription renewals granted no credits** (`SUBSCRIPTION_RENEWAL`, 30000, never fired) and refunds never deducted. Fixed by setting `enabled_events` to exactly the five types the switch implements.

### Resolved state (verified 2026-07-20 ~19:00 UTC)

- Endpoint `we_1SCVd4DTb0norRA0K5dqQ3Pu` → `https://us-central1-clanker-prod.cloudfunctions.net/stripeWebhook`
- Real Stripe delivery verified: `Received Stripe event` → 200
- `enabled_events` = the five handled types
- Legacy project decommissioned: all 20 functions deleted, legacy URL now 404s
- Credit pack is a one-time price (`price_1TvHU6DTb0norRA0gqLmSkeO`); the old recurring price is archived

---

## Task A — End-to-end smoke test (outstanding)

**Goal:** prove the pack-purchase path works from an updated client: Stripe delivers → function verifies → credits granted → charge is one-time, not a subscription. Also confirms the GA4 `purchase` event.

### Preconditions

- Webhook path is healthy (done — see above).
- Front-end web/OTA deploy with `EXPO_PUBLIC_STRIPE_CREDIT_PACK_PRICE_ID=price_1TvHU6DTb0norRA0gqLmSkeO` is live. **Verify this first** — un-updated native clients send the old price id and the backend rejects with `Unknown priceId` (fail-closed, intended).
- Use a real test purchase account you control. This is **live mode** — a real $10 charge. Refund after, or coordinate with the owner.

### Steps

1. From an updated web or mobile client, buy the **credit pack**.
2. Watch the webhook logs during checkout:
   ```bash
   gcloud logging read 'resource.labels.service_name="stripewebhook" AND timestamp>="<now-ISO-UTC>"' \
     --project=clanker-prod --limit=30 \
     --format="value(timestamp,severity,jsonPayload.message,jsonPayload.type,httpRequest.status)"
   ```
   Expect: `"Received Stripe event"` → `checkout.session.completed` → `"checkout.session.completed: credits added"` → 200. No `"Stripe signature verification failed"`, no `"Unhandled Stripe event type"`.
3. Confirm the Stripe object is a **one-time payment**, not a subscription:
   ```bash
   NETRC=$(mktemp)
   chmod 600 "$NETRC"
   SK=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=clanker-prod | tr -d '[:space:]')
   printf 'machine api.stripe.com login %s password\n' "$SK" > "$NETRC"
   unset SK
   # find the session for your test customer, then:
   curl -s --netrc-file "$NETRC" "https://api.stripe.com/v1/checkout/sessions/<cs_id>" \
     | python3 -c 'import sys,json;s=json.load(sys.stdin);print("mode:",s["mode"],"subscription:",s.get("subscription"))'
   rm -f "$NETRC"
   ```
   Expect `mode: payment`, `subscription: None`.
4. Confirm credits landed: admin dashboard → your test user → credits increased by `CREDIT_PACK_AMOUNT` (10000 Power) with a ~31-day expiry.
5. Confirm the GA4 `purchase` event fired — GA4 → Realtime or DebugView. This is the first live exercise of `ga4MeasurementService`.
6. Refund the test charge if appropriate. `charge.refunded` is handled (and now actually subscribed), so it will deduct the granted credits proportionally.

### Idempotency note

The handler dedupes on `event.id` (`stripeEventDedupeService`) and on `session.id` as the credit `referenceId`, so Stripe retries won't double-grant. Safe to resend events.

### Confirming the webhook without a purchase

Resend any recent event from the endpoint's *Event deliveries* tab and confirm a 200 plus `"Received Stripe event"` in the logs.

---

## Follow-up (not blocking)

- **BigQuery export** was linked 2026-07-20. The `analytics_<GA4_property_id>` dataset is created by the first daily export run, within ~24h. Verify with `bq ls --project_id=clanker-prod`, then `bq ls clanker-prod:analytics_XXXXXXXXX` for `events_*` tables. Advertising identifiers were deliberately excluded from the export (`google_analytics_adid_collection_enabled: false` in `firebase.json`; store privacy labels filed as "no ad ID").

---

## Reference

| Thing | Value |
|---|---|
| Project | `clanker-prod` (gcloud), Stripe acct `acct_1MVIIADTb0norRA0` |
| Legacy project | `equationalapplications-com` — decommissioned 2026-07-20, no compute remains |
| Webhook fn | `stripeWebhook` (Cloud Run service `stripewebhook`, region `us-central1`, project `clanker-prod`) |
| Live webhook destination | `https://us-central1-clanker-prod.cloudfunctions.net/stripeWebhook` (`we_1SCVd4DTb0norRA0K5dqQ3Pu`) + RevenueCat (`we_1MphUH…`, keep) |
| Subscribed events | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `charge.refunded` — must stay in sync with the `switch` in `stripeWebhook.ts` |
| Pack price (one-time) | `price_1TvHU6DTb0norRA0gqLmSkeO` |
| Old pack price (archived, recurring — do not reuse) | `price_1TF2okDTb0norRA0Ja9S6QZk` |
| Subscription tiers | `STRIPE_MONTHLY_20_PRICE_ID=price_1TF2nZ…`, `STRIPE_MONTHLY_50_PRICE_ID=price_1TF2oA…` |
| Credit amounts | `functions/src/constants/credits.ts` — pack 10000, sub renewal 30000, signup 5000 (Power = credits ×100) |
| Webhook code | `functions/src/stripeWebhook.ts`, tests `functions/src/stripeWebhook.test.ts` |
| Checkout callable | `functions/src/purchasePackageStripe.ts` (mode derived from `price.type`) |
| GA4 purchase event | `functions/src/services/ga4MeasurementService.ts`; secrets `GA4_MEASUREMENT_ID`, `GA4_MP_API_SECRET` |
| Client price map | `src/config/constants.ts` (reads `EXPO_PUBLIC_STRIPE_*`); values in gitignored root `.env` |

**General cautions:** live Stripe + prod DB + Secret Manager. gcloud auth may need `gcloud auth login` (interactive). Confirm hard-to-reverse / money / customer-facing actions with the owner before acting.

**Delete this doc once Task A passes.**
