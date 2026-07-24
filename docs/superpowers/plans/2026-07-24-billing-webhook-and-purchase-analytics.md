# Billing Webhook Correctness + Purchase Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three RevenueCat webhook money bugs, add missing event handling and double-subscribe/stale-bundle UX guards, and route every real purchase (Stripe + RevenueCat) into GA4 → BigQuery with canonical revenue views.

**Architecture:** Billing stays split by design — Stripe direct on web (`functions/src/stripeWebhook.ts`), RevenueCat on native (`functions/src/revenueCatWebhook.ts`), unified in Cloud SQL. This plan hardens the RC webhook's event handling, plumbs `subscriptionProvider` into the client bootstrap for a client-side collision gate, generalizes the existing GA4 Measurement Protocol service to carry a `paymentProvider` tag and decimal-value purchases, and adds hand-written BigQuery views over the GA4 daily export dataset (`clanker-prod.analytics_544289823`).

**Tech Stack:** TypeScript, Firebase Functions v2, Drizzle ORM / Cloud SQL Postgres, `node:test` (functions), React Native / Expo + XState (client), GA4 Measurement Protocol, BigQuery (`bq` CLI).

---

## Ground Rules (read before starting)

- **TDD, always.** Write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Run the functions test suite** with: `cd functions && npm test` — this does `tsc` build then `node --test` over `lib/**/*.test.js`. To run a single file after a build, use `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`.
- **Client tests** run from repo root with the project's configured runner (`npm test`); mirror the nearest existing `*.test.ts(x)` in `src/`.
- **Commit after every green step.** Small commits.
- **PRs target `staging`** per `docs/GIT_WORKFLOW.md` — never `main`.
- **Money-path floor invariant:** credit balance is `GREATEST(SUM(remainingBalance), 0)` in `syncSubscriptionCache` (`functions/src/services/creditService.ts`), so negative adjustment rows never drive the *cached* balance below zero. Clawbacks still use `adjustCredits` with a unique `referenceId` for idempotency.

---

## File Structure

**Modified — backend:**
- `functions/src/revenueCatWebhook.ts` — parse extension (A6), sandbox guard (A1), refund/product guards (A2/A3), new event types (A4), GA4 purchase/refund emission (B1). New deps: `adjustCredits`, `sendPurchaseEvent`, `sendRefundEvent`.
- `functions/src/services/ga4MeasurementService.ts` — generalize `PurchaseEventParams` (decimal `value` OR `valueMinorUnits`, `paymentProvider`, `items`, `store`, `periodType`); add `sendRefundEvent`.
- `functions/src/stripeWebhook.ts` — add `paymentProvider: "stripe"` at the GA4 call site; widen the `sendPurchaseEvent` dep signature.
- `functions/src/exchangeToken.ts` — include `subscriptionProvider` in the bootstrap subscription payload (for A5 client gate).

**Modified — client:**
- `src/auth/bootstrapSession.ts` — add `subscriptionProvider` to `SubscriptionSnapshot` + `normalizeBootstrapResponse`.
- `src/components/CreditsDisplay.tsx` — client double-subscribe gate (A5) + stale-bundle `invalid-argument` message (A7).

**Modified — tests:**
- `functions/src/revenueCatWebhook.test.ts`, `functions/src/stripeWebhook.test.ts`, `functions/src/services/ga4MeasurementService.test.ts`, `functions/src/purchasePackageStripe.test.ts`.
- `src/components/__tests__/CreditsDisplay.test.tsx` (create if absent — check first).

**Created — analytics + docs:**
- `analytics/bq/v_purchases.sql`, `analytics/bq/v_user_journey.sql`, `analytics/bq/README.md`.
- `docs/billing-architecture.md`.

---

## PR 1 — RevenueCat money bugs (A6 → A1 → A3 → A2)

All changes in `functions/src/revenueCatWebhook.ts` + `functions/src/revenueCatWebhook.test.ts`.

### Task 1: A6 — Extend `parseRevenueCatEvent` to carry new optional fields

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (interface `RevenueCatEvent` ~150-158; `parseRevenueCatEvent` return ~263-273)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/src/revenueCatWebhook.test.ts`:

```ts
test("parseRevenueCatEvent extracts the extended optional fields", () => {
  const parsed = parseRevenueCatEvent({
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "uid_123",
      product_id: "monthly_20_subscription",
      environment: "SANDBOX",
      cancel_reason: "CUSTOMER_SUPPORT",
      store: "APP_STORE",
      transaction_id: "txn_abc",
      purchased_at_ms: 1_700_000_000_000,
      period_type: "NORMAL",
      price: 20,
      price_in_purchased_currency: 20,
      currency: "USD",
      country_code: "US",
    },
  });

  assert.equal(parsed.event.environment, "SANDBOX");
  assert.equal(parsed.event.cancel_reason, "CUSTOMER_SUPPORT");
  assert.equal(parsed.event.store, "APP_STORE");
  assert.equal(parsed.event.transaction_id, "txn_abc");
  assert.equal(parsed.event.purchased_at_ms, 1_700_000_000_000);
  assert.equal(parsed.event.period_type, "NORMAL");
  assert.equal(parsed.event.price, 20);
  assert.equal(parsed.event.price_in_purchased_currency, 20);
  assert.equal(parsed.event.currency, "USD");
  assert.equal(parsed.event.country_code, "US");
});

test("parseRevenueCatEvent tolerates absent extended fields", () => {
  const parsed = parseRevenueCatEvent({
    event: { type: "RENEWAL", app_user_id: "uid_1", product_id: "monthly_20_subscription" },
  });
  assert.equal(parsed.event.environment, undefined);
  assert.equal(parsed.event.price_in_purchased_currency, undefined);
});

