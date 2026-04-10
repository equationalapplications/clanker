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
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutBuffer += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrBuffer += String(chunk);
      return true;
    }) as typeof process.stderr.write;

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
    assert.match(
      `${stdoutBuffer}\n${stderrBuffer}`,
      /Stripe price type differs from configured checkout mode/
    );
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
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
