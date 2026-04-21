import assert from "node:assert/strict";
import test from "node:test";

process.env.REVENUECAT_WEBHOOK_SECRET = "rc-secret";

import {parseRevenueCatEvent, revenueCatWebhookHandler} from "./revenueCatWebhook.js";

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

test("revenueCatWebhookHandler keeps paid tier active on cancellation until expiration", async () => {
  const res = createResponseRecorder();
  const upsertCalls: Array<{
    userId: string;
    planTier: string;
    planStatus: string;
    renewalAt: Date | null | undefined;
  }> = [];

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
      upsertSubscription: async (userId, planTier, planStatus, renewalAt) => {
        upsertCalls.push({userId, planTier, planStatus, renewalAt});
      },
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
  });
});

test("revenueCatWebhookHandler normalizes expiration to free tier", async () => {
  const res = createResponseRecorder();
  const upsertCalls: Array<{
    userId: string;
    planTier: string;
    planStatus: string;
  }> = [];

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
      upsertSubscription: async (userId, planTier, planStatus) => {
        upsertCalls.push({userId, planTier, planStatus});
      },
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "free",
    planStatus: "expired",
  });
});

test("revenueCatWebhookHandler does not map RevenueCat transaction ID to stripeSubscriptionId", async () => {
  const res = createResponseRecorder();
  const upsertCalls: Array<{
    userId: string;
    planTier: string;
    planStatus: string;
    renewalAt: Date | null | undefined;
    stripeSubscriptionId: string | null | undefined;
  }> = [];

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
      upsertSubscription: async (
        userId,
        planTier,
        planStatus,
        renewalAt,
        stripeSubscriptionId
      ) => {
        upsertCalls.push({
          userId,
          planTier,
          planStatus,
          renewalAt,
          stripeSubscriptionId,
        });
      },
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].stripeSubscriptionId, undefined);
});

test("revenueCatWebhookHandler bootstraps Cloud SQL user when missing", async () => {
  const res = createResponseRecorder();
  const upsertCalls: Array<{
    userId: string;
    planTier: string;
    planStatus: string;
    renewalAt: Date | null | undefined;
  }> = [];

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
      upsertSubscription: async (userId, planTier, planStatus, renewalAt) => {
        upsertCalls.push({userId, planTier, planStatus, renewalAt});
      },
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-bootstrapped",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
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
      upsertSubscription: async () => undefined,
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    received: false,
    error: "Cloud SQL user not ready",
  });
});
