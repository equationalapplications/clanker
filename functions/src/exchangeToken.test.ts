import assert from "node:assert/strict";
import test from "node:test";

// Force test mode before imports that might initialize Cloud SQL clients.
process.env.NODE_ENV = "test";

import {HttpsError} from "firebase-functions/v2/https";
import {exchangeTokenHandler} from "./exchangeToken.js";

type ExchangeTokenDeps = NonNullable<Parameters<typeof exchangeTokenHandler>[1]>;

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
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
      updateUser: async () => mockUser,
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
  } as never, mockDeps as unknown as ExchangeTokenDeps);

  assert.deepEqual(result, {
    user: {
      id: mockUser.id,
      firebaseUid: mockUser.firebaseUid,
      email: mockUser.email,
      displayName: mockUser.displayName,
      avatarUrl: mockUser.avatarUrl,
      isProfilePublic: mockUser.isProfilePublic,
      defaultCharacterId: mockUser.defaultCharacterId,
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
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async () => mockUser,
    },
    subscriptionService: {
      getSubscription: async () => mockSubscription,
      upsertSubscription: async () => mockSubscription,
      acceptTerms: async () => {},
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
  } as never, mockDeps as unknown as ExchangeTokenDeps);

  assert.deepEqual(result, {
    user: {
      id: mockUser.id,
      firebaseUid: mockUser.firebaseUid,
      email: mockUser.email,
      displayName: mockUser.displayName,
      avatarUrl: mockUser.avatarUrl,
      isProfilePublic: mockUser.isProfilePublic,
      defaultCharacterId: mockUser.defaultCharacterId,
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
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
      updateUser: async () => null,
    },
    subscriptionService: {
      getSubscription: async () => null,
      upsertSubscription: async () => null,
      acceptTerms: async () => {},
    },
  };

  await assert.rejects(
    async () => exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {uid: "firebase-uid-1", email: "fail@example.com"},
      },
    } as never, mockDeps as unknown as ExchangeTokenDeps),
    (err: unknown) => err instanceof HttpsError && err.code === "internal"
  );
});
