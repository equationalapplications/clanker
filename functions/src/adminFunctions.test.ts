import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";
import admin from "firebase-admin";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";
process.env.ADMIN_ALLOWLIST_EMAILS = "admin@example.com";

const {
  adminListUsersHandler,
  adminSetUserCreditsHandler,
  adminSetUserSubscriptionHandler,
  adminClearTermsAcceptanceHandler,
  adminResetUserStateHandler,
  adminDeleteUserHandler,
  deleteMyAccountHandler,
} = await import("./adminFunctions.js");

async function withAdminDeleteUserStub<T>(
  deleteUser: (uid: string) => Promise<void>,
  run: () => Promise<T>
): Promise<T> {
  const hadOwnAuth = Object.prototype.hasOwnProperty.call(admin, "auth");
  const ownAuthDescriptor = hadOwnAuth ? Object.getOwnPropertyDescriptor(admin, "auth") : undefined;

  Object.defineProperty(admin, "auth", {
    value: (() => ({deleteUser})) as typeof admin.auth,
    writable: true,
    configurable: true,
  });

  try {
    return await run();
  } finally {
    if (ownAuthDescriptor) {
      Object.defineProperty(admin, "auth", ownAuthDescriptor);
    } else {
      delete (admin as Record<string, unknown>).auth;
    }
  }
}

