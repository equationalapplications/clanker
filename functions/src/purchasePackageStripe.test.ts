import assert from "node:assert/strict";
import test, {TestContext} from "node:test";
import {HttpsError} from "firebase-functions/v2/https";
import Stripe from "stripe";
import {withAdminAuthStub} from "./testHelpers.js";

process.env.STRIPE_MONTHLY_20_PRICE_ID = "price_monthly_20";
process.env.STRIPE_MONTHLY_50_PRICE_ID = "price_monthly_50";
process.env.STRIPE_CREDIT_PACK_PRICE_ID = "price_credit_pack";
process.env.STRIPE_SUCCESS_URL = "https://staging.clanker-ai.com/checkout/success";
process.env.STRIPE_CANCEL_URL = "https://staging.clanker-ai.com/checkout/cancel";
process.env.STRIPE_SECRET_KEY = "sk_test_123";

import {
  purchasePackageStripeHandler,
  resolveCheckoutModeFromPriceType,
  setPurchasePackageStripeLoggerForTests,
} from "./purchasePackageStripe.js";

function stubHandlerDeps(
  t: TestContext,
  priceType: Stripe.Price.Type,
  sessionId: string,
  sessionUrl: string
) {
  const stripe = new Stripe("sk_test_123");
  const customersPrototype = Object.getPrototypeOf(stripe.customers);
  const pricesPrototype = Object.getPrototypeOf(stripe.prices);
  const checkoutSessionsPrototype = Object.getPrototypeOf(stripe.checkout.sessions);

  // Stripe resource methods are patched at the shared prototype level.
  // node:test restores these stubs after each test via t.mock.
  t.mock.method(customersPrototype, "list", async () => ({
    data: [{id: "cus_123"}],
  }) as never);
  t.mock.method(pricesPrototype, "retrieve", async () => ({
    id: "price_monthly_20",
    type: priceType,
  }) as never);
  const createCheckoutSessionMock = t.mock.method(
    checkoutSessionsPrototype,
    "create",
    async () => ({id: sessionId, url: sessionUrl}) as never
  );

  return {createCheckoutSessionMock};
}

test("resolveCheckoutModeFromPriceType maps recurring prices to subscription mode", () => {
  assert.equal(resolveCheckoutModeFromPriceType("recurring"), "subscription");
});

test("resolveCheckoutModeFromPriceType maps one-time prices to payment mode", () => {
  assert.equal(resolveCheckoutModeFromPriceType("one_time"), "payment");
});

test("purchasePackageStripeHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => purchasePackageStripeHandler({auth: null} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("purchasePackageStripeHandler validates unknown priceId", async () => {
  await assert.rejects(
    async () =>
      purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1"},
        },
        data: {
          priceId: "price_unknown",
        },
      } as never),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Unknown priceId")
  );
});

test("purchasePackageStripeHandler validates attemptId when provided", async () => {
  await assert.rejects(
    async () =>
      purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1"},
        },
        data: {
          priceId: "price_monthly_20",
          attemptId: 123,
        },
      } as never),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("attemptId")
  );
});

test("purchasePackageStripeHandler rejects oversized attemptId", async () => {
  await assert.rejects(
    async () =>
      purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1"},
        },
        data: {
          priceId: "price_monthly_20",
          attemptId: "a".repeat(129),
        },
      } as never),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("at most 128 characters")
  );
});

test("purchasePackageStripeHandler fails fast when Stripe price config is missing", async () => {
  const originalMonthly20 = process.env.STRIPE_MONTHLY_20_PRICE_ID;
  delete process.env.STRIPE_MONTHLY_20_PRICE_ID;

  try {
    await assert.rejects(
      async () =>
        purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1"},
          },
          data: {
            priceId: "price_monthly_50",
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("STRIPE_MONTHLY_20_PRICE_ID")
    );
  } finally {
    process.env.STRIPE_MONTHLY_20_PRICE_ID = originalMonthly20;
  }
});

test("purchasePackageStripeHandler fails fast when Stripe checkout URL config is missing", async () => {
  const originalCancelUrl = process.env.STRIPE_CANCEL_URL;
  delete process.env.STRIPE_CANCEL_URL;

  try {
    await assert.rejects(
      async () =>
        purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1"},
          },
          data: {
            priceId: "price_monthly_50",
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("STRIPE_CANCEL_URL")
    );
  } finally {
    process.env.STRIPE_CANCEL_URL = originalCancelUrl;
  }
});

test("purchasePackageStripeHandler fails fast when Stripe secret key has invalid characters", async () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_123\ninvalid";

  try {
    await assert.rejects(
      async () =>
        purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1"},
          },
          data: {
            priceId: "price_monthly_50",
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("STRIPE_SECRET_KEY")
    );
  } finally {
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
  }
});

