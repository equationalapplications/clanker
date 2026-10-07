# Stripe Payment-Authorized Credits & Payload-Version Contract — Design

**Date:** 2026-09-17 (revised 2026-10-06 — see "Revision 2026-10-06" below)
**Status:** Draft
**Resolves:** Security review finding on `main` (`functions/src/stripeWebhook.ts:701`) — subscription
credits granted for unpaid subscription states; plus two dead grant paths discovered while validating it.
**Scope:** `functions/` only. No client or RevenueCat changes. Credit-pack _grant_ logic is unchanged;
credit-pack _refund_ lookup is in scope only as far as the endpoint version flip requires (§1).

## Revision 2026-10-06

Re-verified against staging `f162964b`. Changes from the 2026-09-17 draft:

- **The SDK version moved under this spec.** PR #788 bumped `stripe` 22.5.0 → **23.0.0**, which pins
  **`2026-09-30.endive`**, not `2026-07-29.dahlia`. This is the silent drift open question 3 warned
  about, and it already happened once. Endive changes no field this spec reads — both dahlia and endive
  are in the `basil`-and-later family (periods on subscription items, invoice subscription under
  `invoice.parent`) — so the Defect 2 analysis holds. Version references below now say "SDK version
  (basil-family)" instead of naming dahlia, and the explicit pin moves from the follow-up PR into step 1
  (open question 3).
- **The version flip breaks `charge.refunded`.** Missed in the original draft: `basil` also removed
  `Charge.invoice`. The refund handler reads it from the event payload, so after the endpoint flip it
  can no longer detect subscription refunds, or find credit-pack quantities via the invoice. Added a
  fourth accessor (§1), tests, and a risk row.
- **A paid invoice whose user cannot be resolved must be retried, not dropped** (§2).
- **Both `new Stripe(...)` sites need the pin**, not only the webhook's (open question 3).
- New open question 4 (100%-discount invoices). Line references refreshed.
- Open questions 2 (trials) and 4 (100% discounts) decided by the product owner. Both keep the
  `amount_paid > 0` guard.

## Problem

Two independent defects in the Stripe webhook, both confirmed against production configuration on
2026-09-17.

### Defect 1 — credits granted without payment (security)

`mapStripeSubscriptionStatus` (`stripeWebhook.ts:260-279`) collapses `past_due`, `unpaid`,
`incomplete`, `trialing` and any unknown future status onto the application status `'active'`:

```ts
case 'active':
case 'trialing':
case 'past_due':
case 'unpaid':
case 'incomplete':
  return 'active'
```

`handleSubscriptionUpdated` then authorizes a full credit grant off that mapped value
(`stripeWebhook.ts:701-717`):

```ts
if (planStatus === 'active') {
  const periodEnd = (sub as unknown as StripeSubRuntime).current_period_end
  if (typeof periodEnd === 'number' && Number.isFinite(periodEnd)) {
    ...
    await deps.renewSubscriptionCredits(user.id, SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT, cycleEnd, referenceId)
```

`renewSubscriptionCredits` (`services/creditService.ts:459-502`) inserts a real, spendable ledger row
of `SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT` (30,000 units, `constants/credits.ts:3`) and then expires every
other live subscription pool for that user. Spending never re-checks Stripe payment state.

Signature verification (`stripeWebhook.ts:418-425`) proves the event is **authentic**, not that the
customer **paid**. No guard closes the gap:

- The event dedupe service (`services/stripeEventDedupeService.ts:28-68`) and the
  `(userId, reason, referenceId)` unique constraint (`db/schema.ts:120-123`) block a _repeat_ grant for
  an already-granted period. They do not block the _first_ grant for a new period.
- `invoice.payment_succeeded` is an additional grant path, not a gate. Its absence never blocks anything,
  and there is no `invoice.payment_failed` handler to compensate.
- `upsertSubscription` (`services/subscriptionService.ts:81-132`) persists whatever status it is given.

