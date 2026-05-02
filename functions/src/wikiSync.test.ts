import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";

import {wikiSyncHandler, MemoryDump} from "./wikiSync.js";
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

test("wikiSync: rejects missing dump.generatedAt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const request = {auth, data: {dump: {entities: {}}}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /dump\.generatedAt must be a finite number/);
      return true;
    }
  );
});

test("wikiSync: rejects NaN dump.generatedAt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const request = {auth, data: {dump: {generatedAt: NaN, entities: {}}}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /dump\.generatedAt must be a finite number/);
      return true;
    }
  );
});

test("wikiSync: rejects Infinity dump.generatedAt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const request = {auth, data: {dump: {generatedAt: Infinity, entities: {}}}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /dump\.generatedAt must be a finite number/);
      return true;
    }
  );
});

test("wikiSync: rejects non-string tag element", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{
          id: "f1",
          entity_id: TEST_ENTITY_UUID,
          title: "T",
          body: "B",
          confidence: "inferred",
          tags: ["ok", 42], // 42 is not a string
          source_ref: null,
          source_hash: null,
          created_at: 1000,
          updated_at: 1001,
        }],
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
      assert.match(err.message, /tags\[1\] must be a string/);
      return true;
    }
  );
});

test("wikiSync: rejects non-string source_ref", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{
          id: "f1",
          entity_id: TEST_ENTITY_UUID,
          title: "T",
          body: "B",
          confidence: "inferred",
          tags: [],
          source_ref: 123, // should be string or null
          source_hash: null,
          created_at: 1000,
          updated_at: 1001,
        }],
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
      assert.match(err.message, /source_ref must be a string or null/);
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

test("wikiSync: rejects fact with mismatched entity_id", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const OTHER_UUID = "00000000-0000-0000-0000-000000000002";
  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{
          id: "f1",
          entity_id: OTHER_UUID, // doesn't match entity key
          title: "T",
          body: "B",
          confidence: "inferred",
          tags: [],
          source_ref: null,
          source_hash: null,
          created_at: 1000,
          updated_at: 1001,
        }],
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
      assert.match(err.message, /entity_id must match the entity key/);
      return true;
    }
  );
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

test("wikiSync: rejects non-numeric resolved_at on task", async () => {
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
          status: "done",
          priority: 0,
          created_at: 1000,
          updated_at: 1001,
          resolved_at: "not-a-number", // must be number or null
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
      assert.match(err.message, /resolved_at must be a number or null/);
      return true;
    }
  );
});

// LWW: verify that the upsertData injection receives the full dump and that an
// in-memory implementation correctly keeps the newer version of a conflicting fact.
test("wikiSync: last-write-wins semantics via upsertData injection", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  // In-memory store keyed by fact id — simulates the cloud SQL LWW behaviour.
  const store = new Map<string, {body: string; updated_at: number}>();

  const upsertData = async (dump: MemoryDump) => {
    for (const bundle of Object.values(dump.entities)) {
      for (const fact of bundle.facts ?? []) {
        const existing = store.get(fact.id);
        // Only overwrite if incoming updated_at is strictly newer (LWW rule).
        if (!existing || fact.updated_at > existing.updated_at) {
          store.set(fact.id, {body: fact.body, updated_at: fact.updated_at});
        }
      }
    }
  };
  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => ({generatedAt: Date.now(), entities: {}});

  const baseFact = {
    id: "lww-fact",
    entity_id: TEST_ENTITY_UUID,
    title: "T",
    confidence: "inferred",
    tags: [],
    source_ref: null,
    source_hash: null,
  };

  // First sync: newer version (updated_at=200).
  const newerDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{...baseFact, body: "newer body", created_at: 100, updated_at: 200}],
        tasks: [],
        events: [],
      },
    },
  };
  await wikiSyncHandler({auth, data: {dump: newerDump}} as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });
  assert.equal(store.get("lww-fact")?.body, "newer body");

  // Second sync: older version (updated_at=50) — should NOT overwrite.
  const olderDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{...baseFact, body: "older body", created_at: 100, updated_at: 50}],
        tasks: [],
        events: [],
      },
    },
  };
  await wikiSyncHandler({auth, data: {dump: olderDump}} as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });
  // LWW: newer version (body="newer body") must survive the stale update.
  assert.equal(store.get("lww-fact")?.body, "newer body", "stale update must not overwrite newer version");
});

