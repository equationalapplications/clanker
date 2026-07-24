# Spec — RevenueCat webhook correctness + unified purchase analytics

**Created:** 2026-07-24
**Status:** Approved

## Context

Billing is split by design: Stripe direct on web (`functions/src/stripeWebhook.ts`),
RevenueCat on native (`functions/src/revenueCatWebhook.ts`), unified in Cloud SQL
(`subscriptions` + credit ledger). The client reads entitlements from the backend via
bootstrap, never from the RC SDK, so cross-platform entitlements already work. This
architecture is intentional and is **not** changed by this spec.

A 2026-07-24 review found the RC webhook has correctness gaps (two of them money bugs)
and discards all revenue data, which is why RC sales never reach GA4 or BigQuery. The
GA4 → BigQuery daily export (`clanker-prod.analytics_544289823`) went live 2026-07-20
and currently contains exactly one `purchase` (the backfilled Stripe sale of
2026-07-19).

### Goals

1. RC webhook handles refunds, cancellations, and sandbox traffic correctly.
2. Every real purchase — Stripe or RevenueCat, any platform — produces a GA4 `purchase`
   event that lands in BigQuery, tagged with its payment provider.
3. Transaction-level revenue is queryable in BigQuery well enough to support due
   diligence for a future sale of the app (MRR, LTV, churn, refunds).

### Non-goals

