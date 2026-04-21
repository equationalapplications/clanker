import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

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
          userId: "user-1",
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
          userId: "user-1",
          credits: 2147483648,
          reason: "invalid test",
          requestId: "req-credits-too-large",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
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
          userId: "user-1",
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

test("adminSetUserSubscriptionHandler rejects invalid plan values", async () => {
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
          userId: "user-1",
          planTier: "enterprise",
          planStatus: "active",
          reason: "cleanup",
          requestId: "req-subscription-2",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("adminClearTermsAcceptanceHandler requires auth", async () => {
  await assert.rejects(
    async () =>
      adminClearTermsAcceptanceHandler({
        auth: null,
        data: {
          userId: "user-1",
          reason: "cleanup",
          requestId: "req-terms-1",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("adminResetUserStateHandler requires auth", async () => {
  await assert.rejects(
    async () =>
      adminResetUserStateHandler({
        auth: null,
        data: {
          userId: "user-1",
          reason: "reset",
          requestId: "req-reset-1",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("adminDeleteUserHandler validates userId", async () => {
  await assert.rejects(
    async () =>
      adminDeleteUserHandler({
        auth: {
          uid: "firebase-admin-1",
          token: {
            uid: "firebase-admin-1",
            email: "admin@example.com",
          },
        },
        data: {
          userId: "",
          reason: "cleanup",
          requestId: "req-delete-1",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("deleteMyAccountHandler rejects unauthenticated requests", async () => {
  await assert.rejects(
    async () => deleteMyAccountHandler({auth: null, data: {}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});