test("parseRevenueCatEvent rejects a wrong-typed price", () => {
  assert.throws(() =>
    parseRevenueCatEvent({
      event: { type: "RENEWAL", app_user_id: "uid_1", product_id: "monthly_20_subscription", price: "free" },
    })
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (`parsed.event.environment` is `undefined`; type errors during build for unknown props).

- [ ] **Step 3: Implement**

Extend the `RevenueCatEvent` interface (currently ~150-158):

```ts
interface RevenueCatEvent {
  event: {
    type: string;
    app_user_id: string; // Firebase UID
    product_id: string;
    expiration_at_ms?: number;
    original_transaction_id?: string;
    environment?: string;
    cancel_reason?: string;
    store?: string;
    transaction_id?: string;
    purchased_at_ms?: number;
    period_type?: string;
    price?: number;
    price_in_purchased_currency?: number;
    currency?: string;
    country_code?: string;
  };
}
```

Add these lenient extractors just before the `return` in `parseRevenueCatEvent` (after the `normalizedOriginalTransactionId` block, ~261):

```ts
  const optionalString = (raw: unknown, field: string): string | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") throw new Error(`Invalid event.${field}`);
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const optionalNumber = (raw: unknown, field: string): number | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`Invalid event.${field}`);
    return raw;
  };

  const environment = optionalString(event.environment, "environment");
  const cancelReason = optionalString(event.cancel_reason, "cancel_reason");
  const store = optionalString(event.store, "store");
  const transactionId = optionalString(event.transaction_id, "transaction_id");
  const purchasedAtMs = optionalNumber(event.purchased_at_ms, "purchased_at_ms");
  const periodType = optionalString(event.period_type, "period_type");
  const price = optionalNumber(event.price, "price");
  const priceInPurchasedCurrency = optionalNumber(event.price_in_purchased_currency, "price_in_purchased_currency");
  const currency = optionalString(event.currency, "currency");
  const countryCode = optionalString(event.country_code, "country_code");
```

Then spread them into the returned `event` object (extend the existing return ~263):

```ts
  return {
    event: {
      type,
      app_user_id: appUserId,
      product_id: productId,
      ...(expirationAtMs !== undefined && expirationAtMs !== null ? {expiration_at_ms: expirationAtMs} : {}),
      ...(normalizedOriginalTransactionId && normalizedOriginalTransactionId.length > 0 ?
        {original_transaction_id: normalizedOriginalTransactionId} : {}),
      ...(environment !== undefined ? {environment} : {}),
      ...(cancelReason !== undefined ? {cancel_reason: cancelReason} : {}),
      ...(store !== undefined ? {store} : {}),
      ...(transactionId !== undefined ? {transaction_id: transactionId} : {}),
      ...(purchasedAtMs !== undefined ? {purchased_at_ms: purchasedAtMs} : {}),
      ...(periodType !== undefined ? {period_type: periodType} : {}),
      ...(price !== undefined ? {price} : {}),
      ...(priceInPurchasedCurrency !== undefined ? {price_in_purchased_currency: priceInPurchasedCurrency} : {}),
      ...(currency !== undefined ? {currency} : {}),
      ...(countryCode !== undefined ? {country_code: countryCode} : {}),
    },
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "feat(rc-webhook): extend parseRevenueCatEvent with revenue + refund fields"
```

---

### Task 2: A1 — Ignore SANDBOX events

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (handler, after `type === "TEST"` short-circuit ~353)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("revenueCatWebhookHandler ignores SANDBOX events with 200 and no side effects", async () => {
  const res = createResponseRecorder();
  let findCalls = 0;
  let addCalls = 0;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_sandbox",
          product_id: "credit_pack_100",
          environment: "SANDBOX",
          original_transaction_id: "rc_txn_sbx",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => { findCalls += 1; return {id: "cloud-user-1"}; },
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => { addCalls += 1; },
    }
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {received: true, ignored: "sandbox"});
  assert.equal(findCalls, 0);
  assert.equal(addCalls, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (grants credits / wrong body).

- [ ] **Step 3: Implement**

In `revenueCatWebhookHandler`, immediately after the `if (type === "TEST") { ... }` block (~356), add:

```ts
    // Sandbox / TestFlight purchases must never grant production entitlements.
    // Respond 200 so RevenueCat does not retry.
    if (environment === "SANDBOX") {
      logger.info("RevenueCat webhook: ignoring sandbox event", {type, app_user_id, product_id});
      res.status(200).json({received: true, ignored: "sandbox"});
      return;
    }
```

Add `environment` to the destructure at ~341:

```ts
    const {type, app_user_id, product_id, expiration_at_ms, original_transaction_id, environment} =
      payload.event;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "fix(rc-webhook): ignore SANDBOX events so they never grant production credits"
```

---

### Task 3: A3 — Product-guard CANCELLATION and EXPIRATION + add `adjustCredits` dep

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (`RevenueCatDeps` ~63-70, `defaultDeps` ~72-133, `CANCELLATION` case ~500-532, `EXPIRATION` case ~534-544)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("revenueCatWebhookHandler deducts pack credits on a credit-pack CANCELLATION and leaves the sub untouched", async () => {
  const res = createResponseRecorder();
  const adjustCalls: Array<{delta: number; reason: string; referenceId?: string}> = [];
  let upsertCalls = 0;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "credit_pack_100",
          cancel_reason: "CUSTOMER_SUPPORT",
          original_transaction_id: "rc_pack_txn",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => { upsertCalls += 1; },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async (_uid, delta, reason, referenceId) => { adjustCalls.push({delta, reason, referenceId}); },
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls, 0, "credit-pack refund must not touch the subscription row");
  assert.equal(adjustCalls.length, 1);
  assert.equal(adjustCalls[0].delta, -10000); // CREDIT_PACK_AMOUNT
  assert.equal(adjustCalls[0].reason, "revenuecat_refund");
  assert.equal(adjustCalls[0].referenceId, "rc_pack_txn_refund");
});

test("revenueCatWebhookHandler leaves an unknown-product CANCELLATION as a no-op", async () => {
  const res = createResponseRecorder();
  let upsertCalls = 0;
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: { event: { type: "CANCELLATION", app_user_id: "uid_123", product_id: "some_unknown_product" } },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => { upsertCalls += 1; },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls, 0, "unknown-product cancellation must not downgrade");
});

test("revenueCatWebhookHandler only downgrades EXPIRATION for a known tier product", async () => {
  const res = createResponseRecorder();
  let upsertCalls = 0;
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: { event: { type: "EXPIRATION", app_user_id: "uid_123", product_id: "credit_pack_100" } },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => { upsertCalls += 1; },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls, 0, "pack expiration must not downgrade the subscription");
});
```

Note: existing tests (e.g. "keeps paid tier active on cancellation until expiration") pass a `deps` object without `adjustCredits`. Add `adjustCredits: async () => undefined,` to every existing `deps` literal in this test file so they satisfy the widened `RevenueCatDeps` type. (A quick pass: search the file for `renewSubscriptionCredits: async` and add the `adjustCredits` line beside each `addCredits` line.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (unknown-product cancellation still downgrades; no `adjustCredits`).

- [ ] **Step 3: Implement**

Add `adjustCredits` to `RevenueCatDeps` (after `addCredits` ~69):

```ts
  adjustCredits: (userId: string, delta: number, reason: string, referenceId?: string) => Promise<void>;
```

Add to `defaultDeps` (after the `addCredits` impl ~132):

```ts
  async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string) {
    await creditService.adjustCredits(userId, delta, reason, referenceId);
  },
```

Replace the `CANCELLATION` case (~500-532) with product-guarded logic. **Note:** A2 (refund downgrade for subscriptions) lands in Task 4 — this task establishes the credit-pack and unknown-product branches and keeps the existing benign auto-renew-off branch:

```ts
      case "CANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          // Subscription cancellation. Refund handling (cancel_reason CUSTOMER_SUPPORT)
          // is added in the A2 task; here, non-refund cancels stay benign (auto-renew off).
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: true,
          });
          logger.info("RevenueCat: subscription cancellation recorded (auto-renew off, entitlement still active)", {
            app_user_id, product_id, tier,
          });
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          // A credit-pack "cancellation" is a pack refund. Deduct the granted pack credits
          // (floored at zero by syncSubscriptionCache) and leave the subscription row alone.
          if (original_transaction_id) {
            await deps.adjustCredits(
              cloudUser.id,
              -CREDIT_PACK_AMOUNT,
              "revenuecat_refund",
              `${original_transaction_id}_refund`
            );
            logger.info("RevenueCat: credit-pack refund deducted", {app_user_id, product_id, credits: CREDIT_PACK_AMOUNT});
          } else {
            logger.warn("RevenueCat: credit-pack cancellation missing original_transaction_id, cannot deduct", {app_user_id, product_id});
          }
        } else {
          // Neither a known tier nor a known pack — log only, never downgrade.
          logger.warn("RevenueCat: cancellation for unknown product, no state change", {app_user_id, product_id});
        }
        break;
      }
