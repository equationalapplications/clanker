import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.STRIPE_MONTHLY_20_PRICE_ID = "price_monthly_20";
process.env.STRIPE_MONTHLY_50_PRICE_ID = "price_monthly_50";
process.env.STRIPE_CREDIT_PACK_PRICE_ID = "price_credit_pack";

import {purchasePackageStripeHandler} from "./purchasePackageStripe.js";

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
