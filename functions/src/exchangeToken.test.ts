import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";
import admin from "firebase-admin";

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

test("exchangeTokenHandler rejects second exchange within rate-limit window", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string}> = [];

  const responses = [
    // 1st call: findUser, generateLink, verifyOtp
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
    // 2nd call: findUser succeeds, then rate-limit rejects before generateLink
    new Response(JSON.stringify("user-id-1"), {status: 200}),
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

// --- Firestore transaction path tests ---

/** Replace admin.firestore with a mock; returns restore function. */
function mockAdminFirestore(opts: {
  existingLastAt?: number;
  transactionError?: Error;
}): () => void {
  const mockDb = {
    collection: () => ({
      doc: () => ({
        delete: async () => { /* clearSessionExchangeRecord best-effort delete */ },
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.transactionError) throw opts.transactionError;

      const mockTx = {
        get: async () => ({
          exists: opts.existingLastAt !== undefined,
          get: (field: string) =>
            field === "lastAt" ? opts.existingLastAt : undefined,
        }),
        set: () => {},
      };
      return fn(mockTx);
    },
  };

  // Also need FieldValue.serverTimestamp as a static property on the function
  const mockFirestore = Object.assign(
    () => mockDb,
    {FieldValue: {serverTimestamp: () => "mock-server-ts"}},
  );

  // admin.firestore is a prototype getter; define own property to shadow it
  Object.defineProperty(admin, "firestore", {
    value: mockFirestore,
    writable: true,
    configurable: true,
  });

  return () => {
    // Delete the own property to reveal the original prototype getter
    delete (admin as Record<string, unknown>).firestore;
  };
}

test("Firestore rate-limit blocks exchange within window", async () => {
  const originalFetch = globalThis.fetch;
  const recentTimestamp = Date.now() - 5_000; // 5s ago, well within 30s window
  const restore = mockAdminFirestore({existingLastAt: recentTimestamp});

  // Handler calls findSupabaseUserByEmail before getSupabaseUserSession,
  // so we still need a fetch response for the user lookup.
  const responses = [
    new Response(JSON.stringify("user-id"), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        exchangeTokenHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1", email: "firestore-rl@example.com"},
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError && err.code === "resource-exhausted",
    );
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("Firestore rate-limit allows exchange when no recent record", async () => {
  const originalFetch = globalThis.fetch;
  // existingLastAt undefined → no prior record → should proceed
  const restore = mockAdminFirestore({});

  const responses = [
    // findSupabaseUserByEmail → found
    new Response(JSON.stringify("user-id"), {status: 200}),
    // generateLink
    new Response(JSON.stringify({hashed_token: "ht-fs"}), {status: 200}),
    // verifyOtp
    new Response(
      JSON.stringify({
        access_token: "at-fs",
        refresh_token: "rt-fs",
        expires_in: 3600,
        token_type: "bearer",
      }),
      {status: 200},
    ),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "firestore-ok@example.com"},
      },
    } as never);

    assert.equal(result.access_token, "at-fs");
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("Firestore rate-limit allows exchange when last record outside window", async () => {
  const originalFetch = globalThis.fetch;
  // existingLastAt 60s ago → outside 30s window → should proceed
  const restore = mockAdminFirestore({existingLastAt: Date.now() - 60_000});

  const responses = [
    new Response(JSON.stringify("user-id"), {status: 200}),
    new Response(JSON.stringify({hashed_token: "ht-fs2"}), {status: 200}),
    new Response(
      JSON.stringify({
        access_token: "at-fs2",
        refresh_token: "rt-fs2",
        expires_in: 3600,
        token_type: "bearer",
      }),
      {status: 200},
    ),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;

  try {
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "firestore-old@example.com"},
      },
    } as never);

    assert.equal(result.access_token, "at-fs2");
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("Rate-limit record cleared after generateLink failure, allowing retry", async () => {
  const originalFetch = globalThis.fetch;
  // First: no existing record → proceeds, but generateLink fails
  // Second: should NOT be rate-limited because record was cleared on failure
  const restore = mockAdminFirestore({});

  const callCount = {value: 0};

  globalThis.fetch = (async (input: string | URL | Request) => {
    callCount.value++;
    const url = String(input);

    // Both calls: findUser → found
    if (url.includes("get_user_id_by_email")) {
      return new Response(JSON.stringify("user-id"), {status: 200});
    }

    // First generateLink → error
    if (url.includes("generate_link") && callCount.value <= 3) {
      return new Response(JSON.stringify({message: "transient error"}), {status: 500});
    }

    // Second generateLink → success
    if (url.includes("generate_link")) {
      return new Response(JSON.stringify({hashed_token: "ht-retry"}), {status: 200});
    }

    // verifyOtp → success
    if (url.includes("verify")) {
      return new Response(
        JSON.stringify({
          access_token: "at-retry",
          refresh_token: "rt-retry",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {status: 200},
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    // First call fails at generateLink
    await assert.rejects(
      async () =>
        exchangeTokenHandler({
          auth: {
            uid: "firebase-uid-1",
            token: {uid: "firebase-uid-1", email: "retrycleared@example.com"},
          },
        } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal",
    );

    // Second call should NOT be rate-limited — record was cleared
    const result = await exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "retrycleared@example.com"},
      },
    } as never);

    assert.equal(result.access_token, "at-retry");
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});
