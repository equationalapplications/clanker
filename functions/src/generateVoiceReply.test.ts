import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {generateVoiceReplyHandler} from "./generateVoiceReply.js";
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
  planTier: "payg" | "monthly_20" | "monthly_50",
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

const stubGenerateText = async () => "Hello, this is the AI reply.";
const stubSynthesizeSpeech = async () => ({audioBase64: "dGVzdA==", audioMimeType: "audio/wav"});

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

test("generateVoiceReplyHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () =>
      generateVoiceReplyHandler(
        {auth: null, data: {prompt: "Hello", characterVoice: "Kore"}} as never,
        {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateVoiceReplyHandler rejects missing prompt", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "   ", characterVoice: "Kore"}} as never,
          {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateVoiceReplyHandler rejects missing characterVoice", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "hello", characterVoice: ""}} as never,
          {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateVoiceReplyHandler rejects prompt exceeding max length", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {
            auth,
            data: {
              prompt: "x".repeat(12_001),
              characterVoice: "Kore",
            },
          } as never,
          {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateVoiceReplyHandler rejects when user has fewer than 2 credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 1);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 1;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
          {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "resource-exhausted" &&
        typeof (err.details as {verifiedAt?: unknown})?.verifiedAt === "string"
    );
  });
});

test("generateVoiceReplyHandler spends 2 credits for payg users", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async (_userId, amount, reason, referenceId) => {
      spendCalls += 1;
      assert.equal(amount, 2);
      assert.equal(reason, "voice reply");
      assert.equal(referenceId, "msg-ref-1");
      return true;
    };
    creditService.getCredits = async () => 3;

    const result = await generateVoiceReplyHandler(
      {
        auth,
        data: {
          prompt: "hello",
          characterVoice: "Kore",
          referenceId: "msg-ref-1",
        },
      } as never,
      {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
    );

    assert.equal(result.creditsSpent, 2);
    assert.equal(result.remainingCredits, 3);
    assert.equal(result.planTier, "payg");
    assert.equal(result.planStatus, "active");
    assert.equal(typeof result.verifiedAt, "string");
    assert.equal(spendCalls, 1);
  });
});

test("generateVoiceReplyHandler does not spend credits for monthly_20 users", async () => {
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

    const result = await generateVoiceReplyHandler(
      {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
      {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
    );

    assert.equal(result.creditsSpent, 0);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.planTier, "monthly_20");
    assert.equal(result.planStatus, "active");
    assert.equal(spendCalls, 0);
  });
});

test("generateVoiceReplyHandler does not spend credits when text generation fails", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return true;
    };
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
          {
            generateText: async () => {
              throw new Error("model down");
            },
            synthesizeSpeech: stubSynthesizeSpeech,
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(spendCalls, 0);
  });
});

test("generateVoiceReplyHandler does not spend credits when speech synthesis fails", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return true;
    };
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
          {
            generateText: stubGenerateText,
            synthesizeSpeech: async () => {
              throw new HttpsError("internal", "TTS unavailable");
            },
          }
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "internal" &&
        err.message.includes("TTS unavailable")
    );

    assert.equal(spendCalls, 0);
  });
});

test("generateVoiceReplyHandler returns non-empty audioBase64 in payload", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    const result = await generateVoiceReplyHandler(
      {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
      {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
    );

    assert.ok(result.audioBase64.length > 0, "audioBase64 should be non-empty");
    assert.ok(result.audioMimeType.length > 0, "audioMimeType should be non-empty");
    assert.ok(result.replyText.length > 0, "replyText should be non-empty");
    assert.ok(result.rawReplyText.length > 0, "rawReplyText should be non-empty");
  });
});

test("generateVoiceReplyHandler maps identity conflicts to failed-precondition", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    userRepository.getOrCreateUserByFirebaseIdentity = async () => {
      throw new Error("Existing user email is linked to a different Firebase UID.");
    };
    subscriptionService.getSubscription = async () => buildSubscription("unused-user", "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    await assert.rejects(
      async () =>
        generateVoiceReplyHandler(
          {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
          {generateText: stubGenerateText, synthesizeSpeech: stubSynthesizeSpeech}
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );
  });
});

test("generateVoiceReplyHandler works with raw PCM from synthesizeSpeech mock", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => true;
    creditService.getCredits = async () => 3;

    // Create a minimal valid PCM buffer (100 bytes of zeros)
    const pcmBuffer = Buffer.alloc(100);
    const pcmBase64 = pcmBuffer.toString("base64");

    const result = await generateVoiceReplyHandler(
      {auth, data: {prompt: "hello", characterVoice: "Kore"}} as never,
      {
        generateText: stubGenerateText,
        // In real production, getSpeechSynthesizer wraps raw PCM.
        // This mock simulates synthesizeSpeech returning raw PCM.
        synthesizeSpeech: async () => ({
          audioBase64: pcmBase64,
          audioMimeType: "audio/L16;codec=pcm;rate=24000",
        }),
      }
    );

    // Handler should return whatever synthesizeSpeech provides
    assert.equal(result.audioMimeType, "audio/L16;codec=pcm;rate=24000");
    assert.ok(result.audioBase64.length > 0, "audioBase64 should be non-empty");
    assert.ok(result.replyText.length > 0, "replyText should be non-empty");
  });
});
