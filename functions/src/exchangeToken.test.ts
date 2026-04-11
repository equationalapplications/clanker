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

    assert.equal(calls.length, 4);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions\?on_conflict=user_id,app_name$/);
    assert.match(calls[2]?.url ?? "", /generate_link$/);
    assert.match(calls[3]?.url ?? "", /verify$/);

    const bootstrapPayload = JSON.parse(calls[1]?.body ?? "{}");
    assert.equal(bootstrapPayload.current_credits, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeTokenHandler throws when subscription bootstrap fails", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
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
    // 6. ensureFreeTierSubscription POST → success
    new Response(null, {status: 201}),
    // 7. generate_link → hashed token
    new Response(JSON.stringify({hashed_token: "hashed-token"}), {status: 200}),
    // 8. verify → session
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

    assert.equal(calls.length, 8);
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
    // subscription bootstrap
    assert.match(calls[5]?.url ?? "", /user_app_subscriptions/);
    // generate_link
    assert.match(calls[6]?.url ?? "", /generate_link$/);
    // verify
    assert.match(calls[7]?.url ?? "", /verify$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
