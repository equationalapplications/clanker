# GA4 Purchase Event (Server-Side, Credit Pack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire a GA4 Measurement Protocol `purchase` event from `stripeWebhook.ts` whenever a credit-pack checkout completes, closing the $0-revenue gap described in `docs/superpowers/specs/2026-07-20-ga4-purchase-event-design.md`.

**Architecture:** New standalone `functions/src/services/ga4MeasurementService.ts` builds a deterministic `client_id` from the Firebase UID and POSTs a `purchase` event to the GA4 Measurement Protocol endpoint. It's wired into `stripeWebhook.ts` as a new entry on the existing `StripeWebhookDeps` dependency-injection object (same pattern as `addCredits`, `upsertSubscription`, etc.), called once from `handleCheckoutCompleted`'s existing credit-pack branch. `UserLookup` gains an optional `firebaseUid` field so the call site has an identity to key off; if it's missing, the event is skipped and a warning logged (never blocks credit granting).

**Tech Stack:** TypeScript, Firebase Functions v2 (`onRequest`, Secret Manager `secrets` binding), Node 22 global `fetch`, Node built-in `crypto` (`createHash`), `node:test` + `node:assert/strict` (existing test runner: `npm run build && node --test lib/**/*.test.js`).

---

## Task 1: `ga4MeasurementService` — client_id + Measurement Protocol call

**Files:**
- Create: `functions/src/services/ga4MeasurementService.ts`
- Test: `functions/src/services/ga4MeasurementService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/services/ga4MeasurementService.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildClientId, sendPurchaseEvent } from "./ga4MeasurementService.js";

test("buildClientId is deterministic for the same uid", () => {
  const a = buildClientId("uid-123");
  const b = buildClientId("uid-123");
  assert.equal(a, b);
});

test("buildClientId differs for different uids", () => {
  const a = buildClientId("uid-123");
  const b = buildClientId("uid-456");
  assert.notEqual(a, b);
});

test("sendPurchaseEvent posts a well-formed GA4 MP purchase event", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_abc",
        valueCents: 1000,
        currency: "usd",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    process.env.GA4_MEASUREMENT_ID = original.measurementId;
    process.env.GA4_MP_API_SECRET = original.apiSecret;
  }

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://www.google-analytics.com/mp/collect");
  assert.equal(url.searchParams.get("measurement_id"), "G-TEST123");
  assert.equal(url.searchParams.get("api_secret"), "test-secret");

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.client_id, buildClientId("uid-123"));
  assert.equal(body.user_id, "uid-123");
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].name, "purchase");
  assert.equal(body.events[0].params.transaction_id, "cs_test_abc");
  assert.equal(body.events[0].params.value, 10);
  assert.equal(body.events[0].params.currency, "usd");
});

test("sendPurchaseEvent swallows fetch failures without throwing", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const fetchImpl = async () => {
    throw new Error("network down");
  };

  try {
    await assert.doesNotReject(
      sendPurchaseEvent(
        { firebaseUid: "uid-123", transactionId: "cs_test_abc", valueCents: 1000, currency: "usd" },
        fetchImpl as typeof fetch
      )
    );
  } finally {
    process.env.GA4_MEASUREMENT_ID = original.measurementId;
    process.env.GA4_MP_API_SECRET = original.apiSecret;
  }
});

test("sendPurchaseEvent skips the request when secrets are not configured", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  delete process.env.GA4_MEASUREMENT_ID;
  delete process.env.GA4_MP_API_SECRET;

  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      { firebaseUid: "uid-123", transactionId: "cs_test_abc", valueCents: 1000, currency: "usd" },
      fetchImpl as typeof fetch
    );
  } finally {
    process.env.GA4_MEASUREMENT_ID = original.measurementId;
    process.env.GA4_MP_API_SECRET = original.apiSecret;
  }

  assert.equal(called, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/services/ga4MeasurementService.test.js"`
Expected: build error (`ga4MeasurementService.ts` does not exist) or `Cannot find module './ga4MeasurementService.js'`.

- [ ] **Step 3: Write the implementation**

Create `functions/src/services/ga4MeasurementService.ts`:

```ts
import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const GA4_MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

export function buildClientId(firebaseUid: string): string {
  const hash = createHash("sha256").update(firebaseUid).digest();
  const a = hash.readUInt32BE(0);
  const b = hash.readUInt32BE(4);
  return `${a}.${b}`;
}

export interface PurchaseEventParams {
  firebaseUid: string;
  transactionId: string;
  valueCents: number;
  currency: string;
}

export async function sendPurchaseEvent(
  params: PurchaseEventParams,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_MP_API_SECRET;

  if (!measurementId || !apiSecret) {
    logger.warn("GA4 Measurement Protocol not configured, skipping purchase event", {
      transactionId: params.transactionId,
    });
    return;
  }

  try {
    const url = `${GA4_MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: buildClientId(params.firebaseUid),
        user_id: params.firebaseUid,
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: params.transactionId,
              value: params.valueCents / 100,
              currency: params.currency,
              items: [{ item_id: "credit_pack", item_name: "Credit Pack" }],
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      logger.error("GA4 Measurement Protocol request failed", {
        transactionId: params.transactionId,
        status: response.status,
      });
    }
  } catch (error) {
    logger.error("GA4 Measurement Protocol request threw", {
      transactionId: params.transactionId,
      error,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/services/ga4MeasurementService.test.js"`
Expected: 5 tests pass (`buildClientId` x2, `sendPurchaseEvent` x3).

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/ga4MeasurementService.ts functions/src/services/ga4MeasurementService.test.ts
git commit -m "feat(functions): add GA4 Measurement Protocol purchase event service"
```

---

## Task 2: Carry `firebaseUid` through `UserLookup`

**Files:**
- Modify: `functions/src/stripeWebhook.ts:21-24` (type), `:42-67` (defaultDeps)

- [ ] **Step 1: Extend the `UserLookup` type**

In `functions/src/stripeWebhook.ts`, change:

```ts
type UserLookup = {
  id: string;
  email: string;
};
```

to:

```ts
type UserLookup = {
  id: string;
  email: string;
  firebaseUid?: string;
};
```

Optional (not required): the three `defaultDeps` lookups below always populate it from the real DB row, but test doubles across `stripeWebhook.test.ts` construct `UserLookup`-shaped literals without it (cast `as never`), and the call site added in Task 3 treats a missing value as "skip the GA4 event, log a warning" rather than an error.

- [ ] **Step 2: Pass `firebaseUid` through the three lookups**

In the same file, update `defaultDeps`:

```ts
  async findUserByEmail(email: string) {
    const user = await userRepository.findUserByEmail(email);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email, firebaseUid: user.firebaseUid};
  },
  async findUserByFirebaseUid(firebaseUid: string) {
    const user = await userRepository.findUserByFirebaseUid(firebaseUid);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email, firebaseUid: user.firebaseUid};
  },
  async findUserByStripeCustomerId(customerId: string) {
    const userId = await subscriptionService.findUserIdByStripeCustomerId(customerId);
    if (!userId) {
      return null;
    }
    const user = await userRepository.findUserById(userId);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email, firebaseUid: user.firebaseUid};
  },
```

(`userRepository.findUserByEmail` / `findUserByFirebaseUid` / `findUserById` already `select()` the full row — `users.firebaseUid` is present on `user`, it was just being dropped by the old return-shape literal.)

- [ ] **Step 3: Verify the build**

Run: `cd functions && npm run build`
Expected: compiles with no errors (this task has no isolated runtime behavior to unit test — it's exercised end-to-end by Task 3's `handleCheckoutCompleted` test).

- [ ] **Step 4: Commit**

```bash
git add functions/src/stripeWebhook.ts
git commit -m "feat(functions): carry firebaseUid through stripeWebhook user lookups"
```

---

## Task 3: Wire the purchase event into `handleCheckoutCompleted`

**Files:**
- Modify: `functions/src/stripeWebhook.ts:1-14` (imports), `:26-40` (`StripeWebhookDeps`), `:42-93` (`defaultDeps`), `:373-469` (`handleCheckoutCompleted`)
- Test: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/stripeWebhook.test.ts` (near the other handler tests, after the `handleInvoicePaymentSucceeded` block). This requires `handleCheckoutCompleted` to be exported and a `Stripe.Checkout.Session` + `checkout.sessions.listLineItems` stub, matching the existing `handleInvoicePaymentSucceeded` test's `mockStripe` pattern:

```ts
test("handleCheckoutCompleted sends a GA4 purchase event for a credit-pack purchase", async () => {
  let sentEvent: unknown = null;

  const session = {
    id: "cs_test_credit_pack",
    customer_details: { email: "person@example.com" },
    customer_email: "person@example.com",
    client_reference_id: null,
    subscription: null,
    customer: "cus_123",
    amount_total: 1000,
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: "price_credit_pack" }, quantity: 1 }],
        }),
      },
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
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async (params: unknown) => {
      sentEvent = params;
    },
  } as never);

  assert.deepEqual(sentEvent, {
    firebaseUid: "firebase-uid-1",
    transactionId: "cs_test_credit_pack",
    valueCents: 1000,
    currency: "usd",
  });
});

test("handleCheckoutCompleted does not send a GA4 purchase event for a subscription-only purchase", async () => {
  let called = false;

  const session = {
    id: "cs_test_sub",
    customer_details: { email: "person@example.com" },
    customer_email: "person@example.com",
    client_reference_id: null,
    subscription: "sub_123",
    customer: "cus_123",
    amount_total: 2000,
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: "price_monthly_20" }, quantity: 1 }],
        }),
      },
    },
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
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
    sendPurchaseEvent: async () => {
      called = true;
    },
  } as never);

  assert.equal(called, false);
});

test("handleCheckoutCompleted skips the GA4 purchase event when firebaseUid is missing", async () => {
  let called = false;

  const session = {
    id: "cs_test_no_uid",
    customer_details: { email: "person@example.com" },
    customer_email: "person@example.com",
    client_reference_id: null,
    subscription: null,
    customer: "cus_123",
    amount_total: 1000,
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: "price_credit_pack" }, quantity: 1 }],
        }),
      },
    },
  } as unknown as Stripe;

  await handleCheckoutCompleted(mockStripe, session, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async () => {
      called = true;
    },
  } as never);

  assert.equal(called, false);
});
```

Also add one test at the `stripeWebhookHandler` level (near the "trims whitespace" test) proving the spec's dedupe guarantee holds for the new call too — a retried `event.id` never reaches `handleCheckoutCompleted`, so `sendPurchaseEvent` can't double-fire:

```ts
test("stripeWebhookHandler does not call sendPurchaseEvent for an already-processed event", async (t) => {
  const stripe = new Stripe("sk_test_123");
  t.mock.method(
    stripe.webhooks,
    "constructEvent",
    (_payload: unknown, _signature: unknown, _secret: unknown) => {
      return {id: "evt_dedupe_1", type: "checkout.session.completed", data: {object: {}}} as never;
    }
  );
  setStripeClientFactoryForTests(() => stripe);
  t.after(() => setStripeClientFactoryForTests(null));

  const res = createResponseRecorder();
  let called = false;
  const deps = {
    findUserByEmail: async () => ({id: "user-1", email: "person@example.com", firebaseUid: "firebase-uid-1"}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async () => {
      called = true;
    },
    markEventProcessed: async () => false, // already processed → dedupe short-circuits before dispatch
    completeEventProcessed: async () => {},
    unmarkEventProcessed: async () => {},
    getLastProcessedChargeRefundTotal: async () => 0,
  };

  await stripeWebhookHandler(
    {
      method: "POST",
      headers: {"stripe-signature": "t=1,v1=sig"},
      rawBody: Buffer.from("{}"),
    } as never,
    res as never,
    deps as never
  );

  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
});
```

Also add `handleCheckoutCompleted` to the import list at the top of the test file:

```ts
import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
  handleCheckoutCompleted,
  handleInvoicePaymentSucceeded,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleChargeRefunded,
  setStripeClientFactoryForTests,
} from "./stripeWebhook.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/stripeWebhook.test.js"`
Expected: build error — `handleCheckoutCompleted` is not exported, and `sendPurchaseEvent` doesn't exist on the deps type yet.

- [ ] **Step 3: Add `sendPurchaseEvent` to the deps interface and default implementation**

In `functions/src/stripeWebhook.ts`, add the import:

```ts
import {sendPurchaseEvent as sendGa4PurchaseEvent} from "./services/ga4MeasurementService.js";
```

Add to `StripeWebhookDeps`:

```ts
interface StripeWebhookDeps {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  findUserByFirebaseUid: (firebaseUid: string) => Promise<UserLookup | null>;
  findUserByStripeCustomerId: (customerId: string) => Promise<UserLookup | null>;
  upsertSubscription: (params: UpsertSubscriptionParams) => Promise<void>;
  renewSubscriptionCredits: (userId: string, amount: number, expiresAt: Date, referenceId: string) => Promise<boolean>;
  addCredits: (userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) => Promise<void>;
  adjustCredits: (userId: string, delta: number, reason: string, referenceId?: string) => Promise<void>;
  sendPurchaseEvent: (params: {firebaseUid: string; transactionId: string; valueCents: number; currency: string}) => Promise<void>;
  isEventProcessed: (eventId: string) => Promise<boolean>;
  markEventProcessed: (eventId: string) => Promise<boolean>;
  completeEventProcessed: (eventId: string) => Promise<void>;
  unmarkEventProcessed: (eventId: string) => Promise<void>;
  expireProcessingClaim: (eventId: string) => Promise<void>;
  getLastProcessedChargeRefundTotal: (chargeId: string) => Promise<number>;
}
```

Add to `defaultDeps` (after `adjustCredits`):

```ts
  async sendPurchaseEvent(params: {firebaseUid: string; transactionId: string; valueCents: number; currency: string}) {
    await sendGa4PurchaseEvent(params);
  },
```

- [ ] **Step 4: Export `handleCheckoutCompleted` and call `deps.sendPurchaseEvent`**

Change `async function handleCheckoutCompleted(` to `export async function handleCheckoutCompleted(`.

In the same function, update the credit-pack branch:

```ts
  if (totalCreditPackQty > 0) {
    const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
    await deps.addCredits(
      user.id,
      CREDIT_PACK_AMOUNT * totalCreditPackQty,
      expiresAt,
      'one_time',
      session.id
    );
    logger.info("checkout.session.completed: credits added", {
      email: customerEmail,
      credits: CREDIT_PACK_AMOUNT * totalCreditPackQty,
    });

    if (user.firebaseUid) {
      await deps.sendPurchaseEvent({
        firebaseUid: user.firebaseUid,
        transactionId: session.id,
        valueCents: creditPackValueCents,
        currency: session.currency ?? "usd",
      });
    } else {
      logger.warn("checkout.session.completed: missing firebaseUid, skipping GA4 purchase event", {
        sessionId: session.id,
      });
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/stripeWebhook.test.js"`
Expected: all tests pass, including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(functions): fire GA4 purchase event on credit-pack checkout completion"
```

---

## Task 4: Bind the GA4 secrets to the `stripeWebhook` function

**Files:**
- Modify: `functions/src/stripeWebhook.ts:360-371`

- [ ] **Step 1: Add the two secrets to the function definition**

```ts
export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    secrets: [
      ...CLOUD_SQL_SECRETS,
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "GA4_MEASUREMENT_ID",
      "GA4_MP_API_SECRET",
    ]
  },
  stripeWebhookHandler
);
```

- [ ] **Step 2: Verify the build**

Run: `cd functions && npm run build`
Expected: compiles with no errors. (No new runtime behavior here — `secrets` is a deploy-time binding; it's what makes `process.env.GA4_MEASUREMENT_ID` / `GA4_MP_API_SECRET` populated in production, which Task 1's tests already cover in isolation.)

- [ ] **Step 3: Commit**

```bash
git add functions/src/stripeWebhook.ts
git commit -m "chore(functions): bind GA4 Measurement Protocol secrets to stripeWebhook"
```

---

## Task 5: Full suite verification

- [ ] **Step 1: Run the repository-level checks**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all checks pass, including the pre-existing suite plus everything added in Tasks 1 and 3.

---

## Owner action (not part of this implementation — blocks deploy only)

Per the spec: the owner must generate `GA4_MP_API_SECRET` in **GA4 Admin → Data Streams → [Web Stream] → Measurement Protocol API secrets**, then load it into GCP Secret Manager as `GA4_MP_API_SECRET`, and load the existing measurement ID (`G-TELW4E82QJ`) into Secret Manager as `GA4_MEASUREMENT_ID`. Both must exist in Secret Manager before this function can deploy successfully (Firebase Functions v2 fails deploy if a listed secret doesn't exist).