Two consequences, not one. The grant both **mints unearned credits** and, because it expires prior pools,
**destroys the remaining balance of the period the customer actually paid for**.

**Worst case is not renewal.** `incomplete` is a brand-new subscription whose _first_ payment never
succeeded: 30,000 spendable credits for a customer who has paid nothing, ever. `unpaid` means Stripe has
exhausted every retry.

### Defect 2 — two of three grant paths are dead (correctness)

The webhook destination `we_1SCVd4DTb0norRA0K5dqQ3Pu` is pinned to API version **`2022-11-15`**
(verified in the Dashboard, 2026-09-17). The SDK sends its own pinned version on every API call it
makes, regardless of the endpoint's pin, and `new Stripe(secretKey)` (`stripeWebhook.ts:251`) passes no
`apiVersion` override. When this spec was drafted that was `stripe@22.5.0` → **`2026-07-29.dahlia`**;
since PR #788 (2026-10-06) the lockfile resolves `stripe@23.0.0` → **`2026-09-30.endive`**
(`node_modules/stripe/cjs/apiVersion.js`). Which of the two the _deployed_ function sends depends on
when `functions/` was last deployed; both are basil-family and behave identically for every field below.
"SDK version" in the rest of this document means whichever basil-family version the SDK pins.

So the three grant sites read _different payload shapes_:

| Grant site                             | Subscription object from   | Version in effect  | Grants today                  |
| -------------------------------------- | -------------------------- | ------------------ | ----------------------------- |
| `customer.subscription.updated` `:702` | webhook event payload      | `2022-11-15`       | **Yes** — the vulnerable path |
| `checkout.session.completed` `:569`    | `subscriptions.retrieve()` | SDK (basil-family) | **No**                        |
| `invoice.payment_succeeded` `:785`     | `subscriptions.retrieve()` | SDK (basil-family) | **No**                        |

API version `2025-03-31.basil` moved `current_period_start` / `current_period_end` off the subscription
onto its items, so under the SDK version the retrieved object has no top-level `current_period_end`; both sites
fall through to `logger.warn('... missing or invalid current_period_end')` and grant nothing.

`handleInvoicePaymentSucceeded` is dead twice over. It locates the subscription via a **basil-and-later**
field (`stripeWebhook.ts:777`, added 2026-05-22 in `d923a1da`):

```ts
const subscriptionId = getStripeId(invoice.parent?.subscription_details?.subscription as ...)
```

`invoice.parent` does not exist in `2022-11-15` payloads — the old shape carries top-level
`invoice.subscription`. On this endpoint `subscriptionId` is always `null` and the handler returns
without doing anything for subscriptions.

The net position: the codebase is split across two payload shapes, exactly one matches the endpoint, and
the only functioning subscription-credit path is also the insecure one. The comments at `:177`, `:568`
and `:700` asserting `current_period_end` is "present at runtime" are true only for the event payload,
and only because of the legacy pin.

## Goals

1. A subscription credit grant requires **evidence that an invoice was paid**. Delinquent and incomplete
   states never mint credits.
2. All three code paths read Stripe payloads through an explicit, tested version contract rather than
   ad-hoc casts.
3. Initial-purchase and renewal credits are granted reliably again (they are not, today, except by the
   accidental `customer.subscription.updated` path).
4. Deploying the change cannot interrupt credit delivery for existing subscribers, in either payload
   shape, at any point in the rollout.
5. The endpoint is moved off `2022-11-15` onto the SDK's version, without a flag-day cutover.

## Non-goals

- **Trial credit policy.** Under this spec a `trialing` subscription receives **no** grant: a trial
  has no paid invoice, and the paid invoice is the sole grant path (§2). Today the legacy
  `customer.subscription.updated` path mints one — that accidental grant is removed, not preserved.
  A converting trial's first paid invoice grants normally. **Decided (2026-10-06): trials receive no
  subscription grant** (open question 2).
