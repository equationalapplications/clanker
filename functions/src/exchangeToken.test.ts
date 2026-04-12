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
          email: "happy-path@example.com",
        },
      },
    } as never);

    assert.deepEqual(result, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    });

    assert.equal(calls.length, 3);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /generate_link$/);
    assert.match(calls[2]?.url ?? "", /verify$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler throws when user lookup and creation both fail", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    // findSupabaseUserByEmail → null
    new Response(JSON.stringify(null), {status: 200}),
    // createSupabaseUser → generic failure
    new Response(JSON.stringify({message: "internal error"}), {status: 500}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () => exchangeTokenHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1", email: "lookup-creation-fail@example.com"},
        },
      } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler throws when generate_link fails", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    // findSupabaseUserByEmail → found
    new Response(JSON.stringify("user-id"), {status: 200}),
    // generateLink → error
    new Response(JSON.stringify({message: "rate limit exceeded"}), {status: 429}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () => exchangeTokenHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1", email: "generate-link-fail@example.com"},
        },
      } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler throws when verifyOtp fails", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    // findSupabaseUserByEmail → found
    new Response(JSON.stringify("user-id"), {status: 200}),
    // generateLink → success
    new Response(JSON.stringify({hashed_token: "token"}), {status: 200}),
    // verifyOtp → error
    new Response(JSON.stringify({message: "otp expired"}), {status: 403}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () => exchangeTokenHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {uid: "firebase-uid-1", email: "verify-otp-fail@example.com"},
        },
      } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler reuses existing active user on 422 fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    // 1. findSupabaseUserByEmail → null
    new Response(JSON.stringify(null), {status: 200}),
    // 2. createSupabaseUser → 422
    new Response(JSON.stringify({msg: "already registered"}), {status: 422}),
    // 3. findIncludeDeleted → active user (no deleted_at)
    new Response(JSON.stringify({user_id: "existing-id", deleted_at: null}), {status: 200}),
    // 4. generate_link
    new Response(JSON.stringify({hashed_token: "ht"}), {status: 200}),
    // 5. verify
    new Response(
      JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
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
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "active422@example.com"},
      },
    } as never);

    assert.deepEqual(result, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "bearer",
    });

    // Should NOT have a DELETE call — user is active, just reuse
    assert.equal(calls.length, 5);
    assert.equal(calls.filter(c => c.method === "DELETE").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

