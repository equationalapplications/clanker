import test from "node:test";
import assert from "node:assert/strict";
import { buildClientId, sendPurchaseEvent, sendRefundEvent } from "./ga4MeasurementService.js";

test("buildClientId is deterministic for the same uid", () => {
  const a = buildClientId("uid-123");
  const b = buildClientId("uid-123");
  assert.equal(a, b);
});

test("buildClientId differs for different uids", () => {
  const a = buildClientId("uid-123");
  const b = buildClientId("uid-456");
  assert.notEqual(a, b);
});

test("sendPurchaseEvent posts a well-formed GA4 MP purchase event", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_abc",
        valueMinorUnits: 1000,
        currency: "usd",
        paymentProvider: "stripe",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://www.google-analytics.com/mp/collect");
  assert.equal(url.searchParams.get("measurement_id"), "G-TEST123");
  assert.equal(url.searchParams.get("api_secret"), "test-secret");

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.client_id, buildClientId("uid-123"));
  assert.equal(body.user_id, "uid-123");
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].name, "purchase");
  assert.equal(body.events[0].params.transaction_id, "cs_test_abc");
  assert.equal(body.events[0].params.value, 10);
  assert.equal(body.events[0].params.currency, "usd");
  assert.equal(body.events[0].params.payment_provider, "stripe");
});

test("sendPurchaseEvent converts a zero-decimal currency (JPY) without dividing by 100", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_jpy",
        valueMinorUnits: 1500,
        currency: "jpy",
        paymentProvider: "stripe",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.events[0].params.value, 1500);
  assert.equal(body.events[0].params.currency, "jpy");
});

test("sendPurchaseEvent converts a three-decimal currency (KWD) by dividing by 1000", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_kwd",
        valueMinorUnits: 1500,
        currency: "kwd",
        paymentProvider: "stripe",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.events[0].params.value, 1.5);
  assert.equal(body.events[0].params.currency, "kwd");
});

test("sendPurchaseEvent converts UGX using the two-decimal Stripe-compatible path", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_ugx",
        valueMinorUnits: 1000,
        currency: "ugx",
        paymentProvider: "stripe",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }

  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.events[0].params.value, 10);
  assert.equal(body.events[0].params.currency, "ugx");
});

test("sendPurchaseEvent swallows fetch failures without throwing", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";

  const fetchImpl = async () => {
    throw new Error("network down");
  };

  try {
    await assert.doesNotReject(
      sendPurchaseEvent(
        {
          firebaseUid: "uid-123",
          transactionId: "cs_test_abc",
          valueMinorUnits: 1000,
          currency: "usd",
          paymentProvider: "stripe",
        },
        fetchImpl as typeof fetch
      )
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }
});

test("sendPurchaseEvent skips the request when secrets are not configured", async () => {
  const original = { measurementId: process.env.GA4_MEASUREMENT_ID, apiSecret: process.env.GA4_MP_API_SECRET };
  delete process.env.GA4_MEASUREMENT_ID;
  delete process.env.GA4_MP_API_SECRET;

  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  try {
    await sendPurchaseEvent(
      {
        firebaseUid: "uid-123",
        transactionId: "cs_test_abc",
        valueMinorUnits: 1000,
        currency: "usd",
        paymentProvider: "stripe",
      },
      fetchImpl as typeof fetch
    );
  } finally {
    if (original.measurementId === undefined) {
      delete process.env.GA4_MEASUREMENT_ID;
    } else {
      process.env.GA4_MEASUREMENT_ID = original.measurementId;
    }

    if (original.apiSecret === undefined) {
      delete process.env.GA4_MP_API_SECRET;
    } else {
      process.env.GA4_MP_API_SECRET = original.apiSecret;
    }
  }

  assert.equal(called, false);
});

test("sendPurchaseEvent accepts a decimal value + paymentProvider (RevenueCat path)", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => {
    calls.push({ init });
    return new Response(null, { status: 204 });
  };

  await sendPurchaseEvent(
    {
      firebaseUid: "uid-9",
      transactionId: "rc_txn_9",
      value: 20,
      currency: "USD",
      paymentProvider: "revenuecat",
      items: [{ item_id: "monthly_20", item_name: "Monthly 20" }],
      store: "APP_STORE",
      periodType: "NORMAL",
    },
    fetchImpl as typeof fetch
  );

  const body = JSON.parse(String(calls[0].init?.body));
  const p = body.events[0].params;
  assert.equal(body.events[0].name, "purchase");
  assert.equal(p.value, 20);
  assert.equal(p.currency, "USD");
  assert.equal(p.payment_provider, "revenuecat");
  assert.equal(p.store, "APP_STORE");
  assert.equal(p.period_type, "NORMAL");
  assert.deepEqual(p.items, [{ item_id: "monthly_20", item_name: "Monthly 20" }]);
});

test("sendPurchaseEvent still converts valueMinorUnits for the Stripe path and tags provider", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => {
    calls.push({ init });
    return new Response(null, { status: 204 });
  };

  await sendPurchaseEvent(
    { firebaseUid: "uid-1", transactionId: "cs_1", valueMinorUnits: 1000, currency: "usd", paymentProvider: "stripe" },
    fetchImpl as typeof fetch
  );
  const p = JSON.parse(String(calls[0].init?.body)).events[0].params;
  assert.equal(p.value, 10);
  assert.equal(p.payment_provider, "stripe");
});

test("sendRefundEvent posts a refund event with the same transaction id", async () => {
  process.env.GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_MP_API_SECRET = "test-secret";
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchImpl = async (_u: any, init?: RequestInit) => {
    calls.push({ init });
    return new Response(null, { status: 204 });
  };

  await sendRefundEvent(
    { firebaseUid: "uid-1", transactionId: "cs_1", value: 10, currency: "usd", paymentProvider: "stripe" },
    fetchImpl as typeof fetch
  );
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.events[0].name, "refund");
  assert.equal(body.events[0].params.transaction_id, "cs_1");
});