- **Grace-period / access policy.** How a `past_due` subscriber's _access_ behaves is unchanged; only
  credit authorization moves. `planStatus` remains display and telemetry only, with one **pre-existing**
  exception: it also gates the billing-provider-collision warnings at `revenueCatWebhook.ts:595` and
  `:675`, where `existingSubscription.planStatus === 'active'` (which `past_due`/`unpaid`/`incomplete`
  still map to) triggers the warning before a RevenueCat subscription overwrites the Stripe row. That
  behavior exists today and is unchanged by this spec (the mapping is kept, §2); it is noted so nobody
  reads "delinquent Stripe subscribers no longer get credits" as "they can no longer trip the collision
  warning." The remaining consumers are admin filters, `usageSnapshot` passthrough, and the
  cross-provider duplicate-purchase guard at `purchasePackageStripe.ts:145`.
- **Historical clawback.** No automatic reversal of credits already granted under the old logic.
- **Clawback on future refunds and disputes.** Also out of scope, and worth stating precisely because
  the current behavior is asymmetric. `handleChargeRefunded` deducts credits for a refunded **credit
  pack**, pro-rated by refund amount and idempotent across partial refunds. For a refunded
  **subscription** charge it takes the other branch: it cancels the subscription (`planTier: 'free'`,
  `planStatus: 'cancelled'`) and emits the GA4 refund event, but **never deducts the cycle's 30,000
  credits**, which remain spendable. There is no `charge.dispute.created` handler at all, and disputes
  are not among the destination's five enabled events, so a chargeback revokes nothing and does not
  even reach the service. Once grants are payment-authorized, these become the remaining path to
  credits without net payment. Tracked as a follow-up, not fixed here.
- RevenueCat, credit packs, and all client code are untouched.
- No package upgrades. `stripe`, `firebase-admin` and `firebase-functions` are all on current majors;
  the stale value is the endpoint's API-version setting, not a dependency.

## Design

### 1. Version-tolerant accessors

A small module with the payload knowledge in one place, covering both shapes, so no handler carries an
inline cast:

```ts
// functions/src/stripe/payloadCompat.ts
export function getSubscriptionPeriodEnd(sub: unknown): number | null
//   <= 2025-03-31.basil : sub.current_period_end
//   >= basil            : sub.items.data[*].current_period_end  (max across items)

export function getInvoiceSubscriptionId(invoice: unknown): string | null
//   <= basil : invoice.subscription
//   >= basil : invoice.parent.subscription_details.subscription

export function getInvoiceLinePeriodEnd(invoice: unknown, subscriptionId: string): number | null

export async function getChargeInvoiceId(stripe: Stripe, charge: unknown): Promise<string | null>
//   <= basil : charge.invoice  (event payload on the 2022-11-15 endpoint)
//   >= basil : Charge.invoice was removed; resolve through the InvoicePayment that links them:
//              stripe.invoicePayments.list({ payment: { type: 'payment_intent',
//                                                       payment_intent: charge.payment_intent } })
```

These replace `StripeSubRuntime` (`:178`) and the three cast sites. Each returns `null` rather than
guessing, and callers log a distinguishable warning on `null` so a future version drift is visible in
logs instead of silent.

`getChargeInvoiceId` exists because the endpoint flip in §4 affects more than the grant paths.
`handleChargeRefunded` (`:861`) reads `charge.invoice` from the event payload (`:879`) to decide whether a
refund belongs to a subscription (which cancels it) and how many credit packs a refunded invoice held.
`2025-03-31.basil` removed `invoice` from `Charge`. Without the accessor, after step 2 every refund looks
like a non-invoice charge: subscription refunds stop cancelling the subscription, and credit-pack refunds
fall back to `charge.metadata` only. The invoice it returns is fetched with `stripe.invoices.retrieve`, so
it is already in the SDK shape, and the existing `invoice.parent?.subscription_details` check (`:884`)
keeps working. This adds no new clawback behavior (see non-goals); it only stops the flip from breaking
the refund handling that exists today.

### 2. Payment-authorized grants

- `handleSubscriptionUpdated` becomes **metadata-only**: it keeps `upsertSubscription` and its logging
  and no longer grants credits. The `if (planStatus === 'active')` block at `:701-717` is deleted.
- `handleCheckoutCompleted` likewise stops granting subscription credits (`:560-590`). Checkout
  completion is not proof of a paid invoice for every payment method. Credit-pack handling in the same
  function is unchanged.
- `handleInvoicePaymentSucceeded` becomes the **sole** subscription grant path, handling both
  `billing_reason === 'subscription_create'` (initial purchase — today it only emits the GA4 purchase
  event and grants nothing) and `'subscription_cycle'` (renewal), and asserting before granting:
  - `invoice.status === 'paid'` and `amount_paid > 0` (open questions 2 and 4). Use `status`, not the
    boolean `invoice.paid`, which basil removed;
  - the subscription's price resolves to a known tier via `getTierByPriceId`;
  - the customer resolves to a user through the existing `resolveUserForStripeCustomer` path, not
    `customer_email` alone (today's handler at `:770-773` uses email only, which is weaker than the
    resolution used everywhere else).
- **A paid subscription invoice whose user cannot be resolved throws**, so the handler returns 500 and
  Stripe retries. Today the handler returns silently (`:771-773`), and the event is then marked
  processed, so the grant is lost for good. Once the invoice is the only grant path, that silent return
  would drop a paying customer's credits. Ordering makes this realistic: Stripe does not order
  `invoice.payment_succeeded` (`subscription_create`) relative to `checkout.session.completed`, so the
  invoice can arrive before checkout has stored the customer id. Resolution usually still succeeds
  through the `firebase_uid` metadata set at customer creation (`purchasePackageStripe.ts:71`), and a
  retry covers the cases where it doesn't. The existing `unmarkEventProcessed` path already makes a
  retried event reprocess. An **unknown price** does not throw (a retry cannot fix it). It logs at
  error level and skips, as in the test plan. Recovery for the affected invoice is an operator task;
  see §2.1.

#### 2.1 Operator recovery for unknown-price invoices

Stripe considers an event delivered on the first 2xx response and does not redeliver a previously
acknowledged event id, so fixing the price mapping later does not auto-claim the original grant.
The event dedupe also keeps the event marked processed. The customer's invoice is therefore uncredited
until an operator acts.

Recovery procedure:

1. The error log (price id + `event.id` + customer id, if available) identifies the invoice. Pull the
   affected invoice from Stripe, confirm `status === 'paid'` and `amount_paid > 0`, and confirm the
   missing tier is now in `StripePriceIds`.
2. Grant the missing credits through the **admin dashboard's additive grant path**, with reason
   `admin_manual` (distinct from `subscription` / `stripe_topup` so it is filterable in the ledger and
   does not interact with the idempotency keys in §3). The additive action must **not** read-modify-write
   the user's active balance: it inserts a ledger row, leaving other active credits (signup grant, prior
   ad-hoc grants, paid packs) in place.
3. `adminSetUserCredits` (functions/src/adminFunctions.ts:320) **is not** a safe recovery tool — it
   replaces the active balance. It may only be used on accounts the operator has first backed up, or
   on accounts with no live credits outside the change being made. Add a sibling additive action as
   part of this work; do not reuse `adminSetUserCredits`.

The integration suite covers (b) directly: an unknown-price event produces no ledger row, an additive
admin grant produces exactly one `admin_manual` row, and other rows on the same user are untouched.

- The GA4 purchase emission in the same handler (`:805-831`) is unchanged.

`mapStripeSubscriptionStatus` keeps its current mapping — it now feeds only display state — but gains a
comment stating that it is **not** an authorization signal, so the coupling cannot silently return.

### 3. Idempotency and the migration hazard

The existing key is `sub_${subscriptionId}_${periodEnd}`, and grants **already exist in the ledger** under
it (the `customer.subscription.updated` path has been live). If the new code derives `periodEnd` from a
different source and gets a different integer for the same cycle, the unique constraint will not match and
a live subscriber receives a **second** 30,000-credit grant — which also expires their current pool.

Rules:

- Keep the key format `sub_${subscriptionId}_${periodEnd}` exactly.
- Derive `periodEnd` for the grant from the **invoice line matching that subscription**, which is the
  authoritative period for the invoice actually paid, and is stable for out-of-order or delayed events.
- Before granting, also probe for a row under the subscription-object period end; if either key is
  present, treat it as already granted.
- A grant whose period end is in the past (a replayed or late invoice) is logged and skipped, never
  written, so it cannot expire a newer pool.

Residual hazard — **deploy overlap**: 2nd-gen Cloud Functions runs on Cloud Run, so a deploy routes new
requests to the new revision while in-flight requests finish on the old one. An old-revision
`customer.subscription.updated` grant can therefore interleave with a new-revision invoice grant for the
same cycle. The dual-key probe above is check-then-act: both handlers can probe, both miss (each under
its own key), and both grant, because `renewSubscriptionCredits`'s uniqueness guard covers only the exact
`reference_id`. The implementation must close this window one of two ways — decide at implementation
time and cover it with a test:

- serialize the legacy-key lookup and grant behind a per-subscription-cycle lock (e.g. a row lock on the
  subscription inside the grant transaction), or
- define one canonical cycle key that both the legacy and invoice paths derive identically, chosen to
  match existing legacy ledger rows.

### 4. Rollout order

The endpoint flip and the deploy cannot be simultaneous, and the currently-working path reads the old
shape. Sequence:

1. **Ship this PR's implementation.** Accessors handle both shapes; grants become payment-authorized.
   Both clients get an explicit `apiVersion` pin set to the version the SDK already sends (open question 3),
   so the pin changes no behavior. Safe under `2022-11-15` and under the SDK version. No Stripe
   configuration change.
2. **Replace the destination.** `api_version` is **not** an updatable field — the Update webhook
   endpoint API accepts only `description`, `disabled`, `enabled_events`, `metadata` and `url`. The
   version can only be set at creation. So moving off `2022-11-15` means creating a _new_ destination at
   the same URL with `api_version` set explicitly, then retiring `we_1SCVd4DTb0norRA0K5dqQ3Pu`.

   Each destination has its **own signing secret**, and the handler reads a single
   `STRIPE_WEBHOOK_SECRET` (`stripeWebhook.ts:392`), so a naive swap makes in-flight deliveries fail
   signature verification. This PR's implementation therefore also accepts an optional
   `STRIPE_WEBHOOK_SECRET_NEXT` and tries each in turn in `constructEvent`, making the cutover
   non-breaking and reversible:

   1. Create the new destination with `api_version` equal to the pinned client version from step 1 (as
      of this revision, `2026-09-30.endive`) and the same five events.
   2. Add its signing secret as `STRIPE_WEBHOOK_SECRET_NEXT` **in two places**: create the secret (with
      a version) in Secret Manager, and add the name to the `secrets: [...]` array in
      `functions/src/stripeWebhook.ts` — Firebase Functions only injects secrets listed there, and the
      deploy fails outright if the Secret Manager version does not exist yet. Deploy; confirm both
      destinations verify.
   3. While both destinations are enabled — from step 2 until this step — both deliver the same event
      ids and the existing event dedupe drops the duplicate, so no double grant during the overlap.
      Then disable (do not delete) the old destination; a disabled destination delivers nothing, which
      is what ends the overlap.
   4. Promote the new secret to `STRIPE_WEBHOOK_SECRET`, drop `_NEXT`, delete the old destination.

3. **Follow-up PR** removes the legacy (`2022-11-15`) branch from the accessors once step 2 is confirmed in
   production. The pin is already in place from step 1.

