import assert from "node:assert/strict";
import test from "node:test";

// Mock environment variables before any imports that might trigger DB initialization
process.env.CLOUD_SQL_CONNECTION_NAME = "project:region:instance";
process.env.CLOUD_SQL_DB_USER = "test";
process.env.CLOUD_SQL_DB_PASS = "test";
process.env.CLOUD_SQL_DB_NAME = "test";

import {HttpsError} from "firebase-functions/v2/https";
import {exchangeTokenHandler} from "./exchangeToken.js";

test("exchangeTokenHandler rejects unauthenticated requests", async () => {
  await assert.rejects(
    async () => exchangeTokenHandler({auth: null} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("exchangeTokenHandler bootstraps a new user with onboarding credits", async () => {
  const mockUser = {
    id: "user-123",
    firebaseUid: "firebase-uid-1",
    email: "new-user@example.com",
    displayName: "New User",
    avatarUrl: "https://example.com/photo.png",
    createdAt: new Date(),
  };

  const mockSubscription = {
    userId: "user-123",
    planTier: "free",
    planStatus: "active",
    currentCredits: 50,
    termsVersion: null,
    termsAcceptedAt: null,
  };

  const mockDeps = {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => mockUser,
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
    },
    subscriptionService: {
      getSubscription: async () => null, // First call returns null for new user
      upsertSubscription: async () => mockSubscription,
      acceptTerms: async () => {},
    },
  };

  const result = await exchangeTokenHandler({
    auth: {
      uid: "firebase-uid-1",
      token: {
        uid: "firebase-uid-1",
        email: "new-user@example.com",
        name: "New User",
        picture: "https://example.com/photo.png",
      },
    },
  } as never, mockDeps as any);

  assert.deepEqual(result, {
    user: {
      id: mockUser.id,
      firebaseUid: mockUser.firebaseUid,
      email: mockUser.email,
      displayName: mockUser.displayName,
      avatarUrl: mockUser.avatarUrl,
      createdAt: mockUser.createdAt,
    },
    subscription: {
      planTier: mockSubscription.planTier,
      planStatus: mockSubscription.planStatus,
      currentCredits: mockSubscription.currentCredits,
      termsVersion: mockSubscription.termsVersion,
      termsAcceptedAt: mockSubscription.termsAcceptedAt,
    },
  });
});

test("exchangeTokenHandler returns existing user and subscription", async () => {
  const mockUser = {
    id: "user-123",
    firebaseUid: "firebase-uid-1",
    email: "existing@example.com",
    displayName: "Existing User",
    avatarUrl: null,
    createdAt: new Date(),
  };

  const mockSubscription = {
    userId: "user-123",
    planTier: "monthly_20",
    planStatus: "active",
    currentCredits: 150,
    termsVersion: "v1",
    termsAcceptedAt: new Date(),
  };

  const mockDeps = {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => mockUser,
    },
    subscriptionService: {
      getSubscription: async () => mockSubscription,
    },
  };

  const result = await exchangeTokenHandler({
    auth: {
      uid: "firebase-uid-1",
      token: {
        uid: "firebase-uid-1",
        email: "existing@example.com",
      },
    },
  } as never, mockDeps as any);

  assert.deepEqual(result, {
    user: {
      id: mockUser.id,
      firebaseUid: mockUser.firebaseUid,
      email: mockUser.email,
      displayName: mockUser.displayName,
      avatarUrl: mockUser.avatarUrl,
      createdAt: mockUser.createdAt,
    },
    subscription: {
      planTier: mockSubscription.planTier,
      planStatus: mockSubscription.planStatus,
      currentCredits: mockSubscription.currentCredits,
      termsVersion: mockSubscription.termsVersion,
      termsAcceptedAt: mockSubscription.termsAcceptedAt,
    },
  });
});

test("exchangeTokenHandler throws internal error when userRepository fails", async () => {
  const mockDeps = {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => {
        throw new Error("DB error");
      },
    },
    subscriptionService: {},
  };

  await assert.rejects(
    async () => exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "fail@example.com"},
      },
    } as never, mockDeps as any),
    (err: unknown) => err instanceof HttpsError && err.code === "internal"
  );
});
