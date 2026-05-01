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

function buildDump() {
  return {
    generatedAt: Date.now(),
    entities: {
      "char-1": {
        facts: [
          {
            id: "fact-1",
            entity_id: "char-1",
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
            entity_id: "char-1",
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
            entity_id: "char-1",
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

