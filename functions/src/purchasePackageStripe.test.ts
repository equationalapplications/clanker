import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

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
