import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";

import {wikiSyncHandler} from "./wikiSync.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;
type SubscriptionRecord = NonNullable<Awaited<ReturnType<typeof subscriptionService.getSubscription>>>;

let authCounter = 0;

function buildAuth() {
  authCounter += 1;
  const uid = `firebase-uid-${authCounter}`;
  return {
    uid,
    token: {
      uid,
      email: `person-${authCounter}@example.com`,
    },
  };
}

function buildUser(auth: ReturnType<typeof buildAuth>): UserRecord {
  return {
    id: `user-${auth.uid}`,
    firebaseUid: auth.uid,
    email: auth.token.email,
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildSubscription(
  userId: string,
  planTier: "payg" | "monthly_20",
  planStatus: "active" | "cancelled" | "expired" = "active"
): SubscriptionRecord {
  return {
    id: `sub-${userId}`,
    userId,
    planTier,
    planStatus,
    currentCredits: 10,
    termsVersion: null,
    termsAcceptedAt: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    documentsIngestedCount: 0,
    documentsIngestedDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const TEST_ENTITY_UUID = "00000000-0000-0000-0000-000000000001";

function buildDump() {
  return {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [
          {
            id: "fact-1",
            entity_id: TEST_ENTITY_UUID,
            title: "Test Fact",
            body: "Some body",
            confidence: "inferred",
            tags: ["a", "b"],
            source_ref: null,
            source_hash: null,
            created_at: 1000000,
            updated_at: 1000001,
          },
        ],
        tasks: [
          {
            id: "task-1",
            entity_id: TEST_ENTITY_UUID,
            description: "Do something",
            status: "pending",
            priority: 1,
            created_at: 1000000,
            updated_at: 1000001,
            resolved_at: null,
          },
        ],
        events: [
          {
            id: "event-1",
            entity_id: TEST_ENTITY_UUID,
            event_type: "observation",
            summary: "Something happened",
            created_at: 1000000,
          },
        ],
      },
    },
  };
}

test("wikiSync: rejects unauthenticated requests", async () => {
  const request = {auth: null, data: {dump: buildDump()}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest),
    (err: HttpsError) => {
      assert.equal(err.code, "unauthenticated");
      return true;
    }
  );
});

test("wikiSync: rejects missing dump", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      return true;
    }
  );
});

test("wikiSync: rejects non-UUID entity keys", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      "not-a-uuid": {facts: [], tasks: [], events: []},
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.equal(err.message, `Entity key "not-a-uuid" is not a valid UUID.`);
      return true;
    }
  );
});

test("wikiSync: rejects malformed fact (missing required field)", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{ id: "f1", entity_id: TEST_ENTITY_UUID /* missing title, body, etc */ }],
        tasks: [],
        events: [],
      },
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /facts\[0\]\.title must be a non-empty string/);
      return true;
    }
  );
});

test("wikiSync: rejects malformed task (non-numeric priority)", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [],
        tasks: [{
          id: "t1",
          entity_id: TEST_ENTITY_UUID,
          description: "Do it",
          status: "pending",
          priority: "high", // should be number
          created_at: 1000,
          updated_at: 1001,
        }],
        events: [],
      },
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /tasks\[0\]\.priority must be a finite number/);
      return true;
    }
  );
});

test("wikiSync: rejects too many facts per entity", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const tooManyFacts = Array.from({length: 501}, (_, i) => ({
    id: `fact-${i}`,
    entity_id: TEST_ENTITY_UUID,
    title: `Fact ${i}`,
    body: "body",
    confidence: "inferred",
    tags: [],
    source_ref: null,
    source_hash: null,
    created_at: 1000,
    updated_at: 1001,
  }));
  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {facts: tooManyFacts, tasks: [], events: []},
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /more than 500 facts/);
      return true;
    }
  );
});


test("wikiSync: rejects non-premium users", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {dump: buildDump()}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "payg"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "permission-denied");
      return true;
    }
  );
});

test("wikiSync: accepts valid dump for premium user", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const upserted: unknown[] = [];
  const upsertEntries = async (entries: unknown[]) => {
    upserted.push(...entries);
  };
  const validateEntityOwnership = async () => { /* ownership validated by test setup */ };
  const fetchMergedDump = async () => ({ generatedAt: Date.now(), entities: {} });

  const request = {auth, data: {dump: buildDump()}};
  const result = await wikiSyncHandler(request as CallableRequest, {
    upsertEntries,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });

  assert.ok(result.remoteDump, "should return remoteDump");
  assert.equal(upserted.length, 1);
});

test("wikiSync: rejects cancelled subscription", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {dump: buildDump()}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20", "cancelled"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "permission-denied");
      return true;
    }
  );
});

