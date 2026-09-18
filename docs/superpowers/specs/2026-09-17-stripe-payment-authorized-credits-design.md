# Stripe Payment-Authorized Credits & Payload-Version Contract — Design

**Date:** 2026-09-17
**Status:** Draft
**Resolves:** Security review finding on `main` (`functions/src/stripeWebhook.ts:701`) — subscription
credits granted for unpaid subscription states; plus two dead grant paths discovered while validating it.
**Scope:** `functions/` only. No client, RevenueCat, or credit-pack changes.

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
(verified in the Dashboard, 2026-09-17). The installed SDK — `stripe@22.5.0` — pins
**`2026-07-29.dahlia`** (`node_modules/stripe/cjs/apiVersion.js`) and sends that version on every API
call it makes, regardless of the endpoint's pin. `new Stripe(secretKey)` (`stripeWebhook.ts:250`) passes
no `apiVersion` override.

So the three grant sites read _different payload shapes_:

| Grant site                             | Subscription object from   | Version in effect | Grants today                  |
| -------------------------------------- | -------------------------- | ----------------- | ----------------------------- |
| `customer.subscription.updated` `:702` | webhook event payload      | `2022-11-15`      | **Yes** — the vulnerable path |
| `checkout.session.completed` `:569`    | `subscriptions.retrieve()` | `dahlia`          | **No**                        |
| `invoice.payment_succeeded` `:785`     | `subscriptions.retrieve()` | `dahlia`          | **No**                        |

API version `2025-03-31.basil` moved `current_period_start` / `current_period_end` off the subscription
onto its items, so under dahlia the retrieved object has no top-level `current_period_end`; both sites
fall through to `logger.warn('... missing or invalid current_period_end')` and grant nothing.

`handleInvoicePaymentSucceeded` is dead twice over. It locates the subscription via a **basil-and-later**
field (`stripeWebhook.ts:775`, added 2026-05-22 in `d923a1da`):

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

- **Trial policy.** `trialing` currently maps to `'active'` and mints a full grant. This spec
  deliberately preserves that behavior. Whether trials should receive credits is a product decision and
  a separate follow-up.
