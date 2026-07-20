# Handoff — Stripe pack smoke test + analytics gap investigation

**Created:** 2026-07-20
**Context:** Follow-up to the "first paying customer got no credits" incident (resolved this session). Two independent tasks below; do either/both.

---

## Background (what just happened)

First paying customer (יהלי, `mamashlo99989@gmail.com`, `cus_UuXoQSTzKikZAH`) paid $10 but received no credits. Two root causes were found and fixed:

1. **`STRIPE_WEBHOOK_SECRET` had a trailing newline** → every live webhook rejected with a 400 signature error, so the credit-grant path never ran for anyone. Fixed: secret rolled + re-added cleanly (Secret Manager v4), `stripeWebhook` redeployed. Code now trims the secret + signature header — **PR #565 into `staging`** (`functions/src/stripeWebhook.ts`).
2. **Credit-pack Stripe price was `recurring`** → buying the "$10 credit pack" created a $10/mo subscription. Fixed: new one-time price `<redacted>` created, `STRIPE_CREDIT_PACK_PRICE_ID` repointed (backend `functions/.env.clanker-prod` + client `.env`), product `default_price` reassigned, old price `<redacted>` archived.

Customer recovery: subscription `<redacted>` canceled (immediate), credits manually set to 10,050.

**Verified:** a request signed with the new secret returns HTTP 200 from the deployed function (direct probe). What is NOT yet verified end-to-end: a real Stripe → function delivery succeeding, and a real pack purchase producing a one-time charge + credit grant from an updated client.

**In flight at handoff:** front-end web/OTA deploy carrying the new pack price id. Until it lands, un-updated native clients send the old price id and the backend rejects it with `Unknown priceId` (fail-closed, intended).

Full detail is in agent memory: `project_stripe_first_customer_incident.md`.

---

## Task A — End-to-end smoke test (do once the front-end deploy has landed)

**Goal:** prove the whole pack-purchase path works from an updated client: Stripe delivers → function verifies → credits granted → charge is one-time (not a subscription).

### Preconditions
- Front-end web/OTA deploy with `EXPO_PUBLIC_STRIPE_CREDIT_PACK_PRICE_ID=price_1TvHU6DTb0norRA0gqLmSkeO` is live.
- Use a real test purchase account you control (this is **live mode** — a real $10 charge; refund it after, or coordinate with the owner).

### Steps
1. From an updated web or mobile client, buy the **credit pack**.
2. Watch the webhook logs live during checkout:
   ```bash
   gcloud logging read 'resource.labels.service_name="stripewebhook" AND timestamp>="<now-ISO-UTC>"' \
     --project=clanker-prod --limit=30 \
     --format="value(timestamp,severity,jsonPayload.message,jsonPayload.type,httpRequest.status)"
   ```
   Expect: `"Received Stripe event"` → `checkout.session.completed` → `"checkout.session.completed: credits added"` → 200. **No** `"Stripe signature verification failed"`.
3. Confirm the Stripe object is a **one-time payment**, not a subscription:
   ```bash
   SK=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=clanker-prod | tr -d '[:space:]')
   # find the session/charge for your test customer, then:
   curl -s "https://api.stripe.com/v1/checkout/sessions/<cs_id>" -u "$SK:" \
     | python3 -c 'import sys,json;s=json.load(sys.stdin);print("mode:",s["mode"],"subscription:",s.get("subscription"))'
   ```
   Expect `mode: payment`, `subscription: None`.
4. Confirm credits landed: admin dashboard → your test user → credits increased by `CREDIT_PACK_AMOUNT` (10000 Power) with a ~31-day expiry.
5. Refund the test charge if appropriate. Note `charge.refunded` is handled and will deduct the granted credits proportionally.

### Idempotency note
The handler dedupes on `event.id` (`stripeEventDedupeService`) and on `session.id` as the credit `referenceId`, so Stripe retries won't double-grant. Safe to resend events.

### Optional: confirm the live webhook without a purchase
Resend any recent event from the **`cloudfunctions.net/stripeWebhook`** destination's own *Event deliveries* tab (not an event's history rows — those can point at the deleted `run.app` endpoint) and confirm a 200 + `"Received Stripe event"` in the logs.

---

## Task B — Investigate the analytics gaps

At session start the owner observed: Google Analytics "Drive sales" showed **$0 revenue** despite the $10 sale; BigQuery `clanker-prod` **Connections** page was empty; Firebase Analytics dashboard was just open. These are **separate from the credits bug** — do not conflate them.

