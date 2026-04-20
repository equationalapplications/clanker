import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {generateImageHandler} from "./generateImage.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;
type SubscriptionRecord = NonNullable<Awaited<ReturnType<typeof subscriptionService.getSubscription>>>;

const originalGetOrCreateUser = userRepository.getOrCreateUserByFirebaseIdentity;
const originalGetSubscription = subscriptionService.getSubscription;
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
    creditService.spendCredits = originalSpendCredits;
    creditService.getCredits = originalGetCredits;
  }
}

test("generateImageHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => generateImageHandler({auth: null, data: {prompt: "Hello"}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateImageHandler validates prompt", async () => {
  const auth = buildAuth();
  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateImageHandler(
          {
            auth,
            data: {
              prompt: "   ",
            },
          } as never,
          {
            generateImage: async () => ({
              imageBase64: "aGVsbG8=",
              mimeType: "image/png",
            }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateImageHandler spends one credit for payg users", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async (_userId, amount, reason, referenceId) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      assert.equal(reason, "image generation");
      assert.equal(referenceId, "image-request-123");
      return true;
    };
    creditService.getCredits = async () => 2;

    const result = await generateImageHandler(
      {
        auth,
        data: {
          prompt: "anime cat hero portrait",
          referenceId: "image-request-123",
        },
      } as never,
      {
        generateImage: async () => ({
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
        }),
      }
    );

    assert.equal(result.imageBase64, "aGVsbG8=");
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");
    assert.equal(spendCalls, 1);
  });
});

test("generateImageHandler rejects unsupported mime type from model", async () => {
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
        generateImageHandler(
          {
            auth,
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => ({
              imageBase64: "aGVsbG8=",
              mimeType: "text/html",
            }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(spendCalls, 0);
  });
});

test("generateImageHandler does not spend credit for unlimited users", async () => {
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

    const result = await generateImageHandler(
      {
        auth,
        data: {
          prompt: "hero portrait",
        },
      } as never,
      {
        generateImage: async () => ({
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
        }),
      }
    );

    assert.equal(result.creditsSpent, 0);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.planTier, "monthly_20");
    assert.equal(spendCalls, 0);
  });
});

test("generateImageHandler allows cancelled plans to spend remaining credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3, "cancelled");
    creditService.spendCredits = async (_userId, amount, reason, referenceId) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      assert.equal(reason, "image generation");
      assert.equal(referenceId, "image-cancelled");
      return true;
    };
    creditService.getCredits = async () => 2;

    const result = await generateImageHandler(
      {
        auth,
        data: {
          prompt: "hero portrait",
          referenceId: "image-cancelled",
        },
      } as never,
      {
        generateImage: async () => ({
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
        }),
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");
    assert.equal(spendCalls, 1);
  });
});

test("generateImageHandler rejects users without unlimited plan and no credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 0);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateImageHandler(
          {
            auth,
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => ({
              imageBase64: "aGVsbG8=",
              mimeType: "image/png",
            }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "resource-exhausted"
    );
  });
});

test("generateImageHandler does not spend credit when generation fails", async () => {
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
        generateImageHandler(
          {
            auth,
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => {
              throw new Error("model down");
            },
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(spendCalls, 0);
  });
});
