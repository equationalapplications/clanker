import test from "node:test";
import assert from "node:assert/strict";
import { buildClientId, sendPurchaseEvent } from "./ga4MeasurementService.js";

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
        valueCents: 1000,
        currency: "usd",
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
        { firebaseUid: "uid-123", transactionId: "cs_test_abc", valueCents: 1000, currency: "usd" },
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
      { firebaseUid: "uid-123", transactionId: "cs_test_abc", valueCents: 1000, currency: "usd" },
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
