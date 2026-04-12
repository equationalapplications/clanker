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

    assert.equal(calls.length, 3);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /generate_link$/);
    assert.match(calls[2]?.url ?? "", /verify$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler recreates a soft-deleted Supabase user", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    // 1. findSupabaseUserByEmail RPC → null (not found / soft-deleted)
    new Response(JSON.stringify(null), {status: 200}),
    // 2. createSupabaseUser POST → 422 (email already exists)
    new Response(JSON.stringify({msg: "A user with this email address has already been registered"}), {status: 422}),
    // 3. findSupabaseUserByEmailIncludeDeleted RPC → returns soft-deleted user
    new Response(JSON.stringify({user_id: "stale-id", deleted_at: "2026-04-11T00:00:00.000Z"}), {status: 200}),
    // 4. delete stale user → success
    new Response(null, {status: 200}),
    // 5. recreate user → success
    new Response(JSON.stringify({id: "recreated-id"}), {status: 201}),
    // 6. generate_link → hashed token
    new Response(JSON.stringify({hashed_token: "hashed-token"}), {status: 200}),
    // 7. verify → session
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
      throw new Error("Unexpected fetch call in soft-delete recreate test");
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

    assert.equal(calls.length, 7);
    // RPC lookup (get_user_id_by_email)
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    // create user attempt
    assert.equal(calls[1]?.method, "POST");
    assert.match(calls[1]?.url ?? "", /admin\/users$/);
    // RPC fallback (get_auth_user_by_email — includes soft-deleted)
    assert.equal(calls[2]?.method, "POST");
    assert.match(calls[2]?.url ?? "", /get_auth_user_by_email$/);
    // stale-user delete
    assert.equal(calls[3]?.method, "DELETE");
    assert.match(calls[3]?.url ?? "", /admin\/users\/stale-id$/);
    // recreate user
    assert.equal(calls[4]?.method, "POST");
    assert.match(calls[4]?.url ?? "", /admin\/users$/);
    // generate_link
    assert.match(calls[5]?.url ?? "", /generate_link$/);
    // verify
    assert.match(calls[6]?.url ?? "", /verify$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler rejects second exchange within rate-limit window", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("user-id-1"), {status: 200}),
    new Response(JSON.stringify({hashed_token: "token1"}), {status: 200}),
    new Response(
      JSON.stringify({
        access_token: "access-1",
        refresh_token: "refresh-1",
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
      throw new Error("Unexpected fetch call in rate-limit test");
    }
    return next;
  }) as typeof fetch;

  try {
    // First exchange succeeds
    const result1 = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {
          uid: "firebase-uid-1",
          email: "ratelimit@example.com",
        },
      },
    } as never);

    assert.equal(result1.access_token, "access-1");

    // Second exchange within 30s window rejected
    await assert.rejects(
      async () => exchangeTokenHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "ratelimit@example.com",
          },
        },
      } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "resource-exhausted"
    );
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
          token: {uid: "firebase-uid-1", email: "noluck@example.com"},
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
          token: {uid: "firebase-uid-1", email: "linkfail@example.com"},
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
          token: {uid: "firebase-uid-1", email: "verifyfail@example.com"},
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
