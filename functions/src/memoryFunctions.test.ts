import assert from "node:assert/strict";
import test from "node:test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.NODE_ENV = "test";

const {
  memoryReadHandler,
  memoryWriteHandler,
  memoryHealHandler,
  memoryForgetHandler,
  syncCharacterMemoryHandler,
} = await import("./memoryFunctions.js");

let authCounter = 0;

function buildAuth() {
  authCounter += 1;
  const uid = `firebase-uid-${authCounter}`;
  return {
    uid,
    token: {
      uid,
      email: `person-${authCounter}@example.com`,
      name: `Person ${authCounter}`,
      picture: `https://example.com/${authCounter}.png`,
    },
  };
}

function buildDeps(options?: {
  planTier?: "free" | "monthly_20" | "monthly_50" | "payg";
  planStatus?: "active" | "cancelled" | "expired";
  ownsCharacter?: boolean;
}) {
  const ownsCharacter = options?.ownsCharacter ?? false;
  const selectChain = {
    from() {
      return {
        where() {
          return {
            limit: async () => (ownsCharacter ? [{ id: "char-1" }] : []),
            orderBy() {
              return {
                limit: async () => [],
              };
            },
          };
        },
      };
    },
  };

  return {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: "user-1",
        firebaseUid: "firebase-uid-1",
        email: "person@example.com",
        displayName: null,
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    subscriptionService: {
      getSubscription: async () => ({
        id: "sub-1",
        userId: "user-1",
        planTier: options?.planTier ?? "monthly_20",
        planStatus: options?.planStatus ?? "active",
        currentCredits: 50,
        termsVersion: null,
        termsAcceptedAt: null,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        billingCycleStart: null,
        billingCycleEnd: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      getOrCreateDefaultSubscription: async () => ({
        id: "sub-default",
        userId: "user-1",
        planTier: "free",
        planStatus: "active",
        currentCredits: 50,
        termsVersion: null,
        termsAcceptedAt: null,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        billingCycleStart: null,
        billingCycleEnd: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    getDb: async () => ({
      select: () => selectChain,
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
    }),
  };
}

test("memoryReadHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => memoryReadHandler({ auth: null, data: { characterId: "char-1" } } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated",
  );
});

test("memoryReadHandler rejects non-premium calls", async () => {
  await assert.rejects(
    async () =>
      memoryReadHandler(
        { auth: buildAuth(), data: { characterId: "char-1" } } as never,
        buildDeps({ planTier: "free", planStatus: "active" }) as never,
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "permission-denied",
  );
});

test("memoryWriteHandler returns structured diff envelope for premium caller", async () => {
  const result = await memoryWriteHandler(
    {
      auth: buildAuth(),
      data: {
        characterId: "char-1",
        sourceText: "User asked about training plan",
      },
    } as never,
    buildDeps() as never,
  );

  assert.equal(typeof result.diff.entriesAdded, "number");
  assert.ok(result.diff.entriesAdded >= 1);
  assert.equal(Array.isArray(result.diff.entries), true);
  assert.equal(result.diff.entries[0]?.characterId, "char-1");
  assert.equal(result.diff.entries[0]?.userId, "firebase-uid-2");
  assert.equal(result.diff.eventsAppended, 1);
  assert.equal(result.diff.events[0]?.eventType, "observation");
});

test("memoryHealHandler returns empty diff for non-premium without error", async () => {
  const result = await memoryHealHandler(
    {
      auth: buildAuth(),
      data: {
        characterId: "char-1",
      },
    } as never,
    buildDeps({ planTier: "free", planStatus: "active" }) as never,
  );

  assert.deepEqual(result, {
    diff: {
      contradictionsFlagged: 0,
      staleDowngraded: 0,
      orphansRemoved: 0,
      conceptsSeeded: 0,
      entries: [],
      tasks: [],
      events: [],
    },
  });
});

test("memoryForgetHandler validates target payload", async () => {
  await assert.rejects(
    async () =>
      memoryForgetHandler(
        {
          auth: buildAuth(),
          data: { characterId: "char-1" },
        } as never,
        buildDeps() as never,
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument",
  );
});

test("syncCharacterMemoryHandler returns zero-sync summary", async () => {
  const result = await syncCharacterMemoryHandler(
    {
      auth: buildAuth(),
      data: {
        characterId: "char-1",
      },
    } as never,
    buildDeps() as never,
  );

  assert.deepEqual(result, {
    syncedEntries: 0,
    syncedTasks: 0,
    syncedEvents: 0,
  });
});