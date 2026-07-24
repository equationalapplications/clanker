# Stripe GA4 Parity (Subscriptions + Refunds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Stripe webhook emit GA4 `purchase` events for subscription payments (initial + renewal) and GA4 `refund` events for refunds, closing the Stripe-side analytics gap so GA4/BQ revenue is complete and tagged `payment_provider=stripe`.

**Architecture:** All changes live in `functions/src/stripeWebhook.ts` and its test file. Subscription purchases fire from `invoice.payment_succeeded` only (covers `subscription_create` + `subscription_cycle`, keyed on `invoice.id`) so the initial payment — which also fires `checkout.session.completed` — is not double-counted. Refunds fire from `charge.refunded`. Two thin local wrappers (`emitStripePurchase` / `emitStripeRefund`) isolate GA4 failures from the webhook response, mirroring the RC webhook's `emitRevenueCatPurchase` / `emitRevenueCatRefund`.

**Tech Stack:** TypeScript, Firebase Functions v2, Stripe SDK v22, `node:test` + `node:assert/strict`. Repo practice: TDD, one behavior per test, deps injected and cast `as never` in tests.

**Spec:** `docs/superpowers/specs/2026-07-24-billing-webhook-and-purchase-analytics.md` §B6.

---

## File Structure

- **Modify** `functions/src/stripeWebhook.ts`:
  - Import `sendRefundEvent as sendGa4RefundEvent` alongside the existing purchase import.
  - Extend `StripeWebhookDeps`: add optional `items` to `sendPurchaseEvent`; add `sendRefundEvent`.
  - Wire both in `defaultDeps`.
  - Add helpers: `getSubscriptionTierFromInvoice`, `emitStripePurchase`, `emitStripeRefund`.
  - Emit purchase inside `handleInvoicePaymentSucceeded` (subscription branch).
  - Emit refund inside `handleChargeRefunded` (credit-pack branch + subscription branch).
- **Modify** `functions/src/stripeWebhook.test.ts`: new behavior tests.
- **Modify** `docs/billing-architecture.md`: remove "Known gap"; correct event-matrix rows.

---

## Task 1: Deps plumbing + isolation wrappers

No behavior change on its own — this is the shared infrastructure Tasks 2–3 build on. It is exercised (and thus verified) by the behavior tests in Tasks 2–3, so it has no standalone test.

**Files:**
- Modify: `functions/src/stripeWebhook.ts`

- [ ] **Step 1: Add the refund import**

In `functions/src/stripeWebhook.ts`, change the GA4 import (currently line 15):

```typescript
import {sendPurchaseEvent as sendGa4PurchaseEvent, sendRefundEvent as sendGa4RefundEvent} from "./services/ga4MeasurementService.js";
```

- [ ] **Step 2: Extend the `StripeWebhookDeps` interface**

Replace the `sendPurchaseEvent` line in the `interface StripeWebhookDeps` block and add `sendRefundEvent` right after it:

```typescript
  sendPurchaseEvent: (params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"; items?: Array<{item_id: string; item_name: string}>}) => Promise<void>;
  sendRefundEvent: (params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"}) => Promise<void>;
```

- [ ] **Step 3: Wire `defaultDeps`**

Replace the `sendPurchaseEvent` method in `defaultDeps` and add `sendRefundEvent` after it:

```typescript
  async sendPurchaseEvent(params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"; items?: Array<{item_id: string; item_name: string}>}) {
    await sendGa4PurchaseEvent(params);
  },
  async sendRefundEvent(params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"}) {
    await sendGa4RefundEvent(params);
  },
```

- [ ] **Step 4: Add the tier-from-invoice helper and the two isolation wrappers**

Add these near the other module-level helpers (e.g. just after `getCreditPackQuantityFromInvoice`):

```typescript
// Resolve the subscription tier from an invoice's line items (used to tag GA4 items).
function getSubscriptionTierFromInvoice(
  invoice: Stripe.Invoice,
  priceIds: StripePriceIds
): "monthly_20" | "monthly_50" | undefined {
  for (const item of invoice.lines.data) {
    const priceId = getInvoiceLineItemPriceId(item);
    if (priceId) {
      const tier = getTierByPriceId(priceId, priceIds);
      if (tier) return tier;
    }
  }
  return undefined;
}

// Fire a GA4 purchase event from Stripe data. Never throws (isolation): a GA4
// failure must not fail the webhook response.
async function emitStripePurchase(
  deps: StripeWebhookDeps,
  params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; items?: Array<{item_id: string; item_name: string}>}
): Promise<void> {
  try {
    await deps.sendPurchaseEvent({...params, paymentProvider: "stripe"});
  } catch (err) {
    logger.error("Stripe: GA4 purchase emission failed (ignored)", {err, transactionId: params.transactionId});
  }
}

// Fire a GA4 refund event from Stripe data. Never throws (isolation).
async function emitStripeRefund(
  deps: StripeWebhookDeps,
  params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string}
): Promise<void> {
  try {
    await deps.sendRefundEvent({...params, paymentProvider: "stripe"});
  } catch (err) {
    logger.error("Stripe: GA4 refund emission failed (ignored)", {err, transactionId: params.transactionId});
  }
}
```