test("wikiSync: propagates tombstones (deleted_at) for cross-device deletion", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const baseFact = {
    id: "deletion-fact",
    entity_id: TEST_ENTITY_UUID,
    title: "T",
    body: "content",
    confidence: "inferred",
    tags: [],
    source_ref: null,
    source_hash: null,
    created_at: 100,
  };

  // Client imports a normal (non-deleted) fact.
  const importDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{...baseFact, updated_at: 100}],
        tasks: [],
        events: [],
      },
    },
  };

  // Cloud SQL state: the same fact but with deleted_at set on another device.
  // fetchMergedDump returns this tombstone so deletion propagates.
  const remoteDumpWithTombstone = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [{...baseFact, updated_at: 200, deleted_at: 200}],
        tasks: [],
        events: [],
      },
    },
  };

  let upsertCalled = false;
  const upsertData = async (dump: MemoryDump) => {
    upsertCalled = true;
    // Verify that upsertData receives the client's importDump (non-deleted).
    const fact = dump.entities[TEST_ENTITY_UUID]?.facts?.[0];
    assert(fact, "importDump must be passed to upsertData");
  };

  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => remoteDumpWithTombstone;

  const result = await wikiSyncHandler({auth, data: {dump: importDump}} as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });

  assert(upsertCalled, "upsertData must be called");

  // Verify that remoteDump includes the tombstone for client merge.
  const remoteFact = result.remoteDump.entities[TEST_ENTITY_UUID]?.facts?.[0];
  assert(remoteFact, "remoteDump must include the fact");
  assert.equal(remoteFact.deleted_at, 200, "tombstone deleted_at must be included in remoteDump");
  assert.equal(remoteFact.updated_at, 200, "tombstone updated_at must be included in remoteDump");
});

/** Helper: build a minimal valid fact for a given entityId. */
function buildFact(entityId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "f1",
    entity_id: entityId,
    title: "T",
    body: "B",
    confidence: "inferred",
    tags: [],
    source_ref: null,
    source_hash: null,
    created_at: 1000,
    updated_at: 1001,
    ...overrides,
  };
}

function buildDumpWithFact(fact: Record<string, unknown>): object {
  return {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {facts: [fact], tasks: [], events: []},
    },
  };
}

async function rejectsFact(
  user: ReturnType<typeof buildUser>,
  auth: ReturnType<typeof buildAuth>,
  fact: Record<string, unknown>,
  messagePattern: RegExp
): Promise<void> {
  const request = {auth, data: {dump: buildDumpWithFact(fact)}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, messagePattern);
      return true;
    }
  );
}

test("wikiSync: rejects invalid confidence value", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {confidence: "unknown"}), /confidence must be one of/);
});

test("wikiSync: rejects invalid source_type value", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {source_type: "bad_type"}), /source_type must be one of/);
});

test("wikiSync: rejects float last_accessed_at", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {last_accessed_at: 1.5}), /last_accessed_at must be an integer/);
});

test("wikiSync: rejects NaN last_accessed_at", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {last_accessed_at: NaN}), /last_accessed_at must be an integer/);
});

test("wikiSync: rejects Infinity last_accessed_at", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {last_accessed_at: Infinity}), /last_accessed_at must be an integer/);
});

test("wikiSync: rejects float access_count", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {access_count: 1.5}), /access_count must be a non-negative integer/);
});

test("wikiSync: rejects negative access_count", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  await rejectsFact(user, auth, buildFact(TEST_ENTITY_UUID, {access_count: -1}), /access_count must be a non-negative integer/);
});

test("wikiSync: accepts fact with null optional fields", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const fact = buildFact(TEST_ENTITY_UUID, {
    source_type: null,
    last_accessed_at: null,
    access_count: null,
    deleted_at: null,
  });
  const request = {auth, data: {dump: buildDumpWithFact(fact)}};
  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => ({generatedAt: Date.now(), entities: {}});
  const upsertData = async () => {};
  const result = await wikiSyncHandler(request as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });
  assert.ok(result.remoteDump, "should return remoteDump");
});

test("wikiSync: accepts fact with valid optional fields set", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const fact = buildFact(TEST_ENTITY_UUID, {
    source_type: "user_stated",
    last_accessed_at: 1000000,
    access_count: 5,
  });
  const request = {auth, data: {dump: buildDumpWithFact(fact)}};
  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => ({generatedAt: Date.now(), entities: {}});
  const upsertData = async () => {};
  const result = await wikiSyncHandler(request as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });
  assert.ok(result.remoteDump, "should return remoteDump");
});

const ENTITY_A = "00000000-0000-0000-0000-000000000010";
const ENTITY_B = "00000000-0000-0000-0000-000000000011";

// These tests verify that wikiSyncHandler correctly passes through multi-entity
// fetchMergedDump results (including tombstones) in the remoteDump.  The injected
// fetchMergedDump simulates what the real window-function SQL queries would return.
test("wikiSync: remoteDump includes tombstones from multiple entities", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const multiEntityDump = {
    generatedAt: Date.now(),
    entities: {
      [ENTITY_A]: {
        facts: [{
          id: "fa1",
          entity_id: ENTITY_A,
          title: "Deleted Fact",
          body: "was here",
          confidence: "inferred",
          tags: [],
          source_ref: null,
          source_hash: null,
          created_at: 100,
          updated_at: 200,
          deleted_at: 200,  // tombstone
        }],
        tasks: [],
        events: [],
      },
      [ENTITY_B]: {
        facts: [{
          id: "fb1",
          entity_id: ENTITY_B,
          title: "Live Fact",
          body: "still here",
          confidence: "certain",
          tags: [],
          source_ref: null,
          source_hash: null,
          created_at: 100,
          updated_at: 150,
          deleted_at: null,
        }],
        tasks: [],
        events: [],
      },
    },
  };

  const importDump = {
    generatedAt: Date.now(),
    entities: {
      [ENTITY_A]: {facts: [], tasks: [], events: []},
      [ENTITY_B]: {facts: [], tasks: [], events: []},
    },
  };

  const result = await wikiSyncHandler({auth, data: {dump: importDump}} as unknown as CallableRequest, {
    upsertData: async () => {},
    validateEntityOwnership: async () => {},
    fetchMergedDump: async () => multiEntityDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });

  // Both entities must be in remoteDump
  assert.ok(result.remoteDump.entities[ENTITY_A], "entity A must be in remoteDump");
  assert.ok(result.remoteDump.entities[ENTITY_B], "entity B must be in remoteDump");

  // Tombstone must be propagated for entity A
  const tombstone = result.remoteDump.entities[ENTITY_A]?.facts?.[0];
  assert.ok(tombstone, "tombstone fact must be included");
  assert.equal(tombstone.deleted_at, 200, "tombstone deleted_at must be preserved");

  // Live fact from entity B must be present
  const liveFact = result.remoteDump.entities[ENTITY_B]?.facts?.[0];
  assert.ok(liveFact, "live fact must be included");
  assert.equal(liveFact.deleted_at, null, "live fact must not be deleted");
});

test("wikiSync: fetchMergedDump is called with all entity ids from the dump", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const calledWith: string[][] = [];
  const fakeFetchMergedDump = async (entityIds: string[]) => {
    calledWith.push([...entityIds]);
    return {generatedAt: Date.now(), entities: {}};
  };

  const importDump = {
    generatedAt: Date.now(),
    entities: {
      [ENTITY_A]: {facts: [], tasks: [], events: []},
      [ENTITY_B]: {facts: [], tasks: [], events: []},
    },
  };

  await wikiSyncHandler({auth, data: {dump: importDump}} as unknown as CallableRequest, {
    upsertData: async () => {},
    validateEntityOwnership: async () => {},
    fetchMergedDump: fakeFetchMergedDump,
    getUser: async () => user,
    getSubscription: async () => buildSubscription(user.id, "monthly_20"),
  });

  assert.equal(calledWith.length, 1, "fetchMergedDump must be called exactly once");
  const passedIds = calledWith[0];
  assert.ok(passedIds.includes(ENTITY_A), "entity A must be passed to fetchMergedDump");
  assert.ok(passedIds.includes(ENTITY_B), "entity B must be passed to fetchMergedDump");
});