Step 2 is a live Stripe configuration change and is performed by the account owner, not by CI or an agent.

## Test plan

`functions/` uses `node --test` over compiled output (see `functions/package.json`) — there is no
`src/__tests__/` directory and no Jest in this package. Unit tests are co-located at
`src/stripeWebhook.test.ts` and compile to `lib/`; the integration suite lives at
`src/integration/stripeWebhook.int.test.ts` and compiles separately (`tsconfig.int.json`) to
`lib-integration/`. Run scoped:

```
(cd functions && NODE_ENV=test npm run build && NODE_ENV=test node --test lib/stripeWebhook.test.js)
(cd functions && npm run test:integration)
```

(bare `npm test -- <path>` does not filter in this repo).

Fixtures must exist in **both** payload shapes — the current fixtures are synthetic top-level-period
shapes only, which is why Defect 2 was invisible to CI.

Authorization:

- `customer.subscription.updated` with `past_due`, `unpaid`, `incomplete`, `trialing`, and an unknown
  status: subscription row updates, ledger balance strictly unchanged.
- `checkout.session.completed` for a subscription price: no subscription credit row.
- Paid `subscription_create` invoice: exactly one grant.
- Paid `subscription_cycle` invoice: exactly one grant.
- Unpaid / `amount_paid: 0` invoice: no grant. (This is also the trial-start case — see non-goals.)
- Unknown price id: no grant, **and** an error is logged identifying the unrecognized price, so a
  tier added in Stripe but not in `StripePriceIds` is visible in logs instead of silently
  dropping a paying customer's credits. The handler does not throw (a retry cannot fix it).
- Operator recovery (§2.1): after an unknown-price event has been logged for `event.id` _E_, calling
  the dashboard's additive grant action for the affected user inserts exactly one ledger row with
  reason `admin_manual`, leaves every prior row on that user untouched, and does not re-process _E_
  (the dedupe service still reports _E_ as processed).
- Paid subscription invoice whose customer resolves to no user: the handler throws, the event is
  unmarked, and the response is 500. A redelivery after the user becomes resolvable grants exactly once.
- Paid `subscription_create` invoice delivered **before** `checkout.session.completed`, for a customer
  with only `metadata.firebase_uid` (no stored customer id yet): resolves and grants once; the later
  checkout event grants nothing.

Idempotency and ordering:

- Duplicate delivery of the same paid invoice: one grant.
- A period already granted under the old `customer.subscription.updated` key: no second grant.
- Late invoice whose period end is in the past: no grant, no pool expiry.

Version contract:

- Every accessor, against a `2022-11-15` fixture and a basil-family (endive) fixture.
- A regression test asserting a paid initial purchase and a paid renewal each produce exactly one grant
  in **both** shapes — the guard that would have caught Defect 2.
- `charge.refunded` for a subscription invoice in **both** shapes: a legacy charge carrying `invoice`,
  and a basil-family charge without it, resolved through `invoicePayments.list`. Both must detect the
  subscription refund and cancel the subscription, as today. Same for a credit-pack invoice refund (both
  shapes deduct the same pro-rated amount).

## Verification before deploy

- [ ] Confirm the endpoint's enabled events still include `invoice.payment_succeeded`. (Verified
      2026-09-17: all five enabled events match the handler switch exactly.)
- [ ] Query the ledger for `reason = 'subscription'` rows and their `reference_id` values, to size the
      migration hazard in §3 against real data before deploying.
- [ ] Confirm the installed SDK's pinned version (`functions/node_modules/stripe/cjs/apiVersion.js`, after
      `npm ci`) matches the `apiVersion` literal in both clients. Typecheck enforces this, but the step-2
      destination must use the same string.
- [ ] After deploy, confirm the new revision actually took traffic before trusting any log evidence.
- [ ] After the step-2 flip, confirm a real event produces a grant, and a test-mode refund of a
      subscription charge still cancels the subscription.