```

Replace the `EXPIRATION` case (~534-544) with:

```ts
      case "EXPIRATION": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: "free",
            planStatus: "expired",
            subscriptionProvider: null,
            cancelAtPeriodEnd: false,
          });
          logger.info("RevenueCat: subscription expired", {app_user_id, product_id});
        } else {
          logger.info("RevenueCat: expiration for non-subscription product, no state change", {app_user_id, product_id});
        }
        break;
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "fix(rc-webhook): product-guard CANCELLATION/EXPIRATION; deduct pack refunds"
```

---

### Task 4: A2 — Handle subscription refunds (`cancel_reason: CUSTOMER_SUPPORT`)

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (`CANCELLATION` case subscription branch; destructure ~341)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("revenueCatWebhookHandler downgrades and claws back on a subscription refund", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];
  const adjustCalls: Array<{delta: number; reason: string; referenceId?: string}> = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          cancel_reason: "CUSTOMER_SUPPORT",
          original_transaction_id: "rc_sub_txn",
          expiration_at_ms: Date.UTC(2026, 4, 20),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (p) => { upsertCalls.push(p); },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async (_uid, delta, reason, referenceId) => { adjustCalls.push({delta, reason, referenceId}); },
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].planTier, "free");
  assert.equal(upsertCalls[0].planStatus, "cancelled");
  assert.equal(upsertCalls[0].subscriptionProvider, null);
  assert.equal(adjustCalls.length, 1);
  assert.equal(adjustCalls[0].delta, -30000); // SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT
  assert.equal(adjustCalls[0].reason, "revenuecat_refund");
  assert.equal(adjustCalls[0].referenceId, "rc_sub_txn_1747699200000_refund");
});

test("revenueCatWebhookHandler claws back on a CUSTOMER_SUPPORT refund missing expiration_at_ms via transaction_id fallback", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];
  const adjustCalls: Array<{delta: number; reason: string; referenceId?: string}> = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          cancel_reason: "CUSTOMER_SUPPORT",
          original_transaction_id: "rc_sub_txn",
          transaction_id: "rc_void_txn",
          // expiration_at_ms omitted: store voided the sub immediately.
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (p) => { upsertCalls.push(p); },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async (_uid, delta, reason, referenceId) => { adjustCalls.push({delta, reason, referenceId}); },
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls[0].planTier, "free");
  assert.equal(upsertCalls[0].planStatus, "cancelled");
  assert.equal(adjustCalls.length, 1);
  assert.equal(adjustCalls[0].delta, -30000);
  assert.equal(adjustCalls[0].referenceId, "rc_sub_txn_rc_void_txn_refund");
});

test("revenueCatWebhookHandler treats a non-refund CANCELLATION as benign auto-renew-off", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];
  const adjustCalls: unknown[] = [];
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          cancel_reason: "UNSUBSCRIBE",
          expiration_at_ms: Date.UTC(2026, 4, 20),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (p) => { upsertCalls.push(p); },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async (...a) => { adjustCalls.push(a); },
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].planTier, "monthly_20");
  assert.equal(upsertCalls[0].planStatus, "active");
  assert.equal(upsertCalls[0].cancelAtPeriodEnd, true);
  assert.equal(adjustCalls.length, 0);
});
```

(`Date.UTC(2026, 4, 20)` is `1747699200000`, matching the expected refund referenceId suffix.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (refund path not yet distinguished).

- [ ] **Step 3: Implement**

Add `cancel_reason` to the destructure at ~341:

```ts
    const {type, app_user_id, product_id, expiration_at_ms, original_transaction_id, transaction_id, environment, cancel_reason} =
      payload.event;
```

In the `CANCELLATION` case, replace the subscription (`if (tier)`) branch body from Task 3 with a refund-aware version:

```ts
        if (tier) {
          if (cancel_reason === "CUSTOMER_SUPPORT") {
            // Refund: downgrade immediately and claw back this cycle's renewal credits.
            await deps.upsertSubscription({
              userId: cloudUser.id,
              planTier: "free",
              planStatus: "cancelled",
              subscriptionProvider: null,
              cancelAtPeriodEnd: false,
            });
            // Clawback key: prefer the per-cycle key used to grant renewal credits
            // (`${original_transaction_id}_${expiration_at_ms}`, see INITIAL_PURCHASE/RENEWAL).
            // Some store refunds void the sub immediately and omit `expiration_at_ms`; fall
            // back to `transaction_id` so the clawback still fires (still deterministic +
            // idempotent via the `_refund` suffix). Only skip if we have no key at all.
            const clawbackKey =
              typeof expiration_at_ms === "number" ? String(expiration_at_ms) :
              transaction_id ? String(transaction_id) : null;
            if (original_transaction_id && clawbackKey) {
              const referenceId = `${original_transaction_id}_${clawbackKey}_refund`;
              await deps.adjustCredits(
                cloudUser.id,
                -SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT,
                "revenuecat_refund",
                referenceId
              );
            } else {
              logger.warn("RevenueCat: subscription refund missing both expiration_at_ms and transaction_id, cannot claw back", {app_user_id, product_id, tier});
            }
            logger.info("RevenueCat: subscription refund — downgraded and clawed back", {app_user_id, product_id, tier});
          } else {
            // Benign auto-renew-off: entitlement stays active until EXPIRATION.
            const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
              new Date(expiration_at_ms) : null;
            const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
            await deps.upsertSubscription({
              userId: cloudUser.id,
              planTier: tier,
              planStatus: "active",
              renewalAt,
              subscriptionProvider: "revenuecat",
              cancelAtPeriodEnd: true,
            });
            logger.info("RevenueCat: subscription cancellation recorded (auto-renew off, entitlement still active)", {
              app_user_id, product_id, tier,
            });
          }
        } else if (isRevenueCatCreditPackProduct(product_id)) {
```

(The `else if`/`else` pack + unknown branches from Task 3 stay unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "fix(rc-webhook): handle CUSTOMER_SUPPORT refunds — downgrade + clawback"
```

- [ ] **Step 6: Open PR 1 → `staging`**

```bash
git push -u origin feat
gh pr create --base staging --title "RC webhook money bugs (A1-A3, A6)" --body "Sandbox guard, product-guarded cancel/expire, subscription + pack refund clawback, parse extension. Per docs/specs/2026-07-24-billing-webhook-and-purchase-analytics.md."
```

---

## PR 2 — Missing events, collision gate, stale-bundle UX (A4, A5, A7)

### Task 5: A4 — UNCANCELLATION, BILLING_ISSUE, TRANSFER

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (add cases before `default:` ~545)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("revenueCatWebhookHandler clears cancelAtPeriodEnd on UNCANCELLATION", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "UNCANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (p) => { upsertCalls.push(p); },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].planTier, "monthly_20");
  assert.equal(upsertCalls[0].planStatus, "active");
  assert.equal(upsertCalls[0].cancelAtPeriodEnd, false);
});

test("revenueCatWebhookHandler is a no-op on BILLING_ISSUE and TRANSFER", async () => {
  for (const type of ["BILLING_ISSUE", "TRANSFER"]) {
    const res = createResponseRecorder();
    let upsertCalls = 0;
    await revenueCatWebhookHandler(
      {
        method: "POST",
        headers: { authorization: "Bearer rc-secret" },
        body: { event: { type, app_user_id: "uid_123", product_id: "monthly_20_subscription" } },
      } as never,
      res as never,
      {
        findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
        getSubscription: async () => null,
        upsertSubscription: async () => { upsertCalls += 1; },
        renewSubscriptionCredits: async () => false,
        addCredits: async () => undefined,
        adjustCredits: async () => undefined,
      }
    );
    assert.equal(res.statusCode, 200, `${type} should 200`);
    assert.equal(upsertCalls, 0, `${type} should not change state`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (`UNCANCELLATION` falls through to `default`, no upsert).

- [ ] **Step 3: Implement**

Insert these cases immediately before `default:` (~545):

```ts
      case "UNCANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });
          logger.info("RevenueCat: uncancellation — auto-renew re-enabled", {app_user_id, product_id, tier});
        } else {
          logger.info("RevenueCat: uncancellation for non-subscription product, no state change", {app_user_id, product_id});
        }
        break;
      }
      case "BILLING_ISSUE": {
        // Grace period: entitlement stays active until EXPIRATION. Log for visibility.
        logger.warn("RevenueCat: billing issue (grace period, entitlement still active)", {app_user_id, product_id});
        break;
      }
      case "TRANSFER": {
        // Full re-pointing of entitlements between users is backlog; make occurrences visible.
        const transferredFrom = (payload.event as {transferred_from?: unknown}).transferred_from;
        const transferredTo = (payload.event as {transferred_to?: unknown}).transferred_to;
        logger.warn("RevenueCat: TRANSFER event received (not fully handled)", {
          app_user_id, product_id, transferredFrom, transferredTo,
        });
        break;
      }
```

Note: `transferred_from`/`transferred_to` are RC arrays not in the parsed type; the cast reads them best-effort for the log only.

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "feat(rc-webhook): handle UNCANCELLATION, BILLING_ISSUE, TRANSFER"
```

