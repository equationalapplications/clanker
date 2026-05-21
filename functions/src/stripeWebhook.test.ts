import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
process.env.STRIPE_MONTHLY_20_PRICE_ID = "price_monthly_20";
process.env.STRIPE_MONTHLY_50_PRICE_ID = "price_monthly_50";
process.env.STRIPE_CREDIT_PACK_PRICE_ID = "price_credit_pack";

import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
  handleInvoicePaymentSucceeded,
} from "./stripeWebhook.js";

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

test("stripeWebhookHandler returns 500 when STRIPE_WEBHOOK_SECRET is missing", async () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  const res = createResponseRecorder();
  try {
    await stripeWebhookHandler(
      {
        method: "POST",
        headers: {
          "stripe-signature": "t=1,v1=sig",
        },
        rawBody: Buffer.from("{}", "utf8"),
      } as never,
      res as never
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.body, "Webhook secret not configured");
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

test("stripeWebhookHandler returns 500 when STRIPE_SECRET_KEY is missing", async () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;

  const res = createResponseRecorder();
  try {
    await stripeWebhookHandler(
      {
        method: "POST",
        headers: {
          "stripe-signature": "t=1,v1=sig",
        },
        rawBody: Buffer.from("{}", "utf8"),
      } as never,
      res as never
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.body, "Stripe configuration error");
  } finally {
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
  }
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

test("getInvoiceLineItemPriceId reads price details ids", () => {
  const priceItem = {
    pricing: {
      price_details: {
        price: {id: "price_credit_pack"},
      },
      type: "price_details",
      unit_amount_decimal: null,
    },
  } as unknown as Stripe.InvoiceLineItem;
  const planOnlyItem = {
    pricing: {
      price_details: {
        price: "price_credit_pack_legacy",
      },
      type: "price_details",
      unit_amount_decimal: null,
    },
  } as unknown as Stripe.InvoiceLineItem;

  assert.equal(getInvoiceLineItemPriceId(priceItem), "price_credit_pack");
  assert.equal(getInvoiceLineItemPriceId(planOnlyItem), "price_credit_pack_legacy");
});

test("getCreditPackQuantityFromInvoice counts only configured credit-pack lines", () => {
  const invoice = {
    lines: {
      data: [
        {
          quantity: 2,
          pricing: {
            price_details: {price: "price_credit_pack"},
            type: "price_details",
            unit_amount_decimal: null,
          },
        },
        {
          quantity: null,
          pricing: {
            price_details: {price: {id: "price_credit_pack"}},
            type: "price_details",
            unit_amount_decimal: null,
          },
        },
        {
          quantity: 5,
          pricing: {
            price_details: {price: "price_other"},
            type: "price_details",
            unit_amount_decimal: null,
          },
        },
      ] as unknown as Stripe.InvoiceLineItem[],
    },
  } as unknown as Stripe.Invoice;

  const quantity = getCreditPackQuantityFromInvoice(invoice, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  });

  assert.equal(quantity, 3);
});

test("handleInvoicePaymentSucceeded renews subscription credits only on subscription_cycle invoices", async () => {
  let renewalArgs: unknown = null;

  const invoice = {
    id: "inv_123",
    customer_email: "person@example.com",
    billing_reason: "subscription_cycle",
    parent: {
      subscription_details: { subscription: "sub_123" },
    },
    lines: {
      data: [
        {
          period: { end: 1710000000 },
          pricing: {
            price_details: { price: "price_monthly_20" },
            type: "price_details",
            unit_amount_decimal: null,
          },
          quantity: 1,
        },
      ],
    },
  } as unknown as Stripe.Invoice;

  await handleInvoicePaymentSucceeded({} as Stripe, invoice, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async (userId: string, amount: number, expiresAt: Date, referenceId: string) => {
      renewalArgs = {userId, amount, expiresAt, referenceId};
      return true;
    },
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.deepEqual(renewalArgs, {
    userId: "user-1",
    amount: 300,
    expiresAt: new Date(1710000000 * 1000),
    referenceId: "sub_sub_123_1710000000",
  });
});
