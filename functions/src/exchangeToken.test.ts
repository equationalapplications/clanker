import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";

import {exchangeTokenHandler} from "./exchangeToken.js";

test("exchangeTokenHandler rejects unauthenticated requests", async () => {
  await assert.rejects(
    async () => exchangeTokenHandler({auth: null} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("exchangeTokenHandler returns a Supabase session for an authenticated user", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(JSON.stringify([]), {status: 200}),
    new Response(null, {status: 201}),
    new Response(JSON.stringify({hashed_token: "hashed-token"}), {status: 200}),
    new Response(
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in exchangeToken test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {
          uid: "firebase-uid-1",
          email: "person@example.com",
        },
      },
    } as never);

    assert.deepEqual(result, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    });

    assert.equal(calls.length, 5);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions\?select=user_id/);
    assert.match(calls[2]?.url ?? "", /user_app_subscriptions\?on_conflict=user_id,app_name$/);
    assert.match(calls[3]?.url ?? "", /generate_link$/);
    assert.match(calls[4]?.url ?? "", /verify$/);

    const bootstrapPayload = JSON.parse(calls[2]?.body ?? "{}");
    assert.equal(bootstrapPayload.current_credits, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler skips subscription insert when row already exists", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(JSON.stringify([{user_id: "supabase-user-id"}]), {status: 200}),
    new Response(JSON.stringify({hashed_token: "hashed-token"}), {status: 200}),
    new Response(
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in exchangeToken existing-row test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {
          uid: "firebase-uid-1",
          email: "person@example.com",
        },
      },
    } as never);

    assert.deepEqual(result, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    });

    assert.equal(calls.length, 4);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions\?select=user_id/);
    assert.match(calls[2]?.url ?? "", /generate_link$/);
    assert.match(calls[3]?.url ?? "", /verify$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler throws when subscription bootstrap fails", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(JSON.stringify([]), {status: 200}),
    new Response(JSON.stringify({message: "insert failed"}), {status: 500}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in exchangeToken failure-path test");
    }
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () => exchangeTokenHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
      } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
