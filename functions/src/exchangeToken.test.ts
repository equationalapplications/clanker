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
      getOrCreateDefaultSubscription: async () => mockSubscription,
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
      createdAt: mockUser.createdAt.toISOString(),
      updatedAt: mockUser.updatedAt.toISOString(),
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
      getOrCreateDefaultSubscription: async () => mockSubscription,
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
      createdAt: mockUser.createdAt.toISOString(),
      updatedAt: mockUser.updatedAt.toISOString(),
    },
    subscription: {
      planTier: mockSubscription.planTier,
      planStatus: mockSubscription.planStatus,
      currentCredits: mockSubscription.currentCredits,
      termsVersion: mockSubscription.termsVersion,
      termsAcceptedAt: mockSubscription.termsAcceptedAt.toISOString(),
    },
  });
});

test("exchangeTokenHandler returns timestamps as ISO strings, not Date objects", async () => {
  const now = new Date("2025-06-15T12:00:00.000Z");
  const mockUser = {
    id: "user-ts",
    firebaseUid: "firebase-uid-ts",
    email: "ts@example.com",
    displayName: "TS User",
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: now,
    updatedAt: now,
  };

  const accepted = new Date("2025-06-16T08:00:00.000Z");
  const mockSubscription = {
    userId: "user-ts",
    planTier: "free",
    planStatus: "active",
    currentCredits: 50,
    termsVersion: "v1",
    termsAcceptedAt: accepted,
  };

  const mockDeps = {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => mockUser,
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
      updateUser: async () => mockUser,
    },
    subscriptionService: {
      getSubscription: async () => mockSubscription,
      getOrCreateDefaultSubscription: async () => mockSubscription,
      upsertSubscription: async () => mockSubscription,
      acceptTerms: async () => {},
    },
  };

  const result = await exchangeTokenHandler({
    auth: {
      uid: "firebase-uid-ts",
      token: {
        uid: "firebase-uid-ts",
        email: "ts@example.com",
      },
    },
  } as never, mockDeps as unknown as ExchangeTokenDeps);

  // Timestamps must be ISO strings so Firebase callable encode() doesn't
  // corrupt them to empty objects (Date → {} via Object.entries).
  assert.strictEqual(typeof result.user.createdAt, "string");
  assert.strictEqual(typeof result.user.updatedAt, "string");
  assert.strictEqual(result.user.createdAt, "2025-06-15T12:00:00.000Z");
  assert.strictEqual(result.user.updatedAt, "2025-06-15T12:00:00.000Z");
  assert.strictEqual(typeof result.subscription.termsAcceptedAt, "string");
  assert.strictEqual(result.subscription.termsAcceptedAt, "2025-06-16T08:00:00.000Z");
});

test("exchangeTokenHandler returns null termsAcceptedAt as null", async () => {
  const now = new Date("2025-06-15T12:00:00.000Z");
  const mockUser = {
    id: "user-null",
    firebaseUid: "firebase-uid-null",
    email: "null@example.com",
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: now,
    updatedAt: now,
  };

  const mockSubscription = {
    userId: "user-null",
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
      getSubscription: async () => mockSubscription,
      getOrCreateDefaultSubscription: async () => mockSubscription,
      upsertSubscription: async () => mockSubscription,
      acceptTerms: async () => {},
    },
  };

  const result = await exchangeTokenHandler({
    auth: {
      uid: "firebase-uid-null",
      token: {
        uid: "firebase-uid-null",
        email: "null@example.com",
      },
    },
  } as never, mockDeps as unknown as ExchangeTokenDeps);

  assert.strictEqual(result.subscription.termsAcceptedAt, null);
});

test("exchangeTokenHandler does not reset credits when default subscription creation races", async () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const mockUser = {
    id: "user-race",
    firebaseUid: "firebase-uid-race",
    email: "race@example.com",
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: now,
    updatedAt: now,
  };

  const existingSubscription = {
    userId: "user-race",
    planTier: "monthly_20",
    planStatus: "active",
    currentCredits: 200,
    termsVersion: "v1",
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
      getSubscription: async () => null,
      getOrCreateDefaultSubscription: async () => existingSubscription,
      upsertSubscription: async () => {
        throw new Error("upsertSubscription should not be used for bootstrap defaults");
      },
      acceptTerms: async () => {},
    },
  };

  const result = await exchangeTokenHandler({
    auth: {
      uid: "firebase-uid-race",
      token: {
        uid: "firebase-uid-race",
        email: "race@example.com",
      },
    },
  } as never, mockDeps as unknown as ExchangeTokenDeps);

  assert.strictEqual(result.subscription.currentCredits, 200);
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
      getOrCreateDefaultSubscription: async () => null,
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

test("exchangeTokenHandler maps Cloud SQL config errors to failed-precondition", async () => {
  const mockDeps = {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => {
        throw new Error("Missing required Cloud SQL environment variables: CLOUD_SQL_DB_USER");
      },
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
      updateUser: async () => null,
    },
    subscriptionService: {
      getSubscription: async () => null,
      getOrCreateDefaultSubscription: async () => null,
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
    (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
  );
});

test("exchangeTokenHandler throws when required user timestamps are missing", async () => {
  const mockUser = {
    id: "user-missing-ts",
    firebaseUid: "firebase-uid-missing-ts",
    email: "missing-ts@example.com",
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: undefined,
    updatedAt: new Date(),
  };

  const mockSubscription = {
    userId: "user-missing-ts",
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
      getSubscription: async () => mockSubscription,
      getOrCreateDefaultSubscription: async () => mockSubscription,
      upsertSubscription: async () => mockSubscription,
      acceptTerms: async () => {},
    },
  };

  await assert.rejects(
    async () => exchangeTokenHandler({
      auth: {
        uid: "firebase-uid-missing-ts",
        token: {
          uid: "firebase-uid-missing-ts",
          email: "missing-ts@example.com",
        },
      },
    } as never, mockDeps as unknown as ExchangeTokenDeps),
    (err: unknown) => err instanceof HttpsError && err.code === "internal"
  );
});
