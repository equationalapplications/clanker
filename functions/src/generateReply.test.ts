import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {generateReplyHandler} from "./generateReply.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;
type SubscriptionRecord = NonNullable<Awaited<ReturnType<typeof subscriptionService.getSubscription>>>;

const originalGetOrCreateUser = userRepository.getOrCreateUserByFirebaseIdentity;
const originalGetSubscription = subscriptionService.getSubscription;
const originalGetOrCreateDefaultSubscription = subscriptionService.getOrCreateDefaultSubscription;
const originalSpendCredits = creditService.spendCredits;
const originalGetCredits = creditService.getCredits;

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
  currentCredits: number,
  planStatus: "active" | "cancelled" | "expired" = "active"
): SubscriptionRecord {
  return {
    id: `sub-${userId}`,
    userId,
    planTier,
    planStatus,
    currentCredits,
    termsVersion: null,
    termsAcceptedAt: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function withServiceMocks(run: () => Promise<void>) {
  try {
    await run();
  } finally {
    userRepository.getOrCreateUserByFirebaseIdentity = originalGetOrCreateUser;
    subscriptionService.getSubscription = originalGetSubscription;
    subscriptionService.getOrCreateDefaultSubscription = originalGetOrCreateDefaultSubscription;
    creditService.spendCredits = originalSpendCredits;
    creditService.getCredits = originalGetCredits;
  }
}

test("generateReplyHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => generateReplyHandler({auth: null, data: {prompt: "Hello"}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateReplyHandler validates prompt", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "   ",
            },
          } as never,
          {
            generateText: async () => "unused",
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateReplyHandler spends one credit for payg users", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async (_userId, amount, reason, referenceId) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      assert.equal(reason, "chat response");
      assert.equal(referenceId, "message-123");
      return true;
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          prompt: "hello",
          referenceId: "message-123",
        },
      } as never,
      {
        generateText: async () => "reply from model",
      }
    );

    assert.equal(result.reply, "reply from model");
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");
    assert.equal(result.planStatus, "active");
    assert.equal(typeof result.verifiedAt, "string");
    assert.equal(spendCalls, 1);
  });
});

test("generateReplyHandler does not spend credits for unlimited users", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "monthly_20", 0);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return true;
    };
    creditService.getCredits = async () => 0;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "subscriber reply",
      }
    );

    assert.equal(result.reply, "subscriber reply");
    assert.equal(result.creditsSpent, 0);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.planTier, "monthly_20");
    assert.equal(result.planStatus, "active");
    assert.equal(typeof result.verifiedAt, "string");
    assert.equal(spendCalls, 0);
  });
});

test("generateReplyHandler allows cancelled plans to spend remaining credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3, "cancelled");
    creditService.spendCredits = async (_userId, amount, reason, referenceId) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      assert.equal(reason, "chat response");
      assert.equal(referenceId, "message-cancelled");
      return true;
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          prompt: "hello",
          referenceId: "message-cancelled",
        },
      } as never,
      {
        generateText: async () => "reply from model",
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");
    assert.equal(result.planStatus, "cancelled");
    assert.equal(typeof result.verifiedAt, "string");
    assert.equal(spendCalls, 1);
  });
});

test("generateReplyHandler rejects when user has no credits and no unlimited plan", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 0);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "hello",
            },
          } as never,
          {
            generateText: async () => "unused",
          }
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "resource-exhausted" &&
        typeof (err.details as {verifiedAt?: unknown})?.verifiedAt === "string"
    );
  });
});

test("generateReplyHandler bootstraps default subscription when missing", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let bootstrapCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => null as never;
    subscriptionService.getOrCreateDefaultSubscription = async () => {
      bootstrapCalls += 1;
      return buildSubscription(user.id, "payg", 50);
    };
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 49;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "reply from model",
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 49);
    assert.equal(result.planTier, "payg");
    assert.equal(result.planStatus, "active");
    assert.equal(typeof result.verifiedAt, "string");
    assert.equal(bootstrapCalls, 1);
  });
});

test("generateReplyHandler does not spend credit when model generation fails", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return true;
    };
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "hello",
            },
          } as never,
          {
            generateText: async () => {
              throw new Error("model down");
            },
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(spendCalls, 0);
  });
});

test("generateReplyHandler preserves HttpsError from model generation", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return true;
    };
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "hello",
              referenceId: "message-123",
            },
          } as never,
          {
            generateText: async () => {
              throw new HttpsError("failed-precondition", "Vertex AI unavailable");
            },
          }
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("Vertex AI unavailable")
    );

    assert.equal(spendCalls, 0);
  });
});

test("generateReplyHandler maps identity conflicts to failed-precondition", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    userRepository.getOrCreateUserByFirebaseIdentity = async () => {
      throw new Error("Existing user email is linked to a different Firebase UID.");
    };
    subscriptionService.getSubscription = async () => buildSubscription("unused-user", "payg", 1);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "hello",
            },
          } as never,
          {
            generateText: async () => "unused",
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );
  });
});
