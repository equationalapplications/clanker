import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";

import {mapStripeSubscriptionStatus, stripeWebhookHandler} from "./stripeWebhook.js";

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

test("stripeWebhookHandler only accepts POST", async () => {
  const res = createResponseRecorder();
  await stripeWebhookHandler({method: "GET", headers: {}} as never, res as never);

  assert.equal(res.statusCode, 405);
  assert.equal(res.body, "Method Not Allowed");
});

test("stripeWebhookHandler validates signature header", async () => {
  const res = createResponseRecorder();

  await stripeWebhookHandler(
    {
      method: "POST",
      headers: {},
      rawBody: Buffer.from("{}", "utf8"),
    } as never,
    res as never
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body, "Missing or invalid Stripe signature header");
});

test("mapStripeSubscriptionStatus maps active-like statuses to active", () => {
  const statuses: Stripe.Subscription.Status[] = [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
  ];

  for (const status of statuses) {
    assert.equal(mapStripeSubscriptionStatus(status), "active");
  }
});

test("mapStripeSubscriptionStatus maps canceled to cancelled", () => {
  assert.equal(mapStripeSubscriptionStatus("canceled"), "cancelled");
});

test("mapStripeSubscriptionStatus maps expired-like statuses to expired", () => {
  assert.equal(mapStripeSubscriptionStatus("incomplete_expired"), "expired");
  assert.equal(mapStripeSubscriptionStatus("paused"), "expired");
});