## Risks

| Risk                                                                                              | Mitigation                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Double grant on deploy from a changed period key                                                  | §3 dual-key probe; ledger audit in the pre-deploy checklist                                                                 |
| Double grant from old/new revision overlap during deploy (probe is check-then-act across keys)    | §3 residual hazard: cycle lock or canonical key, decided and tested at implementation                                       |
| Credit delivery stops during the destination cutover                                              | §4 tolerant readers deployed first; dual signing secret; old destination disabled rather than deleted                       |
| Duplicate deliveries while both destinations are live                                             | Same event id to both; existing event dedupe drops the second                                                               |
| `subscription_create` path was never exercised, so initial-purchase grants are newly written code | Explicit fixtures for both billing reasons; step-2 verification with a real event                                           |
| A future Stripe version drifts the shape again                                                    | Accessors return `null` and log distinctly rather than silently skipping; explicit pin fails typecheck on an SDK major bump |
| Endpoint flip breaks refund handling (`Charge.invoice` removed in basil)                          | §1 `getChargeInvoiceId`; dual-shape refund tests; post-flip test-mode refund check                                          |
| Paid invoice arrives before the user is resolvable and the grant is lost                          | §2 throw → 500 → Stripe retry; existing unmark-on-error path                                                                |

## Open questions

1. Should credits already granted for unpaid periods be reconciled? Default per non-goals: no.
2. ~~Trial credit policy?~~ **Decided (2026-10-06): no grant during a trial.** The 30,000-Power
   subscription grant waits for the first paid invoice. New accounts already receive the 5,000-Power
   signup grant, which never expires (`getOrCreateDefaultSubscription`; amounts per
   `2026-07-07-power-meter-credit-inflation-design.md`). That grant is the intended way to try the app.
   Granting at trial start would let anyone who repeatedly opens and cancels trials collect 30,000 Power
   each time without paying. With the paid invoice as the only grant path, no trial-specific code is needed.
3. ~~Pin `apiVersion` explicitly at client construction?~~ **Decided: yes, in step 1** (revised
   2026-10-06; the original draft deferred it to the follow-up PR). The drift this guards against already
   happened once during review: #788 moved the SDK from dahlia to endive with no code change. Construct
   **both** clients — `stripeWebhook.ts:251` and `purchasePackageStripe.ts:28` — with
   `new Stripe(secretKey, { apiVersion: '2026-09-30.endive' })`, ideally through one shared factory so the
   literal exists in one place. The literal must include the `.endive` suffix: `StripeConfig.apiVersion`
   is typed as `LatestApiVersion`, the SDK's exact current version string. That typing is also the
   tripwire. The next major SDK bump changes `LatestApiVersion`, the pinned literal stops typechecking,
   and the Dependabot PR fails CI until someone deliberately re-reads this contract. Write the string to
   match whatever the lockfile resolves at implementation time; if the SDK has moved again by then, check
   its changelog for subscription, invoice, or charge shape changes first. The step-2 destination uses the
   same string.
4. ~~100%-discount invoices?~~ **Decided (2026-10-06): keep the `amount_paid > 0` guard; comps go
   through the admin dashboard.** A subscriber on a fully discounted invoice (100% coupon or promotion
   code) receives no automatic subscription grant. Comps for press and partners are issued as manual
   grants from the admin dashboard, which needs no Stripe coupon and no webhook logic. We considered
   exempting invoices that carry a 100% discount (detecting it from `invoice.discounts` and
   `total_discount_amounts`) and rejected it for now. It would add a second grant condition to the
   payment-authorization path this spec exists to simplify. It also creates a new free-credit path:
   anyone holding a leaked or shared 100% code could collect 30,000 Power every cycle with no payment.
   **Operational rule:** do not issue 100%-off Stripe promotion codes expecting them to carry Power. If
   comps ever need to run through Stripe at volume, revisit this with an allowlist of specific coupon
   ids, not "any 100% discount."