---

### Task 6: A5 backend — verify + lock in the double-subscribe guard

The guard already exists (`functions/src/purchasePackageStripe.ts:150-166`): a subscription checkout is rejected with `already-exists` when an active RevenueCat subscription exists. This task adds a regression test only.

**Files:**
- Test: `functions/src/purchasePackageStripe.test.ts`

- [ ] **Step 1: Inspect existing coverage**

Run: `grep -n "already-exists\|revenuecat\|SUBSCRIPTION_PRICE" functions/src/purchasePackageStripe.test.ts`
If a test already asserts the RC-collision rejection, skip to Step 5 (note it in the PR). Otherwise continue.

- [ ] **Step 2: Write the failing test**

Mirror the file's existing `handler` invocation style (read the top of `functions/src/purchasePackageStripe.test.ts` for how `request` and `deps` are built). Add:

```ts
test("purchasePackageStripe rejects a subscription checkout when an active RevenueCat sub exists", async () => {
  process.env.STRIPE_MONTHLY_20_PRICE_ID = "price_m20";
  process.env.STRIPE_MONTHLY_50_PRICE_ID = "price_m50";
  process.env.STRIPE_CREDIT_PACK_PRICE_ID = "price_pack";
  process.env.STRIPE_SUCCESS_URL = "https://app.example.com/success";
  process.env.STRIPE_CANCEL_URL = "https://app.example.com/cancel";

  await assert.rejects(
    () =>
      purchasePackageStripeHandler(
        { auth: { uid: "uid_123" }, data: { priceId: "price_m20" } } as never,
        {
          userRepository: { findUserByFirebaseUid: async () => ({ id: "cloud-1" }) } as never,
          subscriptionService: {
            getSubscription: async () => ({
              planStatus: "active",
              planTier: "monthly_20",
              subscriptionProvider: "revenuecat",
            }),
          } as never,
        }
      ),
    (err: unknown) => (err as {code?: string}).code === "already-exists"
  );
});

test("purchasePackageStripe still allows a credit-pack checkout with an active RevenueCat sub", async () => {
  // credit-pack price is not in SUBSCRIPTION_PRICE_IDS, so the RC guard is skipped.
  // Assert the guard branch does NOT throw already-exists (it will proceed to Stripe calls,
  // which the test's Stripe mock must stub — reuse the file's existing Stripe mock helper).
});
```

Implement the second test's body using whatever Stripe client mock the file already provides (see `setStripeClientFactoryForTests` usage in the existing tests). If the file has no Stripe mock helper, assert only the first test and leave a comment referencing the manual verification in `## Verification`.

- [ ] **Step 3: Run to verify (guard already present → should PASS immediately)**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/purchasePackageStripe.test.js"`
Expected: PASS (this is a characterization test of existing behavior). If it FAILS, the guard regressed — fix `purchasePackageStripe.ts` to restore the `already-exists` rejection.

- [ ] **Step 4: Commit**

```bash
git add functions/src/purchasePackageStripe.test.ts
git commit -m "test(purchase): lock in RC/Stripe double-subscribe backend guard"
```

---

### Task 7: A5 client — plumb `subscriptionProvider` into bootstrap and gate the subscribe button

**Files:**
- Modify: `functions/src/exchangeToken.ts` (subscription payload ~158-167)
- Modify: `src/auth/bootstrapSession.ts` (`SubscriptionSnapshot` ~19-28; `normalizeBootstrapResponse` ~78-87)
- Modify: `src/components/CreditsDisplay.tsx` (`handleSubscribe` ~103-129)
- Test: `functions/src/exchangeToken.test.ts`; `src/components/__tests__/CreditsDisplay.test.tsx`

- [ ] **Step 1 (backend): add `subscriptionProvider` to the bootstrap payload**

In `functions/src/exchangeToken.ts`, add to the `subscription` object (~158-167):

```ts
                subscriptionProvider: subscription.subscriptionProvider ?? null,
```

`subscriptionService.getSubscription` returns the full row (`select()`), which already includes `subscriptionProvider`, so no service change is needed.

- [ ] **Step 2 (backend test): assert it is returned**

In `functions/src/exchangeToken.test.ts`, find the test asserting the bootstrap subscription shape and add an assertion that `result.subscription.subscriptionProvider` equals the mocked row's provider (e.g. `"revenuecat"`). If the mocked subscription row lacks the field, add `subscriptionProvider: "revenuecat"` to that mock. Run:

`cd functions && npm run build && node --test --test-reporter spec "lib/exchangeToken.test.js"`
Expected: PASS.

- [ ] **Step 3 (client): widen `SubscriptionSnapshot`**

In `src/auth/bootstrapSession.ts`, add to the interface (~19-28):

```ts
  subscriptionProvider: 'stripe' | 'revenuecat' | null
```

And to `normalizeBootstrapResponse`'s `subscription` object (~78-87):

```ts
    subscriptionProvider: response.subscription.subscriptionProvider ?? null,
```

Also add `subscriptionProvider: 'stripe'` (or any placeholder) to the mock builder object near `mockBootstrapPlanStatus` (~120-122) so the mock bootstrap type-checks.

- [ ] **Step 4 (client): write the failing component test**

Create/extend `src/components/__tests__/CreditsDisplay.test.tsx` (check for an existing test file first; match the repo's RN testing setup — `@testing-library/react-native` or the project's harness). Failing test:

```tsx
test('blocks subscribe when an active subscription exists on the other provider', async () => {
  // Arrange: mock useAuthSubscription -> { planStatus: 'active', planTier: 'monthly_20', subscriptionProvider: 'revenuecat' }
  // and Platform.OS = 'web' (current provider = 'stripe').
  // Act: press the subscribe button.
  // Assert: makePackagePurchase('monthly_20') is NOT called, and the snackbar shows the
  //         "already have an active subscription" message.
});
```

Use the project's existing mocking approach for `~/hooks/useAuthSnapshot` (`useAuthSubscription`) and `~/utilities/makePackagePurchase`. Reference sibling tests under `src/components/__tests__/` or `src/hooks/__tests__/` for the exact `jest.mock` / render idioms.

- [ ] **Step 5: Run to verify failure**

Run the client suite for this file (e.g. `npm test -- CreditsDisplay`).
Expected: FAIL (`makePackagePurchase` is still called).

- [ ] **Step 6 (client): implement the gate**

In `src/components/CreditsDisplay.tsx`:

Add near the other hooks (~21-23):

```tsx
import { useAuthSubscription } from '~/hooks/useAuthSnapshot'
```

```tsx
  const subscription = useAuthSubscription()
```

At the top of `handleSubscribe` (after the `tryStartPurchase` guard, ~104-106), add:

```tsx
    const currentProvider = Platform.OS === 'web' ? 'stripe' : 'revenuecat'
    const hasActiveOtherProviderSub =
      subscription?.planStatus === 'active' &&
      subscription?.planTier != null &&
      subscription.planTier !== 'free' &&
      subscription.subscriptionProvider != null &&
      subscription.subscriptionProvider !== currentProvider

    if (hasActiveOtherProviderSub) {
      setErrorMessage('You already have an active subscription. Manage it on the platform where you subscribed.')
      resetPurchaseState()
      return
    }
```

Credit-pack purchases (`handleBuyCredits`) stay unguarded — do not touch that handler.

- [ ] **Step 7: Run to verify pass**

Run: `npm test -- CreditsDisplay`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/src/exchangeToken.ts functions/src/exchangeToken.test.ts \
  src/auth/bootstrapSession.ts src/components/CreditsDisplay.tsx \
  src/components/__tests__/CreditsDisplay.test.tsx