- **Grace-period / access policy.** How a `past_due` subscriber's _access_ behaves is unchanged; only
  credit authorization moves. `planStatus` remains display and telemetry only (verified: its sole other
  consumers are admin filters, `usageSnapshot` passthrough, and the cross-provider duplicate-purchase
  guard at `purchasePackageStripe.ts:145`).
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
```

These replace `StripeSubRuntime` (`:178`) and the three cast sites. Each returns `null` rather than
guessing, and callers log a distinguishable warning on `null` so a future version drift is visible in
logs instead of silent.

### 2. Payment-authorized grants

- `handleSubscriptionUpdated` becomes **metadata-only**: it keeps `upsertSubscription` and its logging
  and no longer grants credits. The `if (planStatus === 'active')` block at `:701-717` is deleted.
- `handleCheckoutSessionCompleted` likewise stops granting subscription credits (`:560-590`). Checkout
  completion is not proof of a paid invoice for every payment method. Credit-pack handling in the same
  function is unchanged.
- `handleInvoicePaymentSucceeded` becomes the **sole** subscription grant path, handling both
  `billing_reason === 'subscription_create'` (initial purchase — not currently handled at all) and
  `'subscription_cycle'` (renewal), and asserting before granting:
  - `invoice.status === 'paid'` (and `amount_paid > 0`);
  - the subscription's price resolves to a known tier via `getTierByPriceId`;
  - the customer resolves to a user through the existing `resolveUserForStripeCustomer` path, not
    `customer_email` alone (today's handler at `:770-773` uses email only, which is weaker than the
    resolution used everywhere else).

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

### 4. Rollout order

The endpoint flip and the deploy cannot be simultaneous, and the currently-working path reads the old
shape. Sequence:

1. **Ship this PR's implementation.** Accessors handle both shapes; grants become payment-authorized.
   Safe under `2022-11-15` and under dahlia. No Stripe configuration change.
2. **Replace the destination.** `api_version` is **not** an updatable field — the Update webhook
   endpoint API accepts only `description`, `disabled`, `enabled_events`, `metadata` and `url`. The
   version can only be set at creation. So moving off `2022-11-15` means creating a _new_ destination at
   the same URL with `api_version` set explicitly, then retiring `we_1SCVd4DTb0norRA0K5dqQ3Pu`.

   Each destination has its **own signing secret**, and the handler reads a single
   `STRIPE_WEBHOOK_SECRET` (`stripeWebhook.ts:392`), so a naive swap makes in-flight deliveries fail
   signature verification. This PR's implementation therefore also accepts an optional
   `STRIPE_WEBHOOK_SECRET_NEXT` and tries each in turn in `constructEvent`, making the cutover
   non-breaking and reversible:

   1. Create the new destination with the target `api_version` and the same five events.
   2. Add its signing secret as `STRIPE_WEBHOOK_SECRET_NEXT`; deploy; confirm both destinations verify.
   3. Disable (do not delete) the old destination. Both receive the same event ids, and the existing
      event dedupe drops the duplicate, so no double grant during overlap.
   4. Promote the new secret to `STRIPE_WEBHOOK_SECRET`, drop `_NEXT`, delete the old destination.

3. **Follow-up PR** removes the legacy branch from the accessors and adds the explicit `apiVersion` pin
   (open question 3), once step 2 is confirmed in production.

Step 2 is a live Stripe configuration change and is performed by the account owner, not by CI or an agent.

## Test plan

`functions/` uses Jest. Run scoped: `npx jest src/__tests__/stripeWebhook` (bare `npm test -- <path>`
does not filter in this repo).

Fixtures must exist in **both** payload shapes — the current fixtures are synthetic top-level-period
shapes only, which is why Defect 2 was invisible to CI.

Authorization:

- `customer.subscription.updated` with `past_due`, `unpaid`, `incomplete`, `trialing`, and an unknown
  status: subscription row updates, ledger balance strictly unchanged.
- `checkout.session.completed` for a subscription price: no subscription credit row.
- Paid `subscription_create` invoice: exactly one grant.
- Paid `subscription_cycle` invoice: exactly one grant.
- Unpaid / `amount_paid: 0` invoice: no grant.
- Unknown price id: no grant, **and** a warning is logged identifying the unrecognized price, so a
  tier added in Stripe but not in `StripePriceIds` is visible in logs instead of silently
  dropping a paying customer's credits.

Idempotency and ordering:

- Duplicate delivery of the same paid invoice: one grant.
- A period already granted under the old `customer.subscription.updated` key: no second grant.
- Late invoice whose period end is in the past: no grant, no pool expiry.

Version contract:

- Every accessor, against a `2022-11-15` fixture and a dahlia fixture.
- A regression test asserting a paid initial purchase and a paid renewal each produce exactly one grant
  in **both** shapes — the guard that would have caught Defect 2.

## Verification before deploy

- [ ] Confirm the endpoint's enabled events still include `invoice.payment_succeeded`. (Verified
      2026-09-17: all five enabled events match the handler switch exactly.)
- [ ] Query the ledger for `reason = 'subscription'` rows and their `reference_id` values, to size the
      migration hazard in §3 against real data before deploying.
- [ ] After deploy, confirm the new revision actually took traffic before trusting any log evidence.
- [ ] After the step-2 flip, confirm a real event produces a grant.

## Risks

| Risk                                                                                              | Mitigation                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Double grant on deploy from a changed period key                                                  | §3 dual-key probe; ledger audit in the pre-deploy checklist                                           |
| Credit delivery stops during the destination cutover                                              | §4 tolerant readers deployed first; dual signing secret; old destination disabled rather than deleted |
| Duplicate deliveries while both destinations are live                                             | Same event id to both; existing event dedupe drops the second                                         |
| `subscription_create` path was never exercised, so initial-purchase grants are newly written code | Explicit fixtures for both billing reasons; step-2 verification with a real event                     |
| A future Stripe version drifts the shape again                                                    | Accessors return `null` and log distinctly rather than silently skipping                              |

## Open questions

1. Should credits already granted for unpaid periods be reconciled? Default per non-goals: no.
2. Trial credit policy — deferred, see non-goals.
3. ~~Pin `apiVersion` explicitly at client construction?~~ **Decided: yes.** After step 3, construct the
   client as `new Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' })`. Implicit SDK versioning is the
   direct cause of Defect 2; an explicit pin turns a payload-shape change into a deliberate, reviewable
   edit rather than a side effect of a Dependabot bump. Note the literal includes the `.dahlia` suffix —
   the SDK's `ApiVersion` constant and its TypeScript types expect the full string, and a bare
   `'2026-07-29'` will not typecheck. The pin must name the same version the destination is set to, so
   step 2 and this change move together.