- Re-architecting billing (no RC Web Billing, no RC Stripe integration — the ~1% RC fee
  on web revenue buys nothing we don't already have).
- Client-side purchase funnel instrumentation beyond what exists.
- Backfilling native purchase history (there are no historical native sales).

---

## Part A — RevenueCat webhook correctness

All changes in `functions/src/revenueCatWebhook.ts` + its tests
(`functions/src/revenueCatWebhook.test.ts`). Repo practice: TDD — write the failing
test for each behavior first.

### A1. Ignore sandbox events (money bug)

The handler never reads the `environment` field, so a TestFlight/sandbox purchase
grants production credits and tier.

- Extend `parseRevenueCatEvent` to extract `environment` (string, optional).
- If `environment === "SANDBOX"`: log at info, respond `200 {received: true,
  ignored: "sandbox"}`, no side effects. Return 200 (not 5xx) so RC does not retry.
- Test: sandbox `INITIAL_PURCHASE` for a credit pack grants nothing.

### A2. Handle refunds (`cancel_reason`) (money bug)

An RC refund arrives as `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"`.
Today every subscription `CANCELLATION` is treated as benign auto-renew-off
(`revenueCatWebhook.ts:500`), so a refunded subscriber keeps tier and credits until
`EXPIRATION`.

- Extend `parseRevenueCatEvent` to extract `cancel_reason` (string, optional).
- `CANCELLATION` + `cancel_reason === "CUSTOMER_SUPPORT"` + subscription product:
  - Downgrade immediately: `planTier: "free"`, `planStatus: "cancelled"`,
    `subscriptionProvider: null`.
  - Claw back the current cycle's renewal credits using the same per-cycle
    `referenceId` (`${original_transaction_id}_${expiration_at_ms}_refund`, keyed
    off the grant's `${original_transaction_id}_${expiration_at_ms}`), mirroring the
    proportional-deduction approach of Stripe's `handleChargeRefunded`. Floor at
    zero; never take the balance negative.
    - Edge case: some store refunds void the sub immediately and omit
      `expiration_at_ms`. Fall back to `transaction_id` for the key
      (`${original_transaction_id}_${transaction_id}_refund`) so the clawback still
      fires — still deterministic and idempotent via the `_refund` suffix. Skip
      (log `warn`) only if both `expiration_at_ms` and `transaction_id` are absent.
      Downgrade is unconditional regardless.
- Any other `cancel_reason` (`UNSUBSCRIBE`, `BILLING_ERROR`, …): current behavior
  (entitlement active, `cancelAtPeriodEnd: true`).
- Tests: refund downgrades + deducts; ordinary cancel does not.

### A3. Product-guard `CANCELLATION` and `EXPIRATION` (money bug)

Two unconditional downgrades fire regardless of which product the event is about:

- `CANCELLATION` for an unknown product (which includes the credit packs
  `credit_pack_100` / `credit_100`) falls into the else branch at
  `revenueCatWebhook.ts:519` and sets the user to `free/cancelled` — destroying an
  active subscription when a *pack* is refunded, and never deducting the pack credits.
- `EXPIRATION` (`revenueCatWebhook.ts:534`) downgrades unconditionally.

Changes:

- `CANCELLATION` with a credit-pack product = pack refund: deduct the granted pack
  credits, floored at zero (RC events carry no partial-refund amount — see Decision
  4), leave the subscription row untouched.
- `CANCELLATION` for a product that is neither a known tier nor a known pack:
  log-only. No downgrade.
- `EXPIRATION`: downgrade only when `normalizedProductId` maps to a known
  subscription tier; otherwise log-only.
- Tests: pack refund deducts credits and preserves an active sub; unknown-product
  cancellation/expiration are no-ops on the subscription row.

### A4. Missing event types

- `UNCANCELLATION`: user re-enabled auto-renew. Set `cancelAtPeriodEnd: false`,
  keep tier/status/renewal date. (Today the DB shows "cancelled at period end" until
  the next `RENEWAL`.)
- `BILLING_ISSUE`: log at warn, no state change (grace period — entitlement still
  active until `EXPIRATION`).
- `TRANSFER`: log at warn with both app user IDs. Full handling (re-pointing
  entitlements between users) is backlog; the log makes occurrences visible.

### A5. Double-subscribe gate (client)

`billing_provider_collision` (`revenueCatWebhook.ts:387`) only logs; a user with an
active Stripe subscription can buy again via RC and pay twice.

- Client: in the purchase UI path (`src/utilities/makePackagePurchase.ts` callers /
  `CreditsDisplay`), when bootstrap shows an active subscription with
  `subscriptionProvider` different from the current platform's provider, block the
  subscription purchase with: "You already have an active subscription. Manage it on
  the platform where you subscribed." Credit-pack purchases stay allowed.
  - **Prereq (2026-07-24 finding):** the client bootstrap does **not** currently expose
    `subscriptionProvider`. `SubscriptionSnapshot` (`src/auth/bootstrapSession.ts:19-28`)
    carries `planTier`/`planStatus` only, and `exchangeToken.ts` (~158-167) does not emit
    the field. So this gate has added scope: emit `subscriptionProvider` from
    `exchangeToken` (the DB row from `subscriptionService.getSubscription` already
    contains it), widen `SubscriptionSnapshot` + `normalizeBootstrapResponse` to
    `'stripe' | 'revenuecat' | null`, then read it in `CreditsDisplay`.
- Backend: **already implemented** (2026-07-24 finding) — `purchasePackageStripe.ts:150-166`
  already rejects a *subscription* checkout with `HttpsError("already-exists", …)` when an
  active RC subscription exists (fail-closed, message surfaced by the client). Remaining
  work is a regression test only, not new code. The RC side cannot be blocked server-side
  (the store transaction completes regardless), so for native the client gate is the
  primary defense and the collision log remains the tripwire.
  - Note: the shipped backend message is *"You already have an active subscription on
    mobile. Manage it in the App Store or Play Store."* Reconcile with the client wording
    above (pick one) so both providers present a consistent message.
- Test: active RC sub → Stripe subscription checkout rejected; credit-pack checkout
  and resubscribe-after-expiry still allowed.

### A6. Parse extension (shared by A1–A5 and Part B)

Extend `parseRevenueCatEvent` to optionally extract, with lenient validation
(absent/null tolerated, wrong type rejected):

`environment`, `cancel_reason`, `store`, `transaction_id`, `purchased_at_ms`,
`period_type`, `price`, `price_in_purchased_currency`, `currency`, `country_code`.

### A7. Stale-bundle price-id error UX (client)

`purchasePackageStripe` fails closed on unknown price ids
(`HttpsError("invalid-argument", "Unknown priceId: …")`,
`purchasePackageStripe.ts:147`) — correct backend behavior, but a web user with a
long-lived tab or cached bundle sends the old price id and the client shows
"Purchase failed. Please try again." (`CreditsDisplay.tsx`), which retrying cannot
fix.

- Map `functions/invalid-argument` on the purchase path to a distinct message:
  "This app version is out of date — please refresh and try again."
- Test: mocked `invalid-argument` rejection renders the refresh message; other
  errors keep the generic one.
- Ships with PR 2.

---

## Part B — Purchase analytics into BigQuery

### B1. GA4 purchase events from the RC webhook

`functions/src/services/ga4MeasurementService.ts` already sends `client_id =
buildClientId(uid)` **and** `user_id = uid`, and swallows its own errors (never
fails the caller). Reuse it.

- Generalize `PurchaseEventParams`: accept a decimal `value` + `currency` (RC
  supplies decimals; Stripe path keeps `valueMinorUnits` and converts as today),
  plus `paymentProvider: "stripe" | "revenuecat"`, `items` (id/name), and optional
  `store` and `periodType` params.
- RC webhook sends `purchase` on: `INITIAL_PURCHASE`, `RENEWAL`,
  `NON_RENEWING_PURCHASE` — after side effects succeed, never for SANDBOX (A1
  short-circuits earlier).
  - `transaction_id` = RC `transaction_id` (fall back to
    `${original_transaction_id}_${expiration_at_ms}` for renewals if absent).
  - `value` = `price_in_purchased_currency`, `currency` = `currency`. If price
    fields are absent, log and skip the event — never guess revenue.
- RC refunds (A2/A3 paths) send a GA4 `refund` event with the same
  `transaction_id`.
- Stripe webhook call site (`stripeWebhook.ts:487`) adds
  `paymentProvider: "stripe"`.
- Failure isolation requirement: a GA4 failure must never fail the webhook response
  (already the service's behavior; add a test asserting it for the RC path).

### B2. Double-count guard

The Firebase native SDK can auto-log `in_app_purchase` for store transactions. If
that fires alongside B1's server-side `purchase`, native revenue double-counts.

- After the first native test purchase, check the BQ export for `in_app_purchase`.
- If present: prefer disabling auto-collection
  (`google_analytics_automatic_screen_reporting` is unrelated — use the platform
  IAP-reporting flags) or, failing that, exclude `in_app_purchase` from the
  canonical views (B3) and document why.
- Decision deferred to implementation; the canonical views must count each
  transaction exactly once either way.

### B3. Canonical BigQuery views

New dataset `clanker_analytics` (keeps hand-written views out of the auto-managed
GA4 dataset). Two views, checked into the repo as SQL files (suggested:
`analytics/bq/`), applied via `bq` in a documented one-liner:

- **`v_purchases`** — one row per transaction: `transaction_id`, `user_id`
  (Firebase UID), event date/timestamp, `value`, `currency`, `payment_provider`,
  `store`, item id, and a `refunded` flag joined from `refund` events. Source:
  server-sent `purchase`/`refund` events in `analytics_544289823.events_*`.
- **`v_user_journey`** — corrected version of the journey query: bounded
  `_TABLE_SUFFIX` on **both** inner and outer scans, `%Y%m%d` (the advice draft had
  `%Y%m%m`), filters on real event names (`subscribe_flow_started`, `purchase`,
  `screen_view`, `page_view`) rather than URL guessing, joins on `user_id` with
  `user_pseudo_id` retained for pre-login stitching.

Note: daily export only — tables land ~24h behind. No `events_intraday_*` exists;
any "today" query returns nothing. **Decision (owner, 2026-07-24): stay daily-only;
do not enable streaming export.** Views must not reference `events_intraday_*`.

### B4. RC Scheduled Data Exports → GCS → BQ (deferred)

Webhook-derived GA4 events are good for behavior but are not payout truth (no
store commission, tax, or proceeds). RC's Scheduled Data Exports deliver daily
transaction-level CSVs covering exactly that.

**Deferred (owner decision 2026-07-24):** the current RC plan does not include the
feature. Revisit when native revenue exists or a sale process needs payout-level
reconciliation. Design retained for that day:

- Setup: GCS bucket in `clanker-prod` → RC daily export → BigQuery scheduled load
  (or external table) into `clanker_analytics.rc_transactions`.
- Reconciliation story for due diligence: RC export (store payout truth) ↔ Cloud SQL
  ledger (entitlement truth) ↔ GA4/BQ (behavioral truth), joinable on transaction
  id / user id.

Until then, B1's webhook-derived GA4 events plus the Cloud SQL ledger are the
transaction record; gross revenue (not net proceeds) is what BQ can answer.

### B5. Docs

Write `docs/billing-architecture.md`: the two-provider split, why it's intentional,
webhook event → side-effect matrix (both providers), analytics flow diagram, and the
BQ dataset/view inventory. Replaces tribal knowledge currently spread across handoff
docs.

---

## Verification

- Unit tests per behavior branch (A1–A4, B1) in the two webhook test files.
- Live, post-deploy:
  1. RC dashboard test event → 200, no side effects (existing `TEST` path).
  2. Sandbox purchase from TestFlight → webhook logs "ignored sandbox", no credits.
  3. First real native purchase (coordinate with owner — real money): credits in
     admin dashboard, `purchase` with `payment_provider=revenuecat` in GA4 Realtime,
     row in next day's BQ export, `v_purchases` shows it exactly once (B2 check).
  4. Refund that purchase (Play Store side is easiest — RC can issue it): credits
     deducted, `refund` event lands, `v_purchases.refunded` flips.
- The outstanding Stripe smoke test
  (`docs/handoff/2026-07-20-stripe-smoketest-and-analytics.md` Task A) can fold into
  the same session.

## Suggested sequencing

1. A6 parse extension (foundation) → A1 sandbox guard → A3 product guards → A2
   refunds — the money bugs, one PR.
2. A4 event types + A5 client gate (incl. `subscriptionProvider` bootstrap plumbing) +
   A5 backend guard regression test (guard already shipped) + A7 stale-bundle UX —
   second PR.
3. B1 GA4 events + Stripe provider tag — third PR.
4. B3 views + B5 docs — fourth PR (no deploy risk).
5. B4 RC export — deferred (see B4).

PRs target `staging` per `docs/GIT_WORKFLOW.md`.

## Decisions (owner, 2026-07-24)

1. **RC Scheduled Data Exports**: not on current plan — B4 deferred until native
   revenue or sale process justifies the upgrade.
2. **Backend double-subscribe guard**: build it — `purchasePackageStripe` rejects
   subscription checkout when an active RC subscription exists (A5). *(Update
   2026-07-24: already shipped at `purchasePackageStripe.ts:150-166`; remaining work
   is a regression test only.)*
3. **GA4 export**: stay daily-only; no streaming export.
4. **Refund clawback**: proportional, mirroring the Stripe path. Rationale: a
   partial refund (e.g. 50% via Stripe) must claw back exactly that fraction of the
   granted credits so the internal ledger stays mathematically aligned with the
   financial ledger; full-amount clawback on a partial refund would unfairly
   penalize the user. Note for RC: `CANCELLATION` events carry no partial-refund
   amount — store refunds are effectively full-amount, so the RC path deducts the
   full grant (still floored at zero); the proportional math matters chiefly on the
   Stripe path, where it is already implemented.