git commit -m "feat(billing): client double-subscribe gate via bootstrap subscriptionProvider"
```

---

### Task 8: A7 — Stale-bundle price-id error UX

**Files:**
- Modify: `src/components/CreditsDisplay.tsx` (`handleBuyCredits` ~90-95 and `handleSubscribe` catch ~113-120)
- Test: `src/components/__tests__/CreditsDisplay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test('shows the refresh message when the purchase fails with invalid-argument', async () => {
  // Arrange: makePackagePurchase rejects with { code: 'functions/invalid-argument' }.
  // Act: press "Buy" (payg).
  // Assert: snackbar shows "This app version is out of date — please refresh and try again."
});

test('shows the generic message for other purchase errors', async () => {
  // Arrange: makePackagePurchase rejects with a plain Error.
  // Assert: snackbar shows "Purchase failed. Please try again."
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- CreditsDisplay`
Expected: FAIL (both currently render the generic message).

- [ ] **Step 3: Implement**

Add a shared mapper near the top of the component body (after `const isWeb = ...`):

```tsx
  const purchaseErrorMessage = (e: any): string => {
    const code = typeof e?.code === 'string' ? e.code : undefined
    if (code === 'functions/invalid-argument') {
      return 'This app version is out of date — please refresh and try again.'
    }
    if (code === 'functions/already-exists' && typeof e?.message === 'string') {
      return e.message
    }
    return 'Purchase failed. Please try again.'
  }
```

In `handleBuyCredits` catch (~90-92), replace the `setErrorMessage(...)` line with:

```tsx
      setErrorMessage(purchaseErrorMessage(e))
```

In `handleSubscribe` catch (~113-120), replace the `firebaseCode`/`setErrorMessage` block with:

```tsx
      setErrorMessage(purchaseErrorMessage(e))
```

(The mapper preserves the existing `already-exists` behavior, so no regression.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- CreditsDisplay`
Expected: PASS.

- [ ] **Step 5: Commit + open PR 2**

```bash
git add src/components/CreditsDisplay.tsx src/components/__tests__/CreditsDisplay.test.tsx
git commit -m "feat(billing): map invalid-argument purchase failures to a refresh message"
git push
gh pr create --base staging --title "RC events + collision gate + stale-bundle UX (A4, A5, A7)" --body "UNCANCELLATION/BILLING_ISSUE/TRANSFER handling, client double-subscribe gate (subscriptionProvider plumbed through bootstrap), backend guard regression test, stale-bundle refresh message. Per docs/specs/2026-07-24-billing-webhook-and-purchase-analytics.md."
```

---

## PR 3 — Purchase analytics into GA4 (B1)

### Task 9: B1a — Generalize the GA4 service (decimal value, provider tag, refund event)

**Files:**
- Modify: `functions/src/services/ga4MeasurementService.ts`
- Test: `functions/src/services/ga4MeasurementService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("sendPurchaseEvent accepts a decimal value + paymentProvider (RevenueCat path)", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => { calls.push({ init }); return new Response(null, { status: 204 }); };

  await sendPurchaseEvent(
    {
      firebaseUid: "uid-9",
      transactionId: "rc_txn_9",
      value: 20,
      currency: "USD",
      paymentProvider: "revenuecat",
      items: [{ item_id: "monthly_20", item_name: "Monthly 20" }],
      store: "APP_STORE",
      periodType: "NORMAL",
    },
    fetchImpl as typeof fetch
  );

  const body = JSON.parse(String(calls[0].init?.body));
  const p = body.events[0].params;
  assert.equal(body.events[0].name, "purchase");
  assert.equal(p.value, 20);
  assert.equal(p.currency, "USD");
  assert.equal(p.payment_provider, "revenuecat");
  assert.equal(p.store, "APP_STORE");
  assert.equal(p.period_type, "NORMAL");
  assert.deepEqual(p.items, [{ item_id: "monthly_20", item_name: "Monthly 20" }]);
});

test("sendPurchaseEvent still converts valueMinorUnits for the Stripe path and tags provider", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => { calls.push({ init }); return new Response(null, { status: 204 }); };

  await sendPurchaseEvent(
    { firebaseUid: "uid-1", transactionId: "cs_1", valueMinorUnits: 1000, currency: "usd", paymentProvider: "stripe" },
    fetchImpl as typeof fetch
  );
  const p = JSON.parse(String(calls[0].init?.body)).events[0].params;
  assert.equal(p.value, 10);
  assert.equal(p.payment_provider, "stripe");
});

test("sendRefundEvent posts a refund event with the same transaction id", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => { calls.push({ init }); return new Response(null, { status: 204 }); };

  await sendRefundEvent(
    { firebaseUid: "uid-1", transactionId: "cs_1", value: 10, currency: "usd", paymentProvider: "stripe" },
    fetchImpl as typeof fetch
  );
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.events[0].name, "refund");
  assert.equal(body.events[0].params.transaction_id, "cs_1");
});
```

Import `sendRefundEvent` at the top of the test file:

```ts
import { buildClientId, sendPurchaseEvent, sendRefundEvent } from "./ga4MeasurementService.js";
```

Existing Stripe-path test `"sendPurchaseEvent posts a well-formed GA4 MP purchase event"` passes params without `paymentProvider`; add `paymentProvider: "stripe"` to it so it type-checks, and (if it asserts `params.items`) update the expected item to the new default (see Step 3).

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/services/ga4MeasurementService.test.js"`
Expected: FAIL (`value`/`paymentProvider`/`sendRefundEvent` not implemented; build errors).

- [ ] **Step 3: Implement**

Replace `PurchaseEventParams` and factor the body-builder. New interface:

```ts
export interface PurchaseEventParams {
  firebaseUid: string;
  transactionId: string;
  currency: string;
  paymentProvider: "stripe" | "revenuecat";
  // Supply exactly one of `value` (decimal, whole-currency) or `valueMinorUnits`.
  value?: number;
  valueMinorUnits?: number;
  items?: Array<{ item_id: string; item_name: string }>;
  store?: string;
  periodType?: string;
}
```

Add a resolver and a shared sender:

```ts
function resolveValue(params: PurchaseEventParams): number | null {
  if (typeof params.value === "number" && Number.isFinite(params.value)) return params.value;
  if (typeof params.valueMinorUnits === "number" && Number.isFinite(params.valueMinorUnits)) {
    return minorUnitsToDecimal(params.valueMinorUnits, params.currency);
  }
  return null;
}

async function sendGa4Event(
  eventName: "purchase" | "refund",
  params: PurchaseEventParams,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_MP_API_SECRET;
  if (!measurementId || !apiSecret) {
    logger.warn("GA4 Measurement Protocol not configured, skipping event", {
      eventName, transactionId: params.transactionId,
    });
    return;
  }

  const value = resolveValue(params);
  if (value === null) {
    logger.warn("GA4: missing value, skipping event (never guess revenue)", {
      eventName, transactionId: params.transactionId,
    });
    return;
  }

  const items = params.items ?? [{ item_id: "credit_pack", item_name: "Credit Pack" }];

  try {
    const url = `${GA4_MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          client_id: buildClientId(params.firebaseUid),
          user_id: params.firebaseUid,
          events: [
            {
              name: eventName,
              params: {
                transaction_id: params.transactionId,
                value,
                currency: params.currency,
                payment_provider: params.paymentProvider,
                items,
                ...(params.store ? { store: params.store } : {}),
                ...(params.periodType ? { period_type: params.periodType } : {}),
              },
            },
          ],
        }),
      });
      if (!response.ok) {
        logger.error("GA4 Measurement Protocol request failed", {
          eventName, transactionId: params.transactionId, status: response.status,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error("GA4 Measurement Protocol request threw", {
      eventName, transactionId: params.transactionId, error,
    });
  }
}

export async function sendPurchaseEvent(params: PurchaseEventParams, fetchImpl: typeof fetch = fetch): Promise<void> {
  return sendGa4Event("purchase", params, fetchImpl);
}

export async function sendRefundEvent(params: PurchaseEventParams, fetchImpl: typeof fetch = fetch): Promise<void> {
  return sendGa4Event("refund", params, fetchImpl);
}
```

Delete the old `sendPurchaseEvent` body (replaced above).

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/services/ga4MeasurementService.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/ga4MeasurementService.ts functions/src/services/ga4MeasurementService.test.ts
git commit -m "feat(ga4): generalize purchase event (decimal value, provider tag, refund event)"
```

---

### Task 10: B1b — Tag Stripe purchases with `paymentProvider`

**Files:**
- Modify: `functions/src/stripeWebhook.ts` (dep signature ~36 + ~83; call site ~487-492)
- Test: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing test**

In `functions/src/stripeWebhook.test.ts`, find the `handleCheckoutCompleted` test that asserts `sendPurchaseEvent` is called (search `sendPurchaseEvent`). Extend its assertion to require `paymentProvider: "stripe"`:

```ts
  assert.equal(purchaseEventCalls[0].paymentProvider, "stripe");
```

If the recorded call type doesn't include `paymentProvider`, widen the test's recorder type.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/stripeWebhook.test.js"`
Expected: FAIL (`paymentProvider` undefined).

- [ ] **Step 3: Implement**

Widen the `sendPurchaseEvent` dep type in `StripeWebhookDeps` (~36):

```ts
  sendPurchaseEvent: (params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"}) => Promise<void>;
```

And the `defaultDeps.sendPurchaseEvent` signature (~83):

```ts
  async sendPurchaseEvent(params: {firebaseUid: string; transactionId: string; valueMinorUnits: number; currency: string; paymentProvider: "stripe"}) {
    await sendGa4PurchaseEvent(params);
  },
```

At the call site in `handleCheckoutCompleted` (~487-492), add the tag:

```ts
        await deps.sendPurchaseEvent({
          firebaseUid: user.firebaseUid,
          transactionId: session.id,
          valueMinorUnits: creditPackValueMinorUnits,
          currency,
          paymentProvider: "stripe",
        });
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/stripeWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(stripe-webhook): tag GA4 purchase events with paymentProvider=stripe"
```

---

### Task 11: B1c — Emit GA4 purchase/refund from the RC webhook

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts` (deps + `INITIAL_PURCHASE`/`RENEWAL`, `NON_RENEWING_PURCHASE`, refund paths)
- Test: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("revenueCatWebhookHandler sends a GA4 purchase after a subscription INITIAL_PURCHASE", async () => {
  const res = createResponseRecorder();
  const purchaseCalls: any[] = [];
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_1",
          transaction_id: "rc_inner_txn_1",
          price_in_purchased_currency: 20,
          currency: "USD",
          store: "APP_STORE",
          period_type: "NORMAL",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
      sendPurchaseEvent: async (p: any) => { purchaseCalls.push(p); },
      sendRefundEvent: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(purchaseCalls.length, 1);
  assert.equal(purchaseCalls[0].paymentProvider, "revenuecat");
  assert.equal(purchaseCalls[0].firebaseUid, "uid_123");
  assert.equal(purchaseCalls[0].transactionId, "rc_inner_txn_1");
  assert.equal(purchaseCalls[0].value, 20);
  assert.equal(purchaseCalls[0].currency, "USD");
});

test("revenueCatWebhookHandler skips the GA4 purchase when price fields are absent", async () => {
  const res = createResponseRecorder();
  const purchaseCalls: any[] = [];
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "RENEWAL",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_1",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
      sendPurchaseEvent: async (p: any) => { purchaseCalls.push(p); },
      sendRefundEvent: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(purchaseCalls.length, 0);
});

test("revenueCatWebhookHandler sends a GA4 refund on a subscription refund", async () => {
  const res = createResponseRecorder();
  const refundCalls: any[] = [];
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          cancel_reason: "CUSTOMER_SUPPORT",
          original_transaction_id: "rc_sub_txn",
          transaction_id: "rc_inner_sub_txn",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          price_in_purchased_currency: 20,
          currency: "USD",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
      sendPurchaseEvent: async () => undefined,
      sendRefundEvent: async (p: any) => { refundCalls.push(p); },
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(refundCalls.length, 1);
  assert.equal(refundCalls[0].transactionId, "rc_inner_sub_txn");
  assert.equal(refundCalls[0].paymentProvider, "revenuecat");
});

test("a GA4 failure never fails the RC webhook response", async () => {
  const res = createResponseRecorder();
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: { authorization: "Bearer rc-secret" },
      body: {
        event: {
          type: "NON_RENEWING_PURCHASE",
          app_user_id: "uid_123",
          product_id: "credit_pack_100",
          original_transaction_id: "rc_pack_1",
          transaction_id: "rc_pack_inner_1",
          price_in_purchased_currency: 10,
          currency: "USD",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
      sendPurchaseEvent: async () => { throw new Error("GA4 down"); },
      sendRefundEvent: async () => undefined,
    }
  );
  assert.equal(res.statusCode, 200, "GA4 failure must not fail the webhook");
});
```

Add `sendPurchaseEvent`/`sendRefundEvent` to every other `deps` literal in the file (both `async () => undefined`) so they type-check.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: FAIL (no GA4 emission; build errors on unknown deps).

- [ ] **Step 3: Implement**

Add imports at the top of `functions/src/revenueCatWebhook.ts`:

```ts
import {sendPurchaseEvent as sendGa4PurchaseEvent, sendRefundEvent as sendGa4RefundEvent} from "./services/ga4MeasurementService.js";
```

Add to `RevenueCatDeps`:

```ts
  sendPurchaseEvent: (params: {firebaseUid: string; transactionId: string; value?: number; currency: string; paymentProvider: "revenuecat"; items?: Array<{item_id: string; item_name: string}>; store?: string; periodType?: string}) => Promise<void>;
  sendRefundEvent: (params: {firebaseUid: string; transactionId: string; value?: number; currency: string; paymentProvider: "revenuecat"}) => Promise<void>;
```

Add to `defaultDeps`:

```ts
  async sendPurchaseEvent(params) { await sendGa4PurchaseEvent(params); },
  async sendRefundEvent(params) { await sendGa4RefundEvent(params); },
```

Add a helper above the handler (after `isRevenueCatCreditPackProduct`):

```ts
// Resolve the transaction id used to key GA4 revenue events. Prefer RC's transaction_id,
// fall back to the per-cycle key for renewals.
function resolveGa4TransactionId(event: RevenueCatEvent["event"]): string | undefined {
  if (event.transaction_id) return event.transaction_id;
  if (event.original_transaction_id && typeof event.expiration_at_ms === "number") {
    return `${event.original_transaction_id}_${event.expiration_at_ms}`;
  }
  return undefined;
}

// Fire a GA4 purchase event from RC data. Never throws (isolation) and never guesses revenue.
async function emitRevenueCatPurchase(
  deps: RevenueCatDeps,
  event: RevenueCatEvent["event"],
  productName: string,
): Promise<void> {
  const transactionId = resolveGa4TransactionId(event);
  if (!transactionId || typeof event.price_in_purchased_currency !== "number" || !event.currency) {
    logger.info("RevenueCat: insufficient data for GA4 purchase, skipping", {
      app_user_id: event.app_user_id, product_id: event.product_id,
    });
    return;
  }
  try {
    await deps.sendPurchaseEvent({
      firebaseUid: event.app_user_id,
      transactionId,
      value: event.price_in_purchased_currency,
      currency: event.currency,
      paymentProvider: "revenuecat",
      items: [{item_id: normalizeRevenueCatProductId(event.product_id), item_name: productName}],
      ...(event.store ? {store: event.store} : {}),
      ...(event.period_type ? {periodType: event.period_type} : {}),
    });
  } catch (err) {
    logger.error("RevenueCat: GA4 purchase emission failed (ignored)", {err, transactionId});
  }
}
```

**Wire in the emissions** (all *after* side effects succeed, never for SANDBOX — A1 already short-circuits). The cleanest approach: at the end of the `INITIAL_PURCHASE`/`RENEWAL` case, after the subscription/pack branches, and in `NON_RENEWING_PURCHASE`, call `emitRevenueCatPurchase`. Because those cases need `payload.event` (with the extended fields), thread it in. In the handler, capture the full parsed event once (near the destructure ~341):

```ts
    const rcEvent = payload.event;
```

Then:

- In `INITIAL_PURCHASE`/`RENEWAL`, at the very end of the case (before `break;`), add:

```ts
        if (type === "INITIAL_PURCHASE" || type === "RENEWAL") {
          const productName = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId] ?? "Credit Pack";
          await emitRevenueCatPurchase(deps, rcEvent, productName);
        }
```

- In `NON_RENEWING_PURCHASE`, after the `addCredits` succeeds (before `break;`):

```ts
        await emitRevenueCatPurchase(deps, rcEvent, "Credit Pack");
```

- In the refund branches, emit a GA4 refund. In the subscription-refund branch (A2) and the credit-pack-refund branch (A3), after the `adjustCredits` call add:

```ts
          const refundTxnId = resolveGa4TransactionId(rcEvent);
          if (refundTxnId && typeof rcEvent.price_in_purchased_currency === "number" && rcEvent.currency) {
            try {
              await deps.sendRefundEvent({
                firebaseUid: app_user_id,
                transactionId: refundTxnId,
                value: rcEvent.price_in_purchased_currency,
                currency: rcEvent.currency,
                paymentProvider: "revenuecat",
              });
            } catch (err) {
              logger.error("RevenueCat: GA4 refund emission failed (ignored)", {err, refundTxnId});
            }
          }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && node --test --test-reporter spec "lib/revenueCatWebhook.test.js"`
Expected: PASS.

- [ ] **Step 5: Add GA4 secrets to the RC function deploy config**

The RC function must have the GA4 secrets to actually send. In `functions/src/revenueCatWebhook.ts`, extend the `onRequest` `secrets` array (~561):

```ts
    secrets: [...CLOUD_SQL_SECRETS, "REVENUECAT_WEBHOOK_SECRET", "GA4_MEASUREMENT_ID", "GA4_MP_API_SECRET"]
```

Preflight (per `project_firebase_secret_preflight` memory): confirm both secret names already have Secret Manager versions in `clanker-prod` (they do — the Stripe webhook uses them). Verify:

```bash
gcloud secrets versions list GA4_MEASUREMENT_ID --project clanker-prod --limit 1
gcloud secrets versions list GA4_MP_API_SECRET --project clanker-prod --limit 1
```

- [ ] **Step 6: Commit + open PR 3**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "feat(rc-webhook): emit GA4 purchase/refund events tagged revenuecat"
git push
gh pr create --base staging --title "Purchase analytics into GA4 (B1)" --body "Generalized GA4 service (decimal value, provider tag, refund event); Stripe + RC purchase/refund emission with failure isolation; GA4 secrets added to RC function. Per docs/specs/2026-07-24-billing-webhook-and-purchase-analytics.md."
```

---

## PR 4 — Canonical BigQuery views + docs (B3, B5)

No deploy risk; SQL + Markdown only.

### Task 12: B3 — `v_purchases` and `v_user_journey` views

**Files:**
- Create: `analytics/bq/v_purchases.sql`, `analytics/bq/v_user_journey.sql`, `analytics/bq/README.md`

- [ ] **Step 1: Create `analytics/bq/v_purchases.sql`**

One row per transaction from server-sent `purchase`/`refund` events, with a `refunded` flag.

```sql
-- clanker_analytics.v_purchases
-- One row per transaction, sourced from the server-sent GA4 purchase/refund events
-- in the daily export dataset. Daily export only — data lands ~24h behind; there is
-- no events_intraday_* table, so "today" returns nothing by design.
CREATE OR REPLACE VIEW `clanker-prod.clanker_analytics.v_purchases` AS
WITH purchases AS (
  SELECT
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') AS transaction_id,
    user_id,
    user_pseudo_id,
    event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp,
    (SELECT ep.value.double_value FROM UNNEST(event_params) ep WHERE ep.key = 'value') AS value,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'currency') AS currency,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'payment_provider') AS payment_provider,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'store') AS store,
    (SELECT i.item_id FROM UNNEST(items) i LIMIT 1) AS item_id
  FROM `clanker-prod.analytics_544289823.events_*`
  WHERE event_name = 'purchase'
),
refunds AS (
  SELECT DISTINCT
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') AS transaction_id
  FROM `clanker-prod.analytics_544289823.events_*`
  WHERE event_name = 'refund'
)
SELECT
  p.transaction_id,
  p.user_id,
  p.user_pseudo_id,
  p.event_date,
  p.event_timestamp,
  p.value,
  p.currency,
  p.payment_provider,
  p.store,
  p.item_id,
  r.transaction_id IS NOT NULL AS refunded
