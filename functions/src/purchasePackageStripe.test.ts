import assert from "node:assert/strict";
import test, {TestContext} from "node:test";
import {HttpsError} from "firebase-functions/v2/https";
import admin from "firebase-admin";
import Stripe from "stripe";

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
  const adminPrototype = Object.getPrototypeOf(admin);
  const originalAuthDescriptor = Object.getOwnPropertyDescriptor(adminPrototype, "auth");
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

  return {adminPrototype, originalAuthDescriptor, createCheckoutSessionMock};
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
  const {adminPrototype, originalAuthDescriptor, createCheckoutSessionMock} = stubHandlerDeps(
    t,
    "recurring",
    "cs_123",
    "https://checkout.stripe.test/session_123"
  );

  try {
    Object.defineProperty(adminPrototype, "auth", {
      configurable: true,
      value: () => {
        return {
          getUser: async () => ({email: "buyer@example.com"}),
        };
      },
    });

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
  } finally {
    if (originalAuthDescriptor) {
      Object.defineProperty(adminPrototype, "auth", originalAuthDescriptor);
    }
  }
});

test("purchasePackageStripeHandler warns when Stripe price type mismatches local mode expectation", async (t) => {
  const {adminPrototype, originalAuthDescriptor, createCheckoutSessionMock} = stubHandlerDeps(
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
    Object.defineProperty(adminPrototype, "auth", {
      configurable: true,
      value: () => {
        return {
          getUser: async () => ({email: "buyer@example.com"}),
        };
      },
    });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutBuffer += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrBuffer += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    await purchasePackageStripeHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1"},
      },
      data: {
        priceId: "price_monthly_20",
      },
    } as never);

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
    if (originalAuthDescriptor) {
      Object.defineProperty(adminPrototype, "auth", originalAuthDescriptor);
    }
  }
});