### What's already known (start here)
- Client analytics wrapper: `src/services/analyticsService.ts` (native) + `src/services/analyticsService.web.ts` (web). It's a thin `logEvent` wrapper.
- Approved events are **funnel-only** (design: `docs/superpowers/specs/2026-07-05-firebase-analytics-design.md`, "Custom Events" table): `sign_up`, `terms_accepted`, `character_created`, `message_sent`, `voice_session_started`, `subscribe_flow_started`.
- **There is no `purchase`/conversion event.** `subscribe_flow_started` fires at flow *entry* (`app/(drawer)/subscribe.tsx`). The checkout success page (`app/checkout/success.tsx`) calls `refreshBootstrap('purchase')` — `'purchase'` is only a data-refresh reason string, **not** a GA4 event.

### Hypotheses to confirm/refute
1. **No revenue event is logged → GA4 revenue is always $0 (primary).** GA4 ecommerce reports need a standard `purchase` event with `value` + `currency` (+ optional `items`). None is emitted. Confirm by searching for any `purchase`/`value`/`currency` logEvent call — expect none.
2. **Purchase completes off-app (Stripe hosted checkout), so client analytics is a poor source of truth for revenue.** The reliable signal is server-side (the Stripe webhook). Consider whether revenue should be reported via **GA4 Measurement Protocol from the `stripeWebhook` function** (`checkout.session.completed` / `invoice.payment_succeeded`) rather than the client. Weigh against the spec's client-only scope.
3. **BigQuery: owner looked at the wrong page.** Firebase→BigQuery export creates a dataset named `analytics_<GA4_property_id>` (with `events_*` / `events_intraday_*` tables), **not** a "Connection." Verify:
   - Firebase console → Project settings → Integrations → **BigQuery** export enabled? (Spec "Console Operations" step 3 — manual, collects forward only.)
   - `bq ls --project_id=clanker-prod` → is there an `analytics_*` dataset? `bq ls clanker-prod:analytics_XXXX` → any `events_*` tables?
4. **GA4 property / measurement id wiring.** Web reads `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` (`firebaseConfig.web.ts`). Confirm it's populated and a GA4 property exists (spec "Console Operations" steps 1–2). If missing, web events go nowhere.

### Suggested deliverable
A short findings doc: which of the above are true, and a recommendation — minimally, add a GA4 `purchase` event (client on `app/checkout/success.tsx`, and/or server-side via Measurement Protocol in `stripeWebhook`) with `value`/`currency`, and finish the BigQuery-export console setup. If server-side is chosen, note that `checkout.session.completed` already resolves the user and amount is on the session (`amount_total`, `currency`).

### Cautions
- Read `docs/superpowers/specs/2026-07-05-firebase-analytics-design.md` fully before proposing changes — scope, consent wiring, and privacy constraints (no PII in params, no ad-id collection) are deliberate.
- Some steps are **manual console operations** the agent cannot do (creating the GA4 property, enabling BigQuery export). Surface those as owner actions.

---

## Reference

| Thing | Value |
|---|---|
| Project | `clanker-prod` (gcloud), Stripe acct `acct_1MVIIADTb0norRA0` |
| Webhook fn | `stripeWebhook` (Cloud Run service `stripewebhook`, region `us-central1`) |
| Live webhook destination | `https://us-central1-equationalapplications-com.cloudfunctions.net/stripeWebhook` (keep) + RevenueCat (keep). The `run.app` duplicate was deleted. |
| New pack price (one-time) | `price_1TvHU6DTb0norRA0gqLmSkeO` |
| Old pack price (archived) | `price_1TF2okDTb0norRA0Ja9S6QZk` |
| Subscription tiers | `STRIPE_MONTHLY_20_PRICE_ID=price_1TF2nZ…`, `STRIPE_MONTHLY_50_PRICE_ID=price_1TF2oA…` |
| Credit amounts | `functions/src/constants/credits.ts` — pack 10000, sub renewal 30000, signup 5000 (Power = credits ×100) |
| Webhook code | `functions/src/stripeWebhook.ts`, tests `functions/src/stripeWebhook.test.ts` |
| Checkout callable | `functions/src/purchasePackageStripe.ts` (mode derived from `price.type`) |
| Client price map | `src/config/constants.ts` (reads `EXPO_PUBLIC_STRIPE_*`); values in gitignored root `.env` |
| Analytics | `src/services/analyticsService.ts` / `.web.ts`; spec `docs/superpowers/specs/2026-07-05-firebase-analytics-design.md` |
| Open PR | #565 (secret/signature trim) → `staging` |

**General cautions:** live Stripe + prod DB + Secret Manager. gcloud auth may need `gcloud auth login` (interactive). Confirm hard-to-reverse / money / customer-facing actions with the owner before acting.