FROM purchases p
LEFT JOIN refunds r USING (transaction_id);
```

- [ ] **Step 2: Create `analytics/bq/v_user_journey.sql`**

Corrected journey query — bounded `_TABLE_SUFFIX` on both scans, `%Y%m%d`, real event-name filters, `user_id` join with `user_pseudo_id` retained.

```sql
-- clanker_analytics.v_user_journey
-- Behavioral funnel over the trailing 90 days of the GA4 daily export.
-- Corrections vs. the advice draft: %Y%m%d (not %Y%m%m); _TABLE_SUFFIX bounded on
-- BOTH the inner and outer scans; filter on real event names, not URL guessing;
-- join on user_id with user_pseudo_id retained for pre-login stitching.
CREATE OR REPLACE VIEW `clanker-prod.clanker_analytics.v_user_journey` AS
WITH bounds AS (
  SELECT
    FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)) AS start_suffix,
    FORMAT_DATE('%Y%m%d', CURRENT_DATE()) AS end_suffix
),
events AS (
  SELECT
    user_id,
    user_pseudo_id,
    event_name,
    event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp
  FROM `clanker-prod.analytics_544289823.events_*`, bounds
  WHERE _TABLE_SUFFIX BETWEEN bounds.start_suffix AND bounds.end_suffix
    AND event_name IN ('subscribe_flow_started', 'purchase', 'screen_view', 'page_view')
)
SELECT
  COALESCE(user_id, user_pseudo_id) AS journey_key,
  user_id,
  user_pseudo_id,
  event_name,
  event_date,
  event_timestamp
FROM events
ORDER BY journey_key, event_timestamp;
```

Note: `subscribe_flow_started` is an assumed client funnel event; if it is not emitted, the filter simply yields no rows for it — no error. Document this in the README.

- [ ] **Step 3: Create `analytics/bq/README.md`**

```markdown
# BigQuery analytics views

Hand-written views over the GA4 daily export (`clanker-prod.analytics_544289823`),
kept in a separate dataset (`clanker_analytics`) so they are never clobbered by the
auto-managed GA4 export.

## One-time dataset creation

    bq --project_id=clanker-prod mk --dataset --location=US clanker_analytics

## Apply / update the views

    bq --project_id=clanker-prod query --use_legacy_sql=false < analytics/bq/v_purchases.sql
    bq --project_id=clanker-prod query --use_legacy_sql=false < analytics/bq/v_user_journey.sql

## Notes

- **Daily export only.** Tables land ~24h behind; there is no `events_intraday_*`.
  A "today" query returns nothing by design (owner decision 2026-07-24: no streaming export).
- `v_purchases` counts each transaction exactly once from the server-sent `purchase`
  events. See the B2 double-count check below before trusting native totals.
- `subscribe_flow_started` in `v_user_journey` is a client funnel event; if not emitted,
  those rows are simply absent.

## B2 double-count check (run after the first native purchase)

The Firebase native SDK can auto-log `in_app_purchase`. If it lands alongside the
server-sent `purchase`, native revenue double-counts. After the first native test purchase:

    bq --project_id=clanker-prod query --use_legacy_sql=false \
      'SELECT event_name, COUNT(*) FROM `clanker-prod.analytics_544289823.events_*`
       WHERE event_name IN ("purchase","in_app_purchase") GROUP BY event_name'