test("adminListUsersHandler rejects non-admin callers", async () => {
  await assert.rejects(
    async () =>
      adminListUsersHandler({
        auth: {
          uid: "firebase-user-1",
          token: {
            uid: "firebase-user-1",
            email: "person@example.com",
          },
        },
        data: {},
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "permission-denied"
  );
});

test("adminListUsersHandler rejects malformed auth token payload", async () => {
  await assert.rejects(
    async () =>
      adminListUsersHandler({
        auth: {
          uid: "firebase-user-1",
          token: undefined,
        },
        data: {},
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("adminListUsersHandler returns hydrated user rows", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/auth/v1/admin/users?page=1&per_page=25")) {
      return new Response(
        JSON.stringify({
          users: [
            {
              id: "supabase-user-1",
              email: "target@example.com",
              created_at: "2026-04-01T00:00:00.000Z",
            },
          ],
        }),
        {status: 200}
      );
    }

    if (url.includes("/rest/v1/user_app_subscriptions")) {
      return new Response(
        JSON.stringify([
          {
            user_id: "supabase-user-1",
            app_name: "clanker",
            plan_tier: "monthly_20",
            plan_status: "active",
            current_credits: 44,
            terms_accepted_at: "2026-04-02T00:00:00.000Z",
            terms_version: "v3",
          },
        ]),
        {status: 200}
      );
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminListUsersHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {},
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.users.length, 1);
    assert.deepEqual(result.users[0], {
      userId: "supabase-user-1",
      email: "target@example.com",
      createdAt: "2026-04-01T00:00:00.000Z",
      planTier: "monthly_20",
      planStatus: "active",
      currentCredits: 44,
      termsAcceptedAt: "2026-04-02T00:00:00.000Z",
      termsVersion: "v3",
    });
    assert.ok(calls.some((entry) => entry.includes("auth/v1/admin/users")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminListUsersHandler forwards trimmed search to Supabase filter and returns totalCount", async () => {
  const originalFetch = globalThis.fetch;
  let capturedFilter: string | null = null;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));

    if (url.pathname === "/auth/v1/admin/users") {
      capturedFilter = url.searchParams.get("filter");
      return new Response(
        JSON.stringify({
          users: [
            {
              id: "supabase-user-2",
              email: "search-hit@example.com",
              created_at: "2026-04-03T00:00:00.000Z",
            },
          ],
          totalCount: 77,
        }),
        {status: 200}
      );
    }

    if (url.pathname === "/rest/v1/user_app_subscriptions") {
      return new Response(JSON.stringify([]), {status: 200});
    }

    throw new Error(`Unexpected fetch call in test: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await adminListUsersHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        search: "  search-hit  ",
      },
    } as never);

    assert.equal(capturedFilter, "search-hit");
    assert.equal(result.totalCount, 77);
    assert.equal(result.hasMore, true);
    assert.equal(result.users.length, 1);
    assert.equal(result.users[0]?.email, "search-hit@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminListUsersHandler computes hasMore from totalCount when available", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));

    if (url.pathname === "/auth/v1/admin/users") {
      return new Response(
        JSON.stringify({
          users: [
            {
              id: "supabase-user-4",
              email: "exact-page@example.com",
              created_at: "2026-04-04T00:00:00.000Z",
            },
          ],
          totalCount: 25,
        }),
        {status: 200}
      );
    }

    if (url.pathname === "/rest/v1/user_app_subscriptions") {
      return new Response(JSON.stringify([]), {status: 200});
    }

    throw new Error(`Unexpected fetch call in test: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await adminListUsersHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        page: 1,
        pageSize: 25,
      },
    } as never);

    assert.equal(result.totalCount, 25);
    assert.equal(result.hasMore, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminListUsersHandler does not apply client-side search filtering", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));

    if (url.pathname === "/auth/v1/admin/users") {
      return new Response(
        JSON.stringify({
          users: [
            {
              id: "supabase-user-3",
              email: "kept-by-server-filter@example.com",
              created_at: "2026-04-04T00:00:00.000Z",
            },
          ],
        }),
        {status: 200}
      );
    }

    if (url.pathname === "/rest/v1/user_app_subscriptions") {
      return new Response(JSON.stringify([]), {status: 200});
    }

    throw new Error(`Unexpected fetch call in test: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await adminListUsersHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        search: "not-in-returned-email-or-id",
      },
    } as never);

    assert.equal(result.users.length, 1);
    assert.equal(result.users[0]?.userId, "supabase-user-3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminSetUserCreditsHandler validates reason", async () => {
  await assert.rejects(
    async () =>
      adminSetUserCreditsHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "supabase-user-1",
          credits: 10,
          requestId: "req-12345678",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("adminSetUserCreditsHandler rejects credits above DB integer limit", async () => {
  await assert.rejects(
    async () =>
      adminSetUserCreditsHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "supabase-user-1",
          credits: 2147483648,
          reason: "invalid test",
          requestId: "req-credits-too-large",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("adminClearTermsAcceptanceHandler updates terms fields", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");

    if (url.includes("/rest/v1/user_app_subscriptions?") && method === "GET") {
      return new Response(
        JSON.stringify([
          {
            user_id: "supabase-user-1",
            app_name: "clanker",
            plan_tier: "monthly_20",
            plan_status: "active",
          },
        ]),
        {status: 200}
      );
    }

    if (url.includes("/rest/v1/user_app_subscriptions?on_conflict") && method === "POST") {
      payload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify([payload]), {status: 201});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminClearTermsAcceptanceHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        userId: "supabase-user-1",
        requestId: "req-87654321",
        reason: "cleanup",
      },
    } as never);

    assert.equal(result.success, true);
    assert.ok(payload);
    const capturedPayload = payload as Record<string, unknown>;
    assert.equal(capturedPayload.terms_accepted_at, null);
    assert.equal(capturedPayload.terms_version, null);
    assert.equal(capturedPayload.plan_tier, "monthly_20");
    assert.equal(capturedPayload.plan_status, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminClearTermsAcceptanceHandler returns failed-precondition when subscription is missing", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");

    if (url.includes("/rest/v1/user_app_subscriptions?") && method === "GET") {
      return new Response(JSON.stringify([]), {status: 200});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        adminClearTermsAcceptanceHandler({
          auth: {
            uid: "firebase-admin-1",
            token: {
              uid: "firebase-admin-1",
              email: "admin@example.com",
            },
          },
          data: {
            userId: "supabase-user-1",
            requestId: "req-terms-missing-subscription",
            reason: "cleanup",
          },
        } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminSetUserCreditsHandler fails fast when subscription read fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/rest/v1/user_app_subscriptions")) {
      return new Response(JSON.stringify({message: "temporary outage"}), {status: 503});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        adminSetUserCreditsHandler({
          auth: {
            uid: "firebase-admin-1",
            token: {
              uid: "firebase-admin-1",
              email: "admin@example.com",
            },
          },
          data: {
            userId: "supabase-user-1",
            credits: 12,
            reason: "adjust",
            requestId: "req-credits-fail-1",
          },
        } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminSetUserSubscriptionHandler rejects invalid renewalDate", async () => {
  await assert.rejects(
    async () =>
      adminSetUserSubscriptionHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "supabase-user-1",
          planTier: "free",
          planStatus: "active",
          renewalDate: "not-a-date",
          reason: "cleanup",
          requestId: "req-subscription-1",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("adminSetUserSubscriptionHandler rejects non-ISO renewalDate formats", async () => {
  await assert.rejects(
    async () =>
      adminSetUserSubscriptionHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "supabase-user-1",
          planTier: "free",
          planStatus: "active",
          renewalDate: "2026-05-01 00:00:00",
          reason: "cleanup",
          requestId: "req-subscription-non-iso-1",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("adminSetUserSubscriptionHandler stores renewalDate in plan_renewal_at", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string | null}> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({url, method, body});

    if (url.includes("/rest/v1/user_app_subscriptions?on_conflict") && method === "POST") {
      return new Response(JSON.stringify({ok: true}), {status: 201});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminSetUserSubscriptionHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        userId: "supabase-user-1",
        planTier: "monthly_20",
        planStatus: "cancelled",
        renewalDate: "2026-05-01T00:00:00.000Z",
        reason: "manual correction",
        requestId: "req-subscription-2",
      },
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.applied.planStatus, "cancelled");
    assert.equal(calls.length, 1);
    const upsertPayload = JSON.parse(calls[0]?.body ?? "{}");
    assert.equal(upsertPayload.plan_renewal_at, "2026-05-01T00:00:00.000Z");
    assert.equal(upsertPayload.billing_cycle_end, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminSetUserSubscriptionHandler does not mutate plan_renewal_at when renewalDate is omitted", async () => {
  const originalFetch = globalThis.fetch;
  let upsertPayload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");

    if (url.includes("/rest/v1/user_app_subscriptions?on_conflict") && method === "POST") {
      upsertPayload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ok: true}), {status: 201});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminSetUserSubscriptionHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        userId: "supabase-user-1",
        planTier: "monthly_20",
        planStatus: "active",
        reason: "manual correction",
        requestId: "req-subscription-no-renewal-1",
      },
    } as never);

    assert.equal(result.success, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.applied, "renewalDate"), false);
    assert.ok(upsertPayload);
    const captured = upsertPayload as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(captured, "plan_renewal_at"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminSetUserSubscriptionHandler clears plan_renewal_at when renewalDate is explicitly null", async () => {
  const originalFetch = globalThis.fetch;
  let upsertPayload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");

    if (url.includes("/rest/v1/user_app_subscriptions?on_conflict") && method === "POST") {
      upsertPayload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ok: true}), {status: 201});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminSetUserSubscriptionHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        userId: "supabase-user-1",
        planTier: "monthly_20",
        planStatus: "active",
        renewalDate: null,
        reason: "manual correction",
        requestId: "req-subscription-clear-renewal-1",
      },
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.applied.renewalDate, null);
    assert.ok(upsertPayload);
    const captured = upsertPayload as Record<string, unknown>;
    assert.equal(captured.plan_renewal_at, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminResetUserStateHandler deletes app data then resets subscription", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string; body: string | null}> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({url, method, body});

    if (url.includes("/rest/v1/yours_brightly_messages") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/yours_brightly_characters") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/user_app_subscriptions?on_conflict") && method === "POST") {
      return new Response(JSON.stringify({ok: true}), {status: 201});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await adminResetUserStateHandler({
      auth: {
        uid: "firebase-admin-1",
        token: {
          uid: "firebase-admin-1",
          email: "admin@example.com",
        },
      },
      data: {
        userId: "supabase-user-1",
        reason: "support reset",
        requestId: "req-reset-1",
      },
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.applied.currentCredits, 50);
    assert.equal(calls.length, 3);
    assert.ok(calls[0]?.url.includes("/rest/v1/yours_brightly_messages"));
    assert.ok(calls[1]?.url.includes("/rest/v1/yours_brightly_characters"));
    assert.ok(calls[2]?.url.includes("/rest/v1/user_app_subscriptions?on_conflict"));

    const upsertPayload = JSON.parse(calls[2]?.body ?? "{}");
    assert.equal(upsertPayload.plan_tier, "free");
    assert.equal(upsertPayload.plan_status, "active");
    assert.equal(upsertPayload.current_credits, 50);
    assert.equal(upsertPayload.plan_renewal_at, null);
    assert.equal(upsertPayload.terms_accepted_at, null);
    assert.equal(upsertPayload.terms_version, null);
    assert.equal(upsertPayload.billing_provider_id, null);
    assert.deepEqual(upsertPayload.billing_metadata, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminResetUserStateHandler attempts all app-data deletions before failing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push(`${method} ${url}`);

    if (url.includes("/rest/v1/yours_brightly_messages") && method === "DELETE") {
      return new Response(JSON.stringify({message: "delete failed"}), {status: 500});
    }

    if (url.includes("/rest/v1/yours_brightly_characters") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        adminResetUserStateHandler({
          auth: {
            uid: "firebase-admin-1",
            token: {
              uid: "firebase-admin-1",
              email: "admin@example.com",
            },
          },
          data: {
            userId: "supabase-user-1",
            reason: "support reset",
            requestId: "req-reset-fail-1",
          },
        } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 2);
    assert.ok(calls[0]?.includes("/rest/v1/yours_brightly_messages"));
    assert.ok(calls[1]?.includes("/rest/v1/yours_brightly_characters"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminResetUserStateHandler surfaces failed-precondition when canonical table is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push(`${method} ${url}`);

    if (url.includes("/rest/v1/yours_brightly_messages") && method === "DELETE") {
      return new Response(
        JSON.stringify({
          code: "PGRST205",
          message: "Could not find the table 'public.yours_brightly_messages' in the schema cache",
        }),
        {status: 404}
      );
    }

    if (url.includes("/rest/v1/yours_brightly_characters") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        adminResetUserStateHandler({
          auth: {
            uid: "firebase-admin-1",
            token: {
              uid: "firebase-admin-1",
              email: "admin@example.com",
            },
          },
          data: {
            userId: "supabase-user-1",
            reason: "support reset",
            requestId: "req-reset-schema-mismatch-1",
          },
        } as never),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("expected canonical table yours_brightly_messages")
    );

    assert.equal(calls.length, 2);
    assert.ok(calls[0]?.includes("/rest/v1/yours_brightly_messages"));
    assert.ok(calls[1]?.includes("/rest/v1/yours_brightly_characters"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminDeleteUserHandler deletes app data and identities", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string}> = [];
  let deletedFirebaseUid: string | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({url, method});

    if (url.endsWith("/auth/v1/admin/users/supabase-user-2") && method === "GET") {
      return new Response(
        JSON.stringify({
          user_metadata: {
            firebaseUid: "firebase-user-2",
          },
        }),
        {status: 200}
      );
    }

    if (url.includes("/rest/v1/yours_brightly_messages") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/yours_brightly_characters") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/user_app_subscriptions") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.endsWith("/auth/v1/admin/users/supabase-user-2") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await withAdminDeleteUserStub(
      async (uid: string) => {
        deletedFirebaseUid = uid;
      },
      async () => adminDeleteUserHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "supabase-user-2",
          reason: "gdpr",
          requestId: "req-delete-2",
        },
      } as never),
    );

    assert.equal(result.success, true);
    assert.equal(result.applied.deleted, true);
    assert.equal(deletedFirebaseUid, "firebase-user-2");
    assert.equal(calls.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminDeleteUserHandler returns internal when Firebase deletion fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string}> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({url, method});

    if (url.endsWith("/auth/v1/admin/users/supabase-user-1") && method === "GET") {
      return new Response(
        JSON.stringify({
          user_metadata: {
            firebaseUid: "firebase-user-1",
          },
        }),
        {status: 200}
      );
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        withAdminDeleteUserStub(
          async () => {
            throw new Error("firebase delete failed");
          },
          async () => adminDeleteUserHandler({
            auth: {
              uid: "firebase-admin-1",
              token: {
                uid: "firebase-admin-1",
                email: "admin@example.com",
              },
            },
            data: {
              userId: "supabase-user-1",
              reason: "gdpr",
              requestId: "req-delete-1",
            },
          } as never),
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adminDeleteUserHandler fails when Supabase auth fetch is non-404", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string}> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({url, method});

    if (url.endsWith("/auth/v1/admin/users/supabase-user-5") && method === "GET") {
      return new Response(JSON.stringify({message: "upstream temporary error"}), {status: 503});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  let attemptedFirebaseDelete = false;
  try {
    await assert.rejects(
      async () =>
        withAdminDeleteUserStub(
          async () => {
            attemptedFirebaseDelete = true;
          },
          async () => adminDeleteUserHandler({
            auth: {
              uid: "firebase-admin-1",
              token: {
                uid: "firebase-admin-1",
                email: "admin@example.com",
              },
            },
            data: {
              userId: "supabase-user-5",
              reason: "gdpr",
              requestId: "req-delete-5",
            },
          } as never),
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 1);
    assert.equal(attemptedFirebaseDelete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteMyAccountHandler deletes Supabase data and Firebase auth for the caller", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; method: string}> = [];
  let deletedFirebaseUid: string | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({url, method});

    if (url.endsWith("/rest/v1/rpc/get_user_id_by_firebase_uid") && method === "POST") {
      return new Response(JSON.stringify("supabase-user-self"), {status: 200});
    }

    if (url.includes("/rest/v1/yours_brightly_messages") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/yours_brightly_characters") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.includes("/rest/v1/user_app_subscriptions") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    if (url.endsWith("/auth/v1/admin/users/supabase-user-self") && method === "DELETE") {
      return new Response(null, {status: 204});
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await withAdminDeleteUserStub(
      async (uid: string) => {
        deletedFirebaseUid = uid;
      },
      async () => deleteMyAccountHandler({
        auth: {
          uid: "firebase-self-1",
          token: {
            uid: "firebase-self-1",
          },
        },
        data: {},
      } as never),
    );

    assert.equal(result.success, true);
    assert.equal(result.deleted, true);
    assert.equal(result.userId, "supabase-user-self");
    assert.equal(deletedFirebaseUid, "firebase-self-1");
    assert.equal(calls.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteMyAccountHandler rejects unauthenticated callers", async () => {
  await assert.rejects(
    async () =>
      deleteMyAccountHandler({
        auth: undefined,
        data: {},
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});