test("purchasePackageStripeHandler fails fast when Stripe secret key is missing", async () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;

  try {
    await assert.rejects(
      async () =>
        purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1"},
          },
          data: {
            priceId: "price_monthly_50",
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("STRIPE_SECRET_KEY")
    );
  } finally {
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
  }
});

test("purchasePackageStripeHandler uses subscription mode for recurring Stripe prices", async (t) => {
  const {createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "recurring",
    "cs_123",
    "https://checkout.stripe.test/session_123"
  );

  await withAdminAuthStub(
    async () => ({email: "buyer@example.com"}),
    async () => {
      const result = await purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1"},
        },
        data: {
          priceId: "price_monthly_20",
        },
      } as never);

      assert.equal(result, "https://checkout.stripe.test/session_123");
      assert.equal(createCheckoutSessionMock.mock.calls.length, 1);
      assert.equal(
        (createCheckoutSessionMock.mock.calls[0].arguments[0] as {mode: string}).mode,
        "subscription"
      );
    }
  );
});

test("purchasePackageStripeHandler warns when Stripe price type mismatches local mode expectation", async (t) => {
  const {createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "one_time",
    "cs_456",
    "https://checkout.stripe.test/session_456"
  );
  const warnCalls: Array<{message: string; payload: Record<string, unknown> | undefined}> = [];

  try {
    setPurchasePackageStripeLoggerForTests({
      error: () => undefined,
      info: () => undefined,
      warn: (message: string, payload?: Record<string, unknown>) => {
        warnCalls.push({message, payload});
      },
    });

    await withAdminAuthStub(
      async () => ({email: "buyer@example.com"}),
      async () => {
        await purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1"},
          },
          data: {
            priceId: "price_monthly_20",
          },
        } as never);
      }
    );

    assert.equal(createCheckoutSessionMock.mock.calls.length, 1);
    assert.equal(
      (createCheckoutSessionMock.mock.calls[0].arguments[0] as {mode: string}).mode,
      "payment"
    );
    assert.equal(warnCalls.length, 1);
    assert.equal(warnCalls[0]?.message, "Stripe price type differs from configured checkout mode");
    assert.deepEqual(warnCalls[0]?.payload, {
      priceId: "price_monthly_20",
      priceType: "one_time",
      configuredMode: "subscription",
      resolvedMode: "payment",
    });
  } finally {
    setPurchasePackageStripeLoggerForTests();
  }
});

test("purchasePackageStripeHandler creates a customer when none exists", async (t) => {
  const stripe = new Stripe("sk_test_123");
  const customersPrototype = Object.getPrototypeOf(stripe.customers);
  const pricesPrototype = Object.getPrototypeOf(stripe.prices);
  const checkoutSessionsPrototype = Object.getPrototypeOf(stripe.checkout.sessions);

  const listCustomersMock = t.mock.method(customersPrototype, "list", async () => ({
    data: [],
  }) as never);
  const createCustomerMock = t.mock.method(customersPrototype, "create", async () => ({
    id: "cus_new_123",
  }) as never);
  t.mock.method(pricesPrototype, "retrieve", async () => ({
    id: "price_monthly_20",
    type: "recurring",
  }) as never);
  const createCheckoutSessionMock = t.mock.method(
    checkoutSessionsPrototype,
    "create",
    async () => ({id: "cs_new_123", url: "https://checkout.stripe.test/new_123"}) as never
  );

  await withAdminAuthStub(
    async () => ({email: "newbuyer@example.com"}),
    async () => {
      const result = await purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-2",
          token: {uid: "firebase-uid-2"},
        },
        data: {
          priceId: "price_monthly_20",
        },
      } as never);

      assert.equal(result, "https://checkout.stripe.test/new_123");
      assert.equal(listCustomersMock.mock.calls.length, 1);
      assert.equal(createCustomerMock.mock.calls.length, 1);
      assert.equal(createCheckoutSessionMock.mock.calls.length, 1);
      assert.equal(
        (createCheckoutSessionMock.mock.calls[0].arguments[0] as {customer: string}).customer,
        "cus_new_123"
      );
    }
  );
});

test("purchasePackageStripeHandler rejects users without an email address", async (t) => {
  const stripe = new Stripe("sk_test_123");
  const customersPrototype = Object.getPrototypeOf(stripe.customers);

  const listCustomersMock = t.mock.method(customersPrototype, "list", async () => ({
    data: [{id: "cus_123"}],
  }) as never);

  await withAdminAuthStub(
    async () => ({email: undefined}),
    async () => {
      await assert.rejects(
        async () =>
          purchasePackageStripeHandler({
            auth: {
              uid: "firebase-uid-3",
              token: {uid: "firebase-uid-3"},
            },
            data: {
              priceId: "price_monthly_20",
            },
          } as never),
        (err: unknown) =>
          err instanceof HttpsError &&
          err.code === "failed-precondition" &&
          err.message.includes("no email address")
      );

      assert.equal(listCustomersMock.mock.calls.length, 0);
    }
  );
});

