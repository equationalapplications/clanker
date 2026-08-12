# Handoff — Stripe pack purchase smoke test

**Created:** 2026-07-20
**Updated:** 2026-07-20 (later session — see "Correction" below)
**Status:** Task A (smoke test) outstanding, deferred by owner. Task B (analytics) shipped; the one missed purchase has been backfilled.

---

## Correction — what actually fixed the payment outage

An earlier revision of this doc reported the first-customer incident as resolved by rolling `STRIPE_WEBHOOK_SECRET` and trimming it in code, and listed `https://us-central1-equationalapplications-com.cloudfunctions.net/stripeWebhook` as the live destination to "keep." **Both were wrong, and the outage continued for roughly a day afterward.**

The real cause: there are **two GCP projects**, `clanker-prod` (live) and `equationalapplications-com` (legacy, ~March 2026). Both had a full set of deployed functions with the same names. The Stripe webhook destination pointed at the **legacy** project, while every fix — the rolled secret, the `.trim()` code change, the GA4 purchase event — was deployed to `clanker-prod`, which received no real Stripe traffic. The legacy function kept running March code with an old secret and rejected every live event with `Stripe signature verification failed`.

The fix was **repointing the endpoint URL**, not the secret. The stored `STRIPE_WEBHOOK_SECRET` (v4, 38 bytes) had been correct all along.

Two lessons worth carrying forward:

- A `<region>-<projectId>.cloudfunctions.net` hostname encodes its project. Read the project id out of the URL before assuming which deployment it hits.
- A self-signed probe returning 200 only proves the function _you aimed at_ is healthy. It says nothing about where the vendor is delivering. Close a payments incident on real vendor traffic (`GET /v1/webhook_endpoints` plus a genuine delivery in the logs), never on a synthetic probe.

### Second bug found in the same pass

The endpoint's `enabled_events` barely overlapped the handler's `switch`. Stripe was sending `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, and three `customer.*.updated` types; the code handles `invoice.payment_succeeded`, `customer.subscription.updated`, and `charge.refunded` — none of which were subscribed. Net effect: **subscription renewals granted no credits** (`SUBSCRIPTION_RENEWAL`, 30000, never fired) and refunds never deducted. Fixed by setting `enabled_events` to exactly the five types the switch implements.

### Resolved state (verified 2026-07-20 ~19:00 UTC)

- Endpoint `we_1SCVd4DTb0norRA0K5dqQ3Pu` → `https://us-central1-clanker-prod.cloudfunctions.net/stripeWebhook`
- Real Stripe delivery verified: `Received Stripe event` → 200
- `enabled_events` = the five handled types
- Legacy project decommissioned: all 20 functions deleted, legacy URL now 404s
- Credit pack is a one-time price (`price_1TvHU6DTb0norRA0gqLmSkeO`); the old recurring price is archived

### Analytics backfill for the missed first purchase (done 2026-07-20 ~19:50 UTC)

The first real customer purchase (`<redacted>`, uid `<redacted>`, $10.00 USD, paid 2026-07-19T00:39:29Z) never reached GA4 — the event died with the rest of the legacy-project webhook traffic. It was replayed by hand through the Measurement Protocol with `timestamp_micros` set to the real payment time, so it lands on Jul 19 rather than the replay date.

The payload matched what `ga4MeasurementService` would have sent: `client_id` from `buildClientId(uid)`, `transaction_id` = session id, `value` 10.0, `currency` usd, one `credit_pack` item. Validated against `/debug/mp/collect` first (`validationMessages: []`), then posted to `/mp/collect` (204).

Three things to know if this ever needs repeating:

- **The Measurement Protocol only backdates 72 hours.** This replay had ~29h of that window left. Any purchase discovered later than 72h after the fact cannot be placed on its real date — the event is dropped outright, not clamped.
- **Realtime buckets by ingest time, not event timestamp**, so a backdated event _does_ show up there immediately — but its presence only proves ingestion, never that the backdate was honored. Standard reports (Monetization → Ecommerce purchases) are the only place the recorded date can be confirmed, 24–48h later.
- **BigQuery export was linked 2026-07-20**, so no `events_20260719` table will ever exist. The backdated event lands in the Jul 20 export carrying its Jul 19 timestamp. As of 19:55 UTC the `analytics_544289823` dataset had not been created yet — `bq ls` on the project returned nothing — so BigQuery was no help for same-day verification.

Attribution is the one thing that can't be recovered: the synthetic `client_id` carries no session or source, so this purchase reports as direct / `(not set)`. Revenue totals are right; channel reporting for this one sale is not.

#### Verification status

Monetization showed `$0.00` right after the send, which was pure processing lag, not a failure. To tell lag apart from a misrouted event without waiting a day, a throwaway `mp_connectivity_check` event was sent through the same credentials with **no** `timestamp_micros` — Realtime then showed both it and `purchase` at count 1, proving `G-TELW4E82QJ` + the API secret do reach property `544289823` and that the purchase was ingested. (That junk event name is now permanently in the property's event list; harmless, but don't be puzzled by it later.)

Still open until reports process: **which date the revenue lands on.** Jul 19 means the backdate held. Jul 20 means `timestamp_micros` was ignored — the amount and transaction id are still correct, and nothing can be done about the date, since GA4 events cannot be edited or deleted.

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
   ```

printf 'machine api.stripe.com login %s password x\n' "$SK" > "$NETRC"
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
```
