import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";
process.env.ADMIN_ALLOWLIST_EMAILS = "admin@example.com";

import {
  adminListUsersHandler,
  adminSetUserCreditsHandler,
  adminClearTermsAcceptanceHandler,
} from "./adminFunctions.js";

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

test("adminClearTermsAcceptanceHandler updates terms fields", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify([payload]), {status: 201});
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
