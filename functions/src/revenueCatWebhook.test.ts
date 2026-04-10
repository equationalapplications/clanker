import assert from "node:assert/strict";
import test from "node:test";
import {withAdminAuthAndFetchStubs} from "./testHelpers.js";

process.env.REVENUECAT_WEBHOOK_SECRET = "rc-secret";
process.env.SUPABASE_URL = "https://supabase.example.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

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

test("parseRevenueCatEvent rejects invalid optional fields", () => {
  assert.throws(
    () => parseRevenueCatEvent({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "uid_123",
        product_id: "prod_1",
        expiration_at_ms: Number.NaN,
      },
    }),
    /Invalid event\.expiration_at_ms/
  );

  assert.throws(
    () => parseRevenueCatEvent({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "uid_123",
        product_id: "prod_1",
        original_transaction_id: 123,
      },
    }),
    /Invalid event\.original_transaction_id/
  );
});

test("parseRevenueCatEvent only returns allowed fields", () => {
  const parsed = parseRevenueCatEvent({
    event: {
      type: " INITIAL_PURCHASE ",
      app_user_id: " uid_123 ",
      product_id: " monthly_20_subscription ",
      expiration_at_ms: 1_717_780_800_000,
      original_transaction_id: " tx_123 ",
      unexpected: "should-not-be-copied",
    },
  });

  assert.deepEqual(parsed, {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "uid_123",
      product_id: "monthly_20_subscription",
      expiration_at_ms: 1_717_780_800_000,
      original_transaction_id: "tx_123",
    },
  });
});

test("revenueCatWebhookHandler upserts active subscription for INITIAL_PURCHASE", async () => {
  const expirationAtMs = 1_717_780_800_000;

  await withAdminAuthAndFetchStubs(
    async () => ({email: "buyer@example.com"}),
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-rc-sub"), {status: 200});
      }
      if (url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")) {
        return new Response(JSON.stringify({}), {status: 201});
      }

      throw new Error(`Unexpected fetch call in RevenueCat webhook test: ${url}`);
    },
    async (fetchCalls) => {
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
              app_user_id: "firebase-uid-rc-sub",
              product_id: "monthly_20_subscription",
              expiration_at_ms: expirationAtMs,
              original_transaction_id: "tx_123",
            },
          },
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {received: true});

      const upsertCall = fetchCalls.find((call) =>
        call.url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")
      );
      assert.ok(upsertCall);

      const payload = JSON.parse(upsertCall.body);
      assert.equal(payload.user_id, "supabase-user-rc-sub");
      assert.equal(payload.plan_tier, "monthly_20");
      assert.equal(payload.plan_status, "active");
      assert.equal(payload.billing_provider_id, "tx_123");
      assert.equal(payload.plan_renewal_at, new Date(expirationAtMs).toISOString());
    }
  );
});

test("revenueCatWebhookHandler adds credits for NON_RENEWING_PURCHASE", async () => {
  await withAdminAuthAndFetchStubs(
    async () => ({email: "buyer@example.com"}),
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-rc-credit"), {status: 200});
      }
      if (url.endsWith("/rpc/add_user_credits")) {
        return new Response(JSON.stringify({ok: true}), {status: 200});
      }

      throw new Error(`Unexpected fetch call in RevenueCat webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const res = createResponseRecorder();
      await revenueCatWebhookHandler(
        {
          method: "POST",
          headers: {
            authorization: "Bearer rc-secret",
          },
          body: {
            event: {
              type: "NON_RENEWING_PURCHASE",
              app_user_id: "firebase-uid-rc-credit",
              product_id: "credit_pack_100",
              original_transaction_id: "tx_credit_1",
            },
          },
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);

      const rpcCall = fetchCalls.find((call) => call.url.endsWith("/rpc/add_user_credits"));
      assert.ok(rpcCall);
      const payload = JSON.parse(rpcCall.body);
      assert.equal(payload.p_user_id, "supabase-user-rc-credit");
      assert.equal(payload.p_credit_amount, 100);
      assert.equal(payload.p_reference_id, "tx_credit_1");
    }
  );
});

test("revenueCatWebhookHandler marks subscriptions cancelled and expired", async () => {
  await withAdminAuthAndFetchStubs(
    async () => ({email: "buyer@example.com"}),
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-rc-status"), {status: 200});
      }
      if (url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")) {
        return new Response(JSON.stringify({}), {status: 201});
      }

      throw new Error(`Unexpected fetch call in RevenueCat webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const cancelRes = createResponseRecorder();
      await revenueCatWebhookHandler(
        {
          method: "POST",
          headers: {
            authorization: "Bearer rc-secret",
          },
          body: {
            event: {
              type: "CANCELLATION",
              app_user_id: "firebase-uid-rc-status",
              product_id: "monthly_50_subscription",
            },
          },
        } as never,
        cancelRes as never
      );

      const expirationRes = createResponseRecorder();
      await revenueCatWebhookHandler(
        {
          method: "POST",
          headers: {
            authorization: "Bearer rc-secret",
          },
          body: {
            event: {
              type: "EXPIRATION",
              app_user_id: "firebase-uid-rc-status",
              product_id: "monthly_20_subscription",
            },
          },
        } as never,
        expirationRes as never
      );

      assert.equal(cancelRes.statusCode, 200);
      assert.equal(expirationRes.statusCode, 200);

      const upsertCalls = fetchCalls.filter((call) =>
        call.url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")
      );
      assert.equal(upsertCalls.length, 2);
      const cancelPayload = JSON.parse(upsertCalls[0]?.body ?? "{}");
      const expiryPayload = JSON.parse(upsertCalls[1]?.body ?? "{}");
      assert.equal(cancelPayload.plan_status, "cancelled");
      assert.equal(cancelPayload.plan_tier, "monthly_50");
      assert.equal(expiryPayload.plan_status, "expired");
      assert.equal(expiryPayload.plan_tier, "monthly_20");
    }
  );
});

test("revenueCatWebhookHandler returns 200 when firebase user is not found", async () => {
  await withAdminAuthAndFetchStubs(
    async () => {
      throw {code: "auth/user-not-found"};
    },
    async () => {
      throw new Error("Fetch should not be called when user is unknown");
    },
    async () => {
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
              app_user_id: "firebase-uid-missing",
              product_id: "monthly_20_subscription",
            },
          },
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {received: true});
    }
  );
});
