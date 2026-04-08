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
