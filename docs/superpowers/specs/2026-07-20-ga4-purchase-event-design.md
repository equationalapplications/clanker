# GA4 Purchase Event (Server-Side, Credit Pack) — Design

**Date:** 2026-07-20
**Branch:** fix/analytics-purchase-event
**Status:** Implemented

## Background

Follow-up to the "first paying customer got no credits" incident (`docs/handoff/2026-07-20-stripe-smoketest-and-analytics.md`, Task B). Owner observed GA4 "Drive sales" showing $0 revenue despite a real $10 sale.

Investigation confirmed:

1. **No `purchase`/revenue event exists anywhere in the codebase.** The original analytics design (`docs/superpowers/specs/2026-07-05-firebase-analytics-design.md`) explicitly scoped revenue out, reasoning "RevenueCat already covers subscription metrics." True for subscriptions, **not true for the Stripe credit-pack one-time purchase** — that path has no revenue signal in GA4 at all.
2. `app/checkout/success.tsx` calls `refreshBootstrap('purchase')` — `'purchase'` there is a data-refresh reason string, not a GA4 event.
3. BigQuery export is not enabled (`bq ls --project_id=clanker-prod` returns empty) — separate owner console action, out of scope for this code change.
4. `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` is populated and wired correctly — not a contributing issue.

## Decisions (confirmed with owner)

- **Server-side only**, via GA4 Measurement Protocol from `functions/src/stripeWebhook.ts`. The client already redirects back through `checkout/success.tsx` after the webhook has run; the webhook is the reliable source of truth (doesn't depend on the client tab surviving the redirect).
- **Scope: credit pack only** (`checkout.session.completed`, the `totalCreditPackQty > 0` branch). Subscription renewals stay on RevenueCat as today — no `invoice.payment_succeeded` MP call.
- **`client_id`:** deterministic `sha256(firebaseUid)` (formatted as GA4 expects, e.g. two dot-separated segments derived from the hash). Same user always maps to the same synthetic client_id.
- **`user_id`:** the same Firebase UID passed to `setUserId()` client-side (`authMachine.ts`), included alongside `client_id` in the MP payload so GA4 correlates this server event with the user's client-side funnel events.

**Owner action required — `GA4_MP_API_SECRET`:** unlike `GA4_MEASUREMENT_ID` (already exists as `G-TELW4E82QJ`), this secret does not exist yet. Owner must generate it in GA4 Admin → Data Streams → [Web Stream] → Measurement Protocol API secrets, then load the value into GCP Secret Manager as `GA4_MP_API_SECRET`. Blocking prerequisite for deploy, not for writing/reviewing this code.

## Architecture

### New: `functions/src/services/ga4MeasurementService.ts`

Single-purpose fire-and-forget wrapper, mirroring the client `analyticsService` pattern (self-swallowing errors, never throws into caller).

```ts
function buildClientId(firebaseUid: string): string
async function sendPurchaseEvent(params: {
  firebaseUid: string
  transactionId: string // session.id
  valueCents: number // summed amount_total of credit-pack line items only (not session.amount_total, which includes any subscription line items in a mixed cart)
  currency: string // session.currency
}): Promise<void>
```

`sendPurchaseEvent`:

1. Builds MP payload: `{ client_id, user_id: firebaseUid, events: [{ name: 'purchase', params: { transaction_id, value: valueCents / 100, currency, items: [{ item_id: 'credit_pack', item_name: 'Credit Pack' }] } }] }`.
2. POSTs to `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_MP_API_SECRET}` via global `fetch` (Node 22 runtime, no new dependency).
3. Catches and logs any error (`logger.error`) — never rejects into the caller. Matches the credit-grant path's existing "analytics must never break app flow" principle from the 2026-07-05 design.

No retry logic: MP has no delivery confirmation, and Stripe won't retry `checkout.session.completed` just because analytics failed (event-level dedupe already claimed the event by this point — see Data Flow).

### `functions/src/stripeWebhook.ts` changes

- Extend `UserLookup` type (currently `{ id, email }`) to include `firebaseUid?: string` (optional — keeps the ~14 existing test-double literals in `stripeWebhook.test.ts` compiling unchanged; the call site below skips the GA4 event and logs a warning if it's absent rather than treating it as an error), and update the three `defaultDeps` lookup functions (`findUserByEmail`, `findUserByFirebaseUid`, `findUserByStripeCustomerId`) to pass it through — the underlying `userRepository` rows already carry it, it's just dropped in the current mapping.
- While iterating line items, accumulate `creditPackValueCents` from each credit-pack line item's own `amount_total` (not `session.amount_total`, which is the full Checkout total and would overstate revenue in a mixed subscription + credit-pack cart).
- In `handleCheckoutCompleted`, inside the existing `if (totalCreditPackQty > 0) { ... }` block, after `addCredits` succeeds, if `user.firebaseUid` is present and `session.currency` is set, call `ga4MeasurementService.sendPurchaseEvent({ firebaseUid: user.firebaseUid, transactionId: session.id, valueCents: creditPackValueCents, currency: session.currency })` (otherwise log a warning and skip).
- Add `GA4_MEASUREMENT_ID` and `GA4_MP_API_SECRET` to the `secrets: [...]` array on the `stripeWebhook` function definition (alongside `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Both provisioned as Secret Manager secrets — `GA4_MEASUREMENT_ID` is not sensitive but is kept alongside its paired API secret for consistency and single source of truth with the client's `G-TELW4E82QJ`.

## Data Flow

1. Stripe → `stripeWebhook` → signature verified → `deps.markEventProcessed(event.id)` claims the event (existing dedupe, line ~295) — retries of the same `event.id` never reach the handler.
2. `handleCheckoutCompleted` resolves `user` (now includes `firebaseUid`), expands line items, finds credit-pack quantity.
3. `addCredits(...)` grants credits (own idempotency via `session.id` as `referenceId`, unchanged).
4. **New:** `ga4MeasurementService.sendPurchaseEvent(...)` fires once, fire-and-forget (awaited for logging purposes but errors are swallowed inside the service — a GA4 outage cannot fail the webhook or block credit granting).

## Error Handling

- `sendPurchaseEvent` never throws. Network failure, non-2xx from GA4, or misconfigured secrets are caught and `logger.error`'d with event/session id for later grep, then execution continues.
- If `GA4_MEASUREMENT_ID` or `GA4_MP_API_SECRET` env vars are unset, log a warning once per invocation and skip the POST (same "don't crash on missing config" posture as other optional integrations).

## Testing

- Unit tests in `functions/src/services/ga4MeasurementService.test.ts`: `client_id` determinism (same uid → same id, different uid → different id), payload shape (event name, params, `transaction_id`, `value` in dollars not cents), fetch failure is swallowed and logged, missing secrets short-circuit without throwing.
- Extend `functions/src/stripeWebhook.test.ts`: credit-pack purchase triggers `sendPurchaseEvent` exactly once with the right `firebaseUid`/amount/currency; subscription-only purchases do **not** trigger it; a second delivery of the same `event.id` (dedupe path) does not trigger it again.
- No live GA4 verification in CI — DebugView/Realtime confirmation is a manual owner step post-deploy (documented as a follow-up, not blocking this PR).

## Out of Scope

- Subscription renewal revenue (`invoice.payment_succeeded`) — explicitly deferred per owner decision.
- BigQuery export console setup — separate manual owner action (Firebase console → Integrations → BigQuery).
- Client-side purchase event — explicitly rejected in favor of server-side-only.
- Refund handling (`charge.refunded` already deducts credits; no corresponding GA4 refund event is added — could be a future follow-up, not required to close the $0-revenue gap).
