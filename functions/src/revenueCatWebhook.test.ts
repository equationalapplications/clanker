import assert from "node:assert/strict";
import test from "node:test";

process.env.REVENUECAT_WEBHOOK_SECRET = "rc-secret";

import {parseRevenueCatEvent, revenueCatWebhookHandler, type RevenueCatUpsertParams} from "./revenueCatWebhook.js";

type ResponseRecorder = {
  statusCode: number;
  body: unknown;
  status: (code: number) => ResponseRecorder;
  send: (value: unknown) => ResponseRecorder;
  json: (value: unknown) => ResponseRecorder;
};

function createResponseRecorder(): ResponseRecorder {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(value: unknown) {
      this.body = value;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    },
  };
}

test("revenueCatWebhookHandler only accepts POST", async () => {
  const res = createResponseRecorder();
  await revenueCatWebhookHandler({method: "GET", headers: {}} as never, res as never);

  assert.equal(res.statusCode, 405);
  assert.equal(res.body, "Method Not Allowed");
});

test("revenueCatWebhookHandler enforces Authorization header", async () => {
  const res = createResponseRecorder();
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-secret",
      },
      body: {event: {type: "INITIAL_PURCHASE"}},
    } as never,
    res as never
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body, "Unauthorized");
});

test("revenueCatWebhookHandler validates payload shape", async () => {
  const res = createResponseRecorder();
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {},
    } as never,
    res as never
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body, "Invalid payload");
});

test("revenueCatWebhookHandler returns 200 for TEST event", async () => {
  const res = createResponseRecorder();
  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "TEST",
          app_user_id: "uid_test",
          product_id: "test_product",
        },
      },
    } as never,
    res as never
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {received: true});
});

test("revenueCatWebhookHandler ignores SANDBOX events with 200 and no side effects", async () => {
  const res = createResponseRecorder();
  let findCalls = 0;
  let addCalls = 0;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {authorization: "Bearer rc-secret"},
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
      findUserByFirebaseUid: async () => {
        findCalls += 1;
        return {id: "cloud-user-1"};
      },
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {
        addCalls += 1;
      },
      adjustCredits: async () => undefined,
    } as never
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {received: true, ignored: "sandbox"});
  assert.equal(findCalls, 0);
  assert.equal(addCalls, 0);
});

test("parseRevenueCatEvent accepts minimal valid payload", () => {
  const parsed = parseRevenueCatEvent({
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "uid_123",
      product_id: "monthly_20_subscription",
    },
  });

  assert.deepEqual(parsed, {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "uid_123",
      product_id: "monthly_20_subscription",
    },
  });
});

test("parseRevenueCatEvent accepts x-www-form-urlencoded payload", () => {
  const encoded = new URLSearchParams({
    api_version: "1.0",
    event: JSON.stringify({
      type: "TEST",
      app_user_id: "uid_123",
      product_id: "test_product",
    }),
  }).toString();

  const parsed = parseRevenueCatEvent(encoded);
  assert.deepEqual(parsed, {
    event: {
      type: "TEST",
      app_user_id: "uid_123",
      product_id: "test_product",
    },
  });
});

test("parseRevenueCatEvent rejects invalid required fields", () => {
  assert.throws(
    () => parseRevenueCatEvent({event: {app_user_id: "uid_123", product_id: "prod_1"}}),
    /Missing event\.type/
  );

  assert.throws(
    () => parseRevenueCatEvent({event: {type: "INITIAL_PURCHASE", app_user_id: "", product_id: "prod_1"}}),
    /Missing or invalid event\.app_user_id/
  );

  assert.throws(
    () => parseRevenueCatEvent({event: {type: "INITIAL_PURCHASE", app_user_id: "uid_123", product_id: ""}}),
    /Missing or invalid event\.product_id/
  );
});

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
    event: {type: "RENEWAL", app_user_id: "uid_1", product_id: "monthly_20_subscription"},
  });
  assert.equal(parsed.event.environment, undefined);
  assert.equal(parsed.event.price_in_purchased_currency, undefined);
});

test("parseRevenueCatEvent rejects a wrong-typed price", () => {
  assert.throws(() =>
    parseRevenueCatEvent({
      event: {type: "RENEWAL", app_user_id: "uid_1", product_id: "monthly_20_subscription", price: "free"},
    })
  );
});

test("revenueCatWebhookHandler does not renew credits on PRODUCT_CHANGE events", async () => {
  const res = createResponseRecorder();
  let renewCalls = 0;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "PRODUCT_CHANGE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_123",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => {
        renewCalls += 1;
        return true;
      },
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(renewCalls, 0);
});

test("revenueCatWebhookHandler keeps paid tier active on cancellation until expiration", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "CANCELLATION",
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
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
    subscriptionProvider: "revenuecat",
    cancelAtPeriodEnd: true,
  });
});

test("revenueCatWebhookHandler normalizes expiration to free tier", async () => {
  const res = createResponseRecorder();
  const upsertCalls: Array<Pick<RevenueCatUpsertParams, 'userId' | 'planTier' | 'planStatus' | 'subscriptionProvider' | 'cancelAtPeriodEnd'>> = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "EXPIRATION",
          app_user_id: "uid_123",
          product_id: "monthly_50_subscription",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "free",
    planStatus: "expired",
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  });
});

test("revenueCatWebhookHandler tags new subscriptions with the revenuecat provider", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_123",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params: RevenueCatUpsertParams) => { upsertCalls.push(params); },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls[0]?.subscriptionProvider, "revenuecat");
});

test("revenueCatWebhookHandler bootstraps Cloud SQL user when missing", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => null,
      getOrCreateUserByFirebaseUid: async () => ({id: "cloud-user-bootstrapped"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-bootstrapped",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
    subscriptionProvider: "revenuecat",
    cancelAtPeriodEnd: false,
  });
});

test("revenueCatWebhookHandler maps Android base-plan-suffixed subscription IDs", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription:monthly-usd-20",
          expiration_at_ms: Date.UTC(2026, 4, 20),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
    subscriptionProvider: "revenuecat",
    cancelAtPeriodEnd: false,
  });
});

test("revenueCatWebhookHandler maps cancellation for Android base-plan-suffixed subscription IDs", async () => {
  const res = createResponseRecorder();
  const upsertCalls: RevenueCatUpsertParams[] = [];

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "CANCELLATION",
          app_user_id: "uid_123",
          product_id: "monthly_50_subscription:monthly-usd-50",
          expiration_at_ms: Date.UTC(2026, 5, 1),
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "monthly_50",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 5, 1)),
    subscriptionProvider: "revenuecat",
    cancelAtPeriodEnd: true,
  });
});

test("revenueCatWebhookHandler returns retryable status when Cloud SQL user is unavailable", async () => {
  const res = createResponseRecorder();

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => null,
      getOrCreateUserByFirebaseUid: async () => null,
      getSubscription: async () => null,
      upsertSubscription: async () => undefined,
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    received: false,
    error: "Cloud SQL user not ready",
  });
});

test("revenueCatWebhookHandler grants credits and warns on billing_provider_collision when an active Stripe subscription already exists", async () => {
  const res = createResponseRecorder();
  let upsertCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_123",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => ({
        planTier: "monthly_20",
        planStatus: "active",
        subscriptionProvider: "stripe",
      }),
      upsertSubscription: async () => { upsertCalled = true; },
      renewSubscriptionCredits: async () => true,
      addCredits: async () => undefined,
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalled, true);
});

test("revenueCatWebhookHandler rejects a credit-pack event missing original_transaction_id so RevenueCat retries", async () => {
  const res = createResponseRecorder();
  let addCreditsCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "credit_pack_100",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => { addCreditsCalled = true; },
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 503);
  assert.equal(addCreditsCalled, false);
});

test("revenueCatWebhookHandler rejects a NON_RENEWING_PURCHASE credit-pack event missing original_transaction_id", async () => {
  const res = createResponseRecorder();
  let addCreditsCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          type: "NON_RENEWING_PURCHASE",
          app_user_id: "uid_123",
          product_id: "credit_100",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => { addCreditsCalled = true; },
      adjustCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 503);
  assert.equal(addCreditsCalled, false);
});

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
  assert.equal(adjustCalls[0].referenceId, "rc_sub_txn_1779235200000_refund"); // Date.UTC(2026, 4, 20)
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
