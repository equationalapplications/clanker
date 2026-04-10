import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
process.env.STRIPE_MONTHLY_20_PRICE_ID = "price_monthly_20";
process.env.STRIPE_MONTHLY_50_PRICE_ID = "price_monthly_50";
process.env.STRIPE_CREDIT_PACK_PRICE_ID = "price_credit_pack";
process.env.SUPABASE_URL = "https://supabase.example.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
} from "./stripeWebhook.js";
import {withAdminAuthAndFetchStubs, withFetchStub} from "./testHelpers.js";

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

test("stripeWebhookHandler returns 500 when STRIPE_SECRET_KEY contains invalid characters", async () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_123\ninvalid";

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

test("getInvoiceLineItemPriceId prefers price id and falls back to legacy plan id", () => {
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

test("stripeWebhookHandler checkout.session.completed upserts subscription via firebase uid fallback", async (t) => {
  const stripe = new Stripe("sk_test_123");
  const checkoutSessionsPrototype = Object.getPrototypeOf(stripe.checkout.sessions);

  const event = {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        customer_details: null,
        customer_email: null,
        client_reference_id: "firebase-uid-fallback",
        subscription: "sub_123",
        customer: "cus_123",
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  } as never);

  t.mock.method(checkoutSessionsPrototype, "listLineItems", async () => ({
    data: [
      {
        price: {id: "price_monthly_20"},
        quantity: 1,
      },
    ],
  }) as never);

  await withAdminAuthAndFetchStubs(
    async () => ({email: "buyer@example.com"}),
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-1"), {status: 200});
      }
      if (url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")) {
        return new Response(JSON.stringify({}), {status: 201});
      }

      throw new Error(`Unexpected fetch call in Stripe webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const res = createResponseRecorder();

      await stripeWebhookHandler(
        {
          method: "POST",
          headers: {
            "stripe-signature": signature,
          },
          rawBody: Buffer.from(payload, "utf8"),
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {received: true});

      const upsertCall = fetchCalls.find((call) =>
        call.url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")
      );
      assert.ok(upsertCall);
      const upsertPayload = JSON.parse(upsertCall.body);
      assert.equal(upsertPayload.user_id, "supabase-user-1");
      assert.equal(upsertPayload.plan_tier, "monthly_20");
      assert.equal(upsertPayload.plan_status, "active");
      assert.equal(upsertPayload.stripe_subscription_id, "sub_123");
      assert.equal(upsertPayload.stripe_customer_id, "cus_123");
    }
  );
});

test("stripeWebhookHandler checkout.session.completed adds credits for credit-pack line items", async (t) => {
  const stripe = new Stripe("sk_test_123");
  const checkoutSessionsPrototype = Object.getPrototypeOf(stripe.checkout.sessions);

  const event = {
    id: "evt_checkout_2",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_credits_1",
        customer_details: {email: "credits@example.com"},
        customer_email: "credits@example.com",
        client_reference_id: null,
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  } as never);

  t.mock.method(checkoutSessionsPrototype, "listLineItems", async () => ({
    data: [
      {
        price: {id: "price_credit_pack"},
        quantity: 2,
      },
    ],
  }) as never);

  await withFetchStub(
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-credits"), {status: 200});
      }
      if (url.endsWith("/rpc/add_user_credits")) {
        return new Response(JSON.stringify({ok: true}), {status: 200});
      }

      throw new Error(`Unexpected fetch call in Stripe webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const res = createResponseRecorder();

      await stripeWebhookHandler(
        {
          method: "POST",
          headers: {
            "stripe-signature": signature,
          },
          rawBody: Buffer.from(payload, "utf8"),
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);
      const rpcCall = fetchCalls.find((call) => call.url.endsWith("/rpc/add_user_credits"));
      assert.ok(rpcCall);
      const creditRpcPayload = JSON.parse(rpcCall.body);
      assert.equal(creditRpcPayload.p_user_id, "supabase-user-credits");
      assert.equal(creditRpcPayload.p_credit_amount, 200);
      assert.equal(creditRpcPayload.p_reference_id, "cs_credits_1");
    }
  );
});

test("stripeWebhookHandler invoice.payment_succeeded adds credits only for one-time invoices", async () => {
  const stripe = new Stripe("sk_test_123");

  const event = {
    id: "evt_invoice_1",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_123",
        customer_email: "invoice@example.com",
        parent: {
          subscription_details: {
            subscription: null,
          },
        },
        lines: {
          data: [
            {
              quantity: 3,
              pricing: {
                price_details: {
                  price: "price_credit_pack",
                },
                type: "price_details",
                unit_amount_decimal: null,
              },
            },
          ],
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  } as never);

  await withFetchStub(
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-invoice"), {status: 200});
      }
      if (url.endsWith("/rpc/add_user_credits")) {
        return new Response(JSON.stringify({ok: true}), {status: 200});
      }

      throw new Error(`Unexpected fetch call in Stripe webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const res = createResponseRecorder();

      await stripeWebhookHandler(
        {
          method: "POST",
          headers: {
            "stripe-signature": signature,
          },
          rawBody: Buffer.from(payload, "utf8"),
        } as never,
        res as never
      );

      assert.equal(res.statusCode, 200);
      const rpcCall = fetchCalls.find((call) => call.url.endsWith("/rpc/add_user_credits"));
      assert.ok(rpcCall);
      const invoiceRpcPayload = JSON.parse(rpcCall.body);
      assert.equal(invoiceRpcPayload.p_credit_amount, 300);
      assert.equal(invoiceRpcPayload.p_reference_id, "in_123");
    }
  );
});

test("stripeWebhookHandler charge.refunded handles credit-pack and subscription refunds", async (t) => {
  const stripe = new Stripe("sk_test_123");
  const invoicesPrototype = Object.getPrototypeOf(stripe.invoices);

  const events = [
    {
      id: "evt_refund_credit",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_credit_1",
          billing_details: {email: "refund@example.com"},
          metadata: {},
          invoice: "in_credit_1",
        },
      },
    },
    {
      id: "evt_refund_sub",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_sub_1",
          billing_details: {email: "refund@example.com"},
          metadata: {},
          invoice: "in_sub_1",
        },
      },
    },
  ];

  t.mock.method(invoicesPrototype, "retrieve", async (invoiceId: string) => {
    if (invoiceId === "in_credit_1") {
      return {
        id: "in_credit_1",
        parent: {
          subscription_details: {
            subscription: null,
          },
        },
        lines: {
          data: [
            {
              quantity: 2,
              pricing: {
                price_details: {
                  price: "price_credit_pack",
                },
                type: "price_details",
                unit_amount_decimal: null,
              },
            },
          ],
        },
      } as never;
    }

    return {
      id: "in_sub_1",
      parent: {
        subscription_details: {
          subscription: "sub_123",
        },
      },
      lines: {
        data: [],
      },
    } as never;
  });

  await withFetchStub(
    async (url) => {
      if (url.endsWith("/rpc/get_user_id_by_email")) {
        return new Response(JSON.stringify("supabase-user-refund"), {status: 200});
      }
      if (url.endsWith("/rpc/update_user_credits")) {
        return new Response(JSON.stringify({ok: true}), {status: 200});
      }
      if (url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")) {
        return new Response(JSON.stringify({}), {status: 201});
      }

      throw new Error(`Unexpected fetch call in Stripe webhook test: ${url}`);
    },
    async (fetchCalls) => {
      const creditPayload = JSON.stringify(events[0]);
      const creditSignature = stripe.webhooks.generateTestHeaderString({
        payload: creditPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET as string,
      } as never);

      const resCredit = createResponseRecorder();
      await stripeWebhookHandler(
        {
          method: "POST",
          headers: {
            "stripe-signature": creditSignature,
          },
          rawBody: Buffer.from(creditPayload, "utf8"),
        } as never,
        resCredit as never
      );

      const subscriptionPayload = JSON.stringify(events[1]);
      const subscriptionSignature = stripe.webhooks.generateTestHeaderString({
        payload: subscriptionPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET as string,
      } as never);

      const resSubscription = createResponseRecorder();
      await stripeWebhookHandler(
        {
          method: "POST",
          headers: {
            "stripe-signature": subscriptionSignature,
          },
          rawBody: Buffer.from(subscriptionPayload, "utf8"),
        } as never,
        resSubscription as never
      );

      assert.equal(resCredit.statusCode, 200);
      assert.equal(resSubscription.statusCode, 200);

      const updateCreditsCall = fetchCalls.find((call) => call.url.endsWith("/rpc/update_user_credits"));
      assert.ok(updateCreditsCall);
      const updateCreditsPayload = JSON.parse(updateCreditsCall.body);
      assert.equal(updateCreditsPayload.p_credit_change, -200);
      assert.equal(updateCreditsPayload.p_reference_id, "ch_credit_1");

      const upsertCall = fetchCalls.find((call) =>
        call.url.includes("/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name")
      );
      assert.ok(upsertCall);
      const upsertPayload = JSON.parse(upsertCall.body);
      assert.equal(upsertPayload.plan_tier, "free");
      assert.equal(upsertPayload.plan_status, "cancelled");
    }
  );
});