- [ ] **Step 5: Verify the project still builds and existing tests pass**

Run: `cd functions && npm run build && npm test`
Expected: build succeeds; all existing tests still PASS (no behavior wired yet; the new interface members are optional-friendly because tests cast deps `as never`).

- [ ] **Step 6: Commit**

```bash
git add functions/src/stripeWebhook.ts
git commit -m "feat(stripe-webhook): add GA4 refund dep + purchase/refund isolation wrappers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Subscription purchase events (B6.1)

Emit one GA4 `purchase` per subscription invoice — both `subscription_create` (initial) and `subscription_cycle` (renewal) — keyed on `invoice.id`. Never guess: skip + warn on missing tier / firebaseUid / amount / currency.

**Files:**
- Modify: `functions/src/stripeWebhook.ts:604-664` (`handleInvoicePaymentSucceeded`)
- Test: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing test — subscription_cycle emits a purchase**

Add to `functions/src/stripeWebhook.test.ts`:

```typescript
test("handleInvoicePaymentSucceeded emits a GA4 purchase for a subscription_cycle invoice", async () => {
  let sentEvent: unknown = null;

  const invoice = {
    id: "inv_cycle_1",
    customer_email: "person@example.com",
    billing_reason: "subscription_cycle",
    amount_paid: 2000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_123" } },
    lines: { data: [{ pricing: { price_details: { price: "price_monthly_20" } }, quantity: 1 }] },
  } as unknown as Stripe.Invoice;

  const mockStripe = {
    subscriptions: { retrieve: async () => ({ current_period_end: 1710000000 }) },
  } as unknown as Stripe;

  await handleInvoicePaymentSucceeded(mockStripe, invoice, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async (params: unknown) => { sentEvent = params; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.deepEqual(sentEvent, {
    firebaseUid: "firebase-uid-1",
    transactionId: "inv_cycle_1",
    valueMinorUnits: 2000,
    currency: "usd",
    paymentProvider: "stripe",
    items: [{item_id: "monthly_20", item_name: "monthly_20"}],
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 purchase for a subscription_cycle invoice"`
Expected: FAIL — `sentEvent` is `null` (no emission wired yet).

- [ ] **Step 3: Implement the subscription-branch emission**

In `handleInvoicePaymentSucceeded`, the subscription branch currently ends with a bare `return;` after the `subscription_cycle` credit renewal. Emit the purchase just before that `return`. Replace:

```typescript
    }
    return;
  }

  // Only handle non-subscription invoices (one-time PAYG credit pack purchases).
```

with:

```typescript
    }

    // GA4 purchase for subscription invoices — both subscription_create (initial)
    // and subscription_cycle (renewal). Keyed on invoice.id so the initial payment,
    // which also fires checkout.session.completed, is not double-counted.
    const tier = getSubscriptionTierFromInvoice(invoice, priceIds);
    if (!invoice.id) {
      logger.warn("invoice.payment_succeeded: missing invoice id, skipping GA4 purchase event", {subscriptionId});
    } else if (!user.firebaseUid) {
      logger.warn("invoice.payment_succeeded: missing firebaseUid, skipping GA4 purchase event", {invoiceId: invoice.id});
    } else if (!tier) {
      logger.warn("invoice.payment_succeeded: unknown subscription tier, skipping GA4 purchase event", {invoiceId: invoice.id});
    } else if (typeof invoice.amount_paid !== "number" || invoice.amount_paid <= 0) {
      logger.warn("invoice.payment_succeeded: missing or non-positive amount_paid, skipping GA4 purchase event", {invoiceId: invoice.id});
    } else if (!invoice.currency) {
      logger.warn("invoice.payment_succeeded: missing currency, skipping GA4 purchase event", {invoiceId: invoice.id});
    } else {
      await emitStripePurchase(deps, {
        firebaseUid: user.firebaseUid,
        transactionId: invoice.id,
        valueMinorUnits: invoice.amount_paid,
        currency: invoice.currency,
        items: [{item_id: tier, item_name: tier}],
      });
    }
    return;
  }

  // Only handle non-subscription invoices (one-time PAYG credit pack purchases).
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 purchase for a subscription_cycle invoice"`
Expected: PASS.

- [ ] **Step 5: Write the failing test — subscription_create also emits**

Add:

```typescript
test("handleInvoicePaymentSucceeded emits a GA4 purchase for a subscription_create invoice", async () => {
  let sentEvent: unknown = null;

  const invoice = {
    id: "inv_create_1",
    customer_email: "person@example.com",
    billing_reason: "subscription_create",
    amount_paid: 5000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_456" } },
    lines: { data: [{ pricing: { price_details: { price: "price_monthly_50" } }, quantity: 1 }] },
  } as unknown as Stripe.Invoice;

  const mockStripe = {
    subscriptions: { retrieve: async () => ({ current_period_end: 1710000000 }) },
  } as unknown as Stripe;

  await handleInvoicePaymentSucceeded(mockStripe, invoice, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async (params: unknown) => { sentEvent = params; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.deepEqual(sentEvent, {
    firebaseUid: "firebase-uid-1",
    transactionId: "inv_create_1",
    valueMinorUnits: 5000,
    currency: "usd",
    paymentProvider: "stripe",
    items: [{item_id: "monthly_50", item_name: "monthly_50"}],
  });
});
```

- [ ] **Step 6: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 purchase for a subscription_create invoice"`
Expected: PASS (Step 3's code already covers `subscription_create`; this test locks that in).

- [ ] **Step 7: Write the failing test — missing firebaseUid skips**

Add:

```typescript
test("handleInvoicePaymentSucceeded skips the GA4 purchase when firebaseUid is missing", async () => {
  let purchaseCalled = false;

  const invoice = {
    id: "inv_no_uid",
    customer_email: "person@example.com",
    billing_reason: "subscription_cycle",
    amount_paid: 2000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_789" } },
    lines: { data: [{ pricing: { price_details: { price: "price_monthly_20" } }, quantity: 1 }] },
  } as unknown as Stripe.Invoice;

  const mockStripe = {
    subscriptions: { retrieve: async () => ({ current_period_end: 1710000000 }) },
  } as unknown as Stripe;

  await handleInvoicePaymentSucceeded(mockStripe, invoice, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async () => { purchaseCalled = true; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.equal(purchaseCalled, false);
});
```

- [ ] **Step 8: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="skips the GA4 purchase when firebaseUid is missing"`
Expected: PASS (guard short-circuits on missing `firebaseUid`).

- [ ] **Step 9: Write the regression test — a subscription checkout emits NO purchase**

This locks in the no-double-count decision: `checkout.session.completed` must not emit a purchase for subscription line items (only `invoice.payment_succeeded` does). Add:

```typescript
test("handleCheckoutCompleted does not emit a GA4 purchase for a subscription-only checkout", async () => {
  let purchaseCalled = false;

  const session = {
    id: "cs_test_subscription",
    customer_details: { email: "person@example.com" },
    customer_email: "person@example.com",
    client_reference_id: null,
    subscription: "sub_123",
    customer: "cus_123",
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async () => ({
          data: [{ price: { id: "price_monthly_20" }, quantity: 1, amount_total: 2000 }],
        }),
      },
    },
    subscriptions: {
      retrieve: async () => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe;

  await handleCheckoutCompleted(mockStripe, session, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async () => { purchaseCalled = true; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.equal(purchaseCalled, false);
});
```

- [ ] **Step 10: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="does not emit a GA4 purchase for a subscription-only checkout"`
Expected: PASS (current `handleCheckoutCompleted` only emits on the credit-pack path; this is a guardrail against future regressions).

- [ ] **Step 11: Run the full functions test suite**

Run: `cd functions && npm test`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(stripe-webhook): emit GA4 purchase for subscription invoices

Subscription purchases (create + cycle) now emit one GA4 purchase per
invoice, keyed on invoice.id so the initial payment is not double-counted
against checkout.session.completed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Refund events (B6.3)

Emit a GA4 `refund` for credit-pack refunds (value = the new refund delta) and subscription refunds (value = amount refunded). Unclassifiable refunds emit nothing. Never guess: skip + warn on missing firebaseUid / currency.

**Files:**
- Modify: `functions/src/stripeWebhook.ts:666-748` (`handleChargeRefunded`)
- Test: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing test — credit-pack refund emits a refund with the delta value**

```typescript
test("handleChargeRefunded emits a GA4 refund for a credit-pack refund using the new delta", async () => {
  let refundEvent: unknown = null;

  const charge = {
    id: "ch_refund_1",
    amount: 1000,
    amount_refunded: 1000,
    currency: "usd",
    billing_details: {email: "user@example.com"},
    invoice: "in_ref_1",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{ quantity: 1, pricing: {price_details: {price: "price_credit_pack"}} }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendRefundEvent: async (params: unknown) => { refundEvent = params; },
    getLastProcessedChargeRefundTotal: async () => 400,
  } as never);

  assert.deepEqual(refundEvent, {
    firebaseUid: "firebase-uid-1",
    transactionId: "ch_refund_1_1000",
    valueMinorUnits: 600,
    currency: "usd",
    paymentProvider: "stripe",
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 refund for a credit-pack refund"`
Expected: FAIL — `refundEvent` is `null`.

- [ ] **Step 3: Implement the credit-pack-branch refund emission**

In `handleChargeRefunded`, the credit-pack branch is `if (creditPackQty > 0) { ... }`. Inside it, `deltaRefunded` is computed and the code early-returns if `deltaRefunded <= 0`. Append the refund emission at the end of that block, after the `if (creditsToDeduct > 0) { ... }` sub-block. Replace:

```typescript
    if (creditsToDeduct > 0) {
      await deps.adjustCredits(
        user.id,
        -creditsToDeduct,
        "stripe_refund",
        `${charge.id}_${charge.amount_refunded}`
      );
      logger.info("charge.refunded: credits deducted", {
        chargeId: charge.id,
        credits: creditsToDeduct,
        amountRefunded: charge.amount_refunded,
      });
    }
  } else if (isSubscriptionRefund) {
```

with:

```typescript
    if (creditsToDeduct > 0) {
      await deps.adjustCredits(
        user.id,
        -creditsToDeduct,
        "stripe_refund",
        `${charge.id}_${charge.amount_refunded}`
      );
      logger.info("charge.refunded: credits deducted", {
        chargeId: charge.id,
        credits: creditsToDeduct,
        amountRefunded: charge.amount_refunded,
      });
    }

    // GA4 refund reports only the new refund delta so partial/repeat refunds each
    // report their increment. transaction_id keys on charge.id (see spec B6.4).
    if (user.firebaseUid && charge.currency) {
      await emitStripeRefund(deps, {
        firebaseUid: user.firebaseUid,
        transactionId: `${charge.id}_${charge.amount_refunded}`,
        valueMinorUnits: deltaRefunded,
        currency: charge.currency,
      });
    } else {
      logger.warn("charge.refunded: missing firebaseUid or currency, skipping GA4 refund event", {chargeId: charge.id});
    }
  } else if (isSubscriptionRefund) {
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 refund for a credit-pack refund"`
Expected: PASS.

- [ ] **Step 5: Write the failing test — subscription refund emits a refund**

```typescript
test("handleChargeRefunded emits a GA4 refund for a subscription refund", async () => {
  let refundEvent: unknown = null;

  const charge = {
    id: "ch_sub_refund",
    amount: 2000,
    amount_refunded: 2000,
    currency: "usd",
    billing_details: {email: "user@example.com"},
    invoice: "in_sub_ref",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: "sub_123"}},
        lines: {data: [{ quantity: 1, pricing: {price_details: {price: "price_monthly_20"}} }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendRefundEvent: async (params: unknown) => { refundEvent = params; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.deepEqual(refundEvent, {
    firebaseUid: "firebase-uid-1",
    transactionId: "ch_sub_refund",
    valueMinorUnits: 2000,
    currency: "usd",
    paymentProvider: "stripe",
  });
});
```

Note: `getSubscriptionTierFromInvoice` is not used here — the subscription refund path keys on `charge.id` and does not tag items. The invoice's `subscription_details.subscription` being non-null routes it through the `isSubscriptionRefund` branch (its `lines` carry a subscription price, so `getCreditPackQuantityFromInvoice` returns 0).

- [ ] **Step 6: Run it to confirm it fails**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 refund for a subscription refund"`
Expected: FAIL — `refundEvent` is `null`.

- [ ] **Step 7: Implement the subscription-branch refund emission**

In the `else if (isSubscriptionRefund)` branch, after the `upsertSubscription` call and its `logger.info`, add the emission. Replace:

```typescript
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await deps.upsertSubscription({
      userId: user.id,
      planTier: "free",
      planStatus: "cancelled",
      subscriptionProvider: null,
      cancelAtPeriodEnd: false,
    });
    logger.info("charge.refunded: subscription cancelled", {userId: user.id, chargeId: charge.id});
  } else {
```

with:

```typescript
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await deps.upsertSubscription({
      userId: user.id,
      planTier: "free",
      planStatus: "cancelled",
      subscriptionProvider: null,
      cancelAtPeriodEnd: false,
    });
    logger.info("charge.refunded: subscription cancelled", {userId: user.id, chargeId: charge.id});

    // GA4 refund for the subscription payment. transaction_id keys on charge.id
    // (see spec B6.4).
    if (user.firebaseUid && charge.currency) {
      await emitStripeRefund(deps, {
        firebaseUid: user.firebaseUid,
        transactionId: charge.id,
        valueMinorUnits: charge.amount_refunded,
        currency: charge.currency,
      });
    } else {
      logger.warn("charge.refunded: missing firebaseUid or currency, skipping GA4 refund event", {chargeId: charge.id});
    }
  } else {
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `cd functions && npm test -- --test-name-pattern="emits a GA4 refund for a subscription refund"`
Expected: PASS.

- [ ] **Step 9: Write the test — unclassifiable refund emits nothing**

```typescript
test("handleChargeRefunded does not emit a GA4 refund for an unclassifiable refund", async () => {
  let refundCalled = false;

  const charge = {
    id: "ch_unclassifiable",
    amount: 2000,
    amount_refunded: 2000,
    currency: "usd",
    billing_details: {email: "user@example.com"},
    invoice: "in_unclassifiable",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{ quantity: 1, pricing: {price_details: {price: "price_unknown"}} }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendRefundEvent: async () => { refundCalled = true; },
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never);

  assert.equal(refundCalled, false);
});
```

- [ ] **Step 10: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="does not emit a GA4 refund for an unclassifiable refund"`
Expected: PASS (unclassifiable refunds hit the final `else` branch, which emits nothing).

- [ ] **Step 11: Run the full functions test suite**

Run: `cd functions && npm test`
Expected: all PASS (including the pre-existing refund tests, whose users lack `firebaseUid` so no emission fires).

- [ ] **Step 12: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(stripe-webhook): emit GA4 refund events for Stripe refunds

Credit-pack refunds emit refund with the new refund delta; subscription
refunds emit refund with the amount refunded. Unclassifiable refunds emit
nothing (never-guess). transaction_id keys on charge.id (spec B6.4).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Isolation test — GA4 failure never fails the webhook

Prove the wrappers swallow emission errors so the webhook still succeeds.

**Files:**
- Test: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the test — a throwing sendPurchaseEvent does not propagate**

```typescript
test("handleInvoicePaymentSucceeded does not throw when the GA4 purchase emission fails", async () => {
  const invoice = {
    id: "inv_ga4_fail",
    customer_email: "person@example.com",
    billing_reason: "subscription_cycle",
    amount_paid: 2000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_123" } },
    lines: { data: [{ pricing: { price_details: { price: "price_monthly_20" } }, quantity: 1 }] },
  } as unknown as Stripe.Invoice;

  const mockStripe = {
    subscriptions: { retrieve: async () => ({ current_period_end: 1710000000 }) },
  } as unknown as Stripe;

  await assert.doesNotReject(async () => {
    await handleInvoicePaymentSucceeded(mockStripe, invoice, {
      monthly20: "price_monthly_20",
      monthly50: "price_monthly_50",
      creditPack: "price_credit_pack",
    }, {
      findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async () => { throw new Error("GA4 down"); },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never);
  });
});
```

- [ ] **Step 2: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="does not throw when the GA4 purchase emission fails"`
Expected: PASS (the `emitStripePurchase` wrapper catches and logs).

- [ ] **Step 3: Write the test — a throwing sendRefundEvent does not propagate**

```typescript
test("handleChargeRefunded does not throw when the GA4 refund emission fails", async () => {
  const charge = {
    id: "ch_ga4_fail",
    amount: 1000,
    amount_refunded: 1000,
    currency: "usd",
    billing_details: {email: "user@example.com"},
    invoice: "in_ga4_fail",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{ quantity: 1, pricing: {price_details: {price: "price_credit_pack"}} }]},
      }),
    },
  } as unknown as Stripe;

  await assert.doesNotReject(async () => {
    await handleChargeRefunded(mockStripe, charge, {
      monthly20: "price_monthly_20",
      monthly50: "price_monthly_50",
      creditPack: "price_credit_pack",
    }, {
      findUserByEmail: async (email: string) => ({id: "user-1", email, firebaseUid: "firebase-uid-1"}),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendRefundEvent: async () => { throw new Error("GA4 down"); },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never);
  });
});
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd functions && npm test -- --test-name-pattern="does not throw when the GA4 refund emission fails"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/stripeWebhook.test.ts
git commit -m "test(stripe-webhook): GA4 emission failures never fail the webhook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Update billing-architecture docs

**Files:**
- Modify: `docs/billing-architecture.md`

- [ ] **Step 1: Correct the `checkout.session.completed` matrix row**

Edit `docs/billing-architecture.md`. Replace the tail of the `checkout.session.completed` row:

Old:
```
credit-pack line item(s) → add pack credits (key=session id) **and** GA4 purchase. GA4 purchase fires only for the credit-pack path — a subscription-only checkout does not currently emit a GA4 purchase event. |
```
New:
```
credit-pack line item(s) → add pack credits (key=session id) **and** GA4 purchase. GA4 purchase fires only for the credit-pack path; subscription purchases are emitted from `invoice.payment_succeeded` (keyed on invoice id) so the initial payment is not double-counted. |
```

- [ ] **Step 2: Correct the `invoice.payment_succeeded` matrix row**

Old:
```
| invoice.payment_succeeded | if tied to a subscription and `billing_reason=subscription_cycle`, renew sub credits (same idempotent key as above); otherwise (non-subscription invoice) add pack credits for any credit-pack line items (key=invoice id) — no GA4 event either way |
```
New:
```
| invoice.payment_succeeded | if tied to a subscription and `billing_reason=subscription_cycle`, renew sub credits (same idempotent key as above); otherwise (non-subscription invoice) add pack credits for any credit-pack line items (key=invoice id). Emits a GA4 purchase (payment_provider=stripe) for subscription invoices — both `subscription_create` and `subscription_cycle` — keyed on invoice id |
```

- [ ] **Step 3: Correct the `charge.refunded` matrix row**

Old:
```
| charge.refunded | if the underlying invoice has credit-pack line items, deduct credits proportional to the *new* refund delta (idempotent via cumulative-refund tracking); else if the invoice is subscription-linked, cancel the subscription (free/cancelled); else log as unclassifiable — no GA4 refund event is sent for Stripe today |
```
New:
```
| charge.refunded | if the underlying invoice has credit-pack line items, deduct credits proportional to the *new* refund delta (idempotent via cumulative-refund tracking) and emit a GA4 refund of that delta (key=`charge.id_amount_refunded`); else if the invoice is subscription-linked, cancel the subscription (free/cancelled) and emit a GA4 refund of `amount_refunded` (key=charge.id); else log as unclassifiable (no GA4 event) |
```

- [ ] **Step 4: Replace the "Known gap" paragraph**

Old (the full paragraph):
```
**Known gap:** GA4 purchase events are only emitted for the Stripe credit-pack
checkout path; Stripe subscription purchases and renewals do not emit GA4 purchase
events, and no Stripe flow emits a GA4 refund event. RevenueCat emits both purchase
and refund events across its equivalent flows. This asymmetry means GA4/BQ purchase
totals underrepresent Stripe subscription revenue and Stripe refunds — tracked as a
follow-up, not fixed by this doc.
```
New:
```
**Provider parity (2026-07-24):** Both providers now emit GA4 `purchase` and
`refund` events across their equivalent flows. Stripe subscription purchases fire
from `invoice.payment_succeeded` (initial + renewal) and refunds from
`charge.refunded`. One asymmetry remains by design: the Stripe refund
`transaction_id` keys on `charge.id` and is not reconciled to the purchase
`transaction_id` (`session.id` / `invoice.id`) — cosmetic in the GA4 UI only;
canonical revenue is BigQuery-side (`v_purchases` / `v_user_journey`), where refunds
are their own rows.
```

- [ ] **Step 5: Commit**

```bash
git add docs/billing-architecture.md
git commit -m "docs(billing): Stripe now emits GA4 purchase/refund; close known-gap note

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the whole functions suite**

Run: `cd functions && npm run build && npm test`
Expected: build clean; all tests PASS.

- [ ] **Confirm no client changes were needed** — this plan touches only `functions/` and docs; no `src/` (client) work.