If `in_app_purchase` is present: prefer disabling the platform IAP auto-collection flag;
failing that, exclude `in_app_purchase` from these views and document why here.
```

- [ ] **Step 4: Verify SQL parses (dry run, requires `bq` auth)**

Run:
```bash
bq --project_id=clanker-prod query --use_legacy_sql=false --dry_run < analytics/bq/v_purchases.sql
bq --project_id=clanker-prod query --use_legacy_sql=false --dry_run < analytics/bq/v_user_journey.sql
```
Expected: dry-run succeeds (bytes-processed estimate), no syntax error. If `bq` is not authed in this environment, note it and defer the dry run to the deploy session (`## Verification`).

- [ ] **Step 5: Commit**

```bash
git add analytics/bq/
git commit -m "feat(analytics): canonical BigQuery views v_purchases + v_user_journey"
```

---

### Task 13: B5 — `docs/billing-architecture.md`

**Files:**
- Create: `docs/billing-architecture.md`

- [ ] **Step 1: Write the doc**

Include: the two-provider split and why it is intentional; the webhook event → side-effect matrix for **both** providers; the analytics flow (webhook → GA4 MP → daily export → `clanker_analytics` views); and the BQ dataset/view inventory. Skeleton to fill from the now-current code:

```markdown
# Billing architecture

## Two-provider split (intentional)

- **Web:** Stripe direct — `functions/src/stripeWebhook.ts`, `functions/src/purchasePackageStripe.ts`.
- **Native (iOS/Android):** RevenueCat — `functions/src/revenueCatWebhook.ts`.
- **Unified truth:** Cloud SQL (`subscriptions` + credit ledger `creditTransactions`).
  The client reads entitlements from the backend bootstrap (`exchangeToken`), never
  from the RC SDK, so cross-platform entitlements already work.

Why not consolidate on RevenueCat Web Billing / RC-Stripe? The ~1% RC fee on web
revenue buys nothing we don't already have (see spec 2026-07-24, Non-goals).

## Event → side-effect matrix

### RevenueCat (`revenueCatWebhook.ts`)

| Event | Product | Side effect |
|-------|---------|-------------|
| INITIAL_PURCHASE / RENEWAL | subscription tier | upsert active sub (provider=revenuecat), renew credits (per-cycle key), GA4 purchase |
| INITIAL_PURCHASE / NON_RENEWING_PURCHASE | credit pack | add pack credits (key=original_transaction_id), GA4 purchase |
| PRODUCT_CHANGE | subscription tier | upsert tier, no credit change |
| CANCELLATION (cancel_reason=CUSTOMER_SUPPORT) | subscription | downgrade free/cancelled, claw back cycle credits, GA4 refund |
| CANCELLATION (other reason) | subscription | auto-renew off, entitlement active |
| CANCELLATION | credit pack | deduct pack credits, GA4 refund; sub untouched |
| CANCELLATION | unknown product | log only |
| EXPIRATION | subscription tier | downgrade free/expired |
| EXPIRATION | non-subscription | log only |
| UNCANCELLATION | subscription | clear cancelAtPeriodEnd |
| BILLING_ISSUE | any | log (grace period) |
| TRANSFER | any | log (not fully handled) |
| SANDBOX (any type) | any | ignored, 200 |

### Stripe (`stripeWebhook.ts`)

| Event | Side effect |
|-------|-------------|
| checkout.session.completed | upsert sub / add pack credits, GA4 purchase (provider=stripe) |
| customer.subscription.updated | sync tier/status, renew credits on active |
| customer.subscription.deleted | downgrade free/cancelled |
| invoice.payment_succeeded | renew sub credits / add pack credits |
| charge.refunded | proportional credit clawback / cancel sub |

## Analytics flow

Webhook → GA4 Measurement Protocol (`services/ga4MeasurementService.ts`, `client_id`
+ `user_id` from Firebase UID) → GA4 property → daily BigQuery export
(`clanker-prod.analytics_544289823`) → hand-written views in `clanker_analytics`
(`analytics/bq/`). Daily export only; ~24h latency; no streaming.

## BQ dataset/view inventory

- `clanker-prod.analytics_544289823` — GA4-managed daily export (`events_*`).
- `clanker-prod.clanker_analytics.v_purchases` — one row per transaction, `refunded` flag.
- `clanker-prod.clanker_analytics.v_user_journey` — 90-day behavioral funnel.

## Deferred

- **B4 — RC Scheduled Data Exports → GCS → BQ** (`rc_transactions`): payout-level truth
  (store commission, tax, proceeds). Deferred until native revenue or a sale process
  needs payout reconciliation. Until then, webhook-derived GA4 + the Cloud SQL ledger
  are the transaction record; BQ answers gross (not net) revenue.
```

- [ ] **Step 2: Commit + open PR 4**

```bash
git add docs/billing-architecture.md
git commit -m "docs: billing architecture, event matrix, analytics flow, BQ inventory"
git push
gh pr create --base staging --title "BigQuery purchase views + billing architecture docs (B3, B5)" --body "Canonical v_purchases/v_user_journey views and docs/billing-architecture.md. No deploy risk. Per docs/specs/2026-07-24-billing-webhook-and-purchase-analytics.md."
```

---

## Post-deploy verification (from the spec — coordinate with owner)

Run after PRs merge to `staging` and deploy:

1. RC dashboard test event → 200, no side effects (existing `TEST` path).
2. Sandbox purchase from TestFlight → webhook logs `ignoring sandbox event`, no credits (A1).
3. First real native purchase (real money — coordinate): credits in admin dashboard;
   `purchase` with `payment_provider=revenuecat` in GA4 Realtime; row in next day's BQ
   export; `v_purchases` shows it exactly once — **run the B2 double-count check now**
   (`analytics/bq/README.md`); if `in_app_purchase` present, apply the B2 decision.
4. Refund that purchase (Play Store / RC): credits deducted; `refund` event lands;
   `v_purchases.refunded` flips true.
5. Fold in the outstanding Stripe smoke test
   (`docs/handoff/2026-07-20-stripe-smoketest-and-analytics.md` Task A).

## Deferred (not in this plan)

- **B2 auto-collection decision** — resolved empirically during verification step 3.
- **B4 RC Scheduled Data Exports** — owner-deferred until native revenue / sale DD (design retained in `docs/billing-architecture.md`).
- **TRANSFER full entitlement re-pointing** — backlog; the A4 log is the tripwire.

---

## Self-Review (completed by plan author)

**Spec coverage:** A1 (Task 2), A2 (Task 4), A3 (Task 3), A4 (Task 5), A5 client (Task 7), A5 backend (Task 6, already-present guard + regression test per Decision 2), A6 (Task 1), A7 (Task 8), B1 (Tasks 9–11), B2 (deferred to verification, per spec "decision deferred to implementation"), B3 (Task 12), B4 (deferred per Decision 1, documented Task 13), B5 (Task 13). Decision 3 (daily-only) honored — views never reference `events_intraday_*`. Decision 4 (proportional clawback) — Stripe path already proportional (unchanged); RC path deducts full grant floored at zero (Tasks 3/4), matching the spec's RC note.

**Type consistency:** `adjustCredits` dep signature matches `creditService.adjustCredits` (`userId, delta, reason, referenceId?`). `sendPurchaseEvent`/`sendRefundEvent` share `PurchaseEventParams` (decimal `value` OR `valueMinorUnits`, both optional; `paymentProvider` required). `subscriptionProvider` type `'stripe' | 'revenuecat' | null` consistent across `subscriptionService`, `exchangeToken`, `SubscriptionSnapshot`. `resolveGa4TransactionId` used identically in purchase + refund emission.

**Placeholder scan:** Two component tests (Task 7 Step 4, Task 8 Step 1) describe arrange/act/assert without full RN render code because the repo's client test harness/mocking idiom must be read from a sibling test first — the steps name the exact hooks/modules to mock and the exact assertions. Flagged, not hidden.