test("purchasePackageStripeHandler fails when Stripe checkout session has no URL", async (t) => {
  stubHandlerDeps(
    t,
    "recurring",
    "cs_no_url",
    ""
  );

  await withAdminAuthStub(
    async () => ({email: "buyer@example.com"}),
    async () => {
      await assert.rejects(
        async () =>
          purchasePackageStripeHandler({
            auth: {
              uid: "firebase-uid-4",
              token: {uid: "firebase-uid-4"},
            },
            data: {
              priceId: "price_monthly_20",
            },
          } as never),
        (err: unknown) =>
          err instanceof HttpsError &&
          err.code === "internal" &&
          err.message.includes("checkout URL")
      );
    }
  );
});

test("purchasePackageStripeHandler sends metadata and client_reference_id to checkout session", async (t) => {
  const {createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "recurring",
    "cs_meta",
    "https://checkout.stripe.test/meta"
  );

  await withAdminAuthStub(
    async () => ({email: "buyer@example.com"}),
    async () => {
      await purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-meta",
          token: {uid: "firebase-uid-meta"},
        },
        data: {
          priceId: "price_monthly_20",
        },
      } as never);

      const payload = createCheckoutSessionMock.mock.calls[0].arguments[0] as {
        client_reference_id: string;
        metadata: {firebase_uid: string; email: string};
      };

      assert.equal(payload.client_reference_id, "firebase-uid-meta");
      assert.equal(payload.metadata.firebase_uid, "firebase-uid-meta");
      assert.equal(payload.metadata.email, "buyer@example.com");
    }
  );
});

test("purchasePackageStripeHandler appends attemptId to checkout return URLs and metadata", async (t) => {
  const originalSuccessUrl = process.env.STRIPE_SUCCESS_URL;
  const originalCancelUrl = process.env.STRIPE_CANCEL_URL;
  process.env.STRIPE_SUCCESS_URL = "https://staging.clanker-ai.com/checkout/success?source=web";
  process.env.STRIPE_CANCEL_URL = "https://staging.clanker-ai.com/checkout/cancel?source=web";

  const {createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "recurring",
    "cs_attempt",
    "https://checkout.stripe.test/attempt"
  );

  try {
    await withAdminAuthStub(
      async () => ({email: "buyer@example.com"}),
      async () => {
        await purchasePackageStripeHandler({
          auth: {
            uid: "firebase-uid-attempt",
            token: {uid: "firebase-uid-attempt"},
          },
          data: {
            priceId: "price_monthly_20",
            attemptId: "attempt_123",
          },
        } as never);
      }
    );

    const payload = createCheckoutSessionMock.mock.calls[0].arguments[0] as {
      success_url: string;
      cancel_url: string;
      metadata: {firebase_uid: string; email: string; attemptId?: string};
    };

    const successUrl = new URL(payload.success_url);
    const cancelUrl = new URL(payload.cancel_url);

    assert.equal(successUrl.searchParams.get("source"), "web");
    assert.equal(cancelUrl.searchParams.get("source"), "web");
    assert.equal(successUrl.searchParams.get("attemptId"), "attempt_123");
    assert.equal(cancelUrl.searchParams.get("attemptId"), "attempt_123");
    assert.equal(payload.metadata.attemptId, "attempt_123");
  } finally {
    process.env.STRIPE_SUCCESS_URL = originalSuccessUrl;
    process.env.STRIPE_CANCEL_URL = originalCancelUrl;
  }
});

test("purchasePackageStripeHandler keeps UUID-like attemptId accepted and propagated", async (t) => {
  const {createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "recurring",
    "cs_uuid_attempt",
    "https://checkout.stripe.test/uuid-attempt"
  );

  const attemptId = "550e8400-e29b-41d4-a716-446655440000";

  await withAdminAuthStub(
    async () => ({email: "buyer@example.com"}),
    async () => {
      await purchasePackageStripeHandler({
        auth: {
          uid: "firebase-uid-uuid-attempt",
          token: {uid: "firebase-uid-uuid-attempt"},
        },
        data: {
          priceId: "price_monthly_20",
          attemptId,
        },
      } as never);
    }
  );

  const payload = createCheckoutSessionMock.mock.calls[0].arguments[0] as {
    success_url: string;
    cancel_url: string;
    metadata: {firebase_uid: string; email: string; attemptId?: string};
  };

  const successUrl = new URL(payload.success_url);
  const cancelUrl = new URL(payload.cancel_url);

  assert.equal(successUrl.searchParams.get("attemptId"), attemptId);
  assert.equal(cancelUrl.searchParams.get("attemptId"), attemptId);
  assert.equal(payload.metadata.attemptId, attemptId);
});
