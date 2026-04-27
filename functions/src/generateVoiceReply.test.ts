import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {
  generateVoiceReplyHandler,
  __test__,
} from "./generateVoiceReply.js";

const {isRawPcmMimeType: testIsRawPcmMimeType, buildWavHeader: testBuildWavHeader, wrapPcmAsWav: testWrapPcmAsWav} = __test__;
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

test("isRawPcmMimeType detects raw PCM formats", async () => {
  // Should detect audio/L16 variants
  assert.equal(testIsRawPcmMimeType("audio/L16"), true);
  assert.equal(testIsRawPcmMimeType("audio/L16;codec=pcm;rate=24000"), true);
  assert.equal(testIsRawPcmMimeType("AUDIO/L16"), true);
  assert.equal(testIsRawPcmMimeType("Audio/L16;codec=pcm"), true);

  // Should detect audio/pcm variants
  assert.equal(testIsRawPcmMimeType("audio/pcm"), true);
  assert.equal(testIsRawPcmMimeType("AUDIO/PCM"), true);
  assert.equal(testIsRawPcmMimeType("audio/pcm;rate=48000"), true);

  // Should not detect other formats
  assert.equal(testIsRawPcmMimeType("audio/wav"), false);
  assert.equal(testIsRawPcmMimeType("audio/mpeg"), false);
  assert.equal(testIsRawPcmMimeType("audio/mp3"), false);
  assert.equal(testIsRawPcmMimeType("audio/ogg"), false);
});

test("buildWavHeader generates valid RIFF WAV header", async () => {
  const pcmByteLength = 1000;
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;

  const header = testBuildWavHeader(pcmByteLength, sampleRate, numChannels, bitsPerSample);

  // Header must be exactly 44 bytes
  assert.equal(header.length, 44, "WAV header must be 44 bytes");

  // Verify RIFF header signature
  assert.equal(header.toString("ascii", 0, 4), "RIFF", "Bytes 0-3 should be RIFF");

  // Verify file size field (36 + pcmByteLength)
  const fileSizeField = header.readUInt32LE(4);
  assert.equal(fileSizeField, 36 + pcmByteLength, "File size field should match PCM length + 36");

  // Verify WAVE marker
  assert.equal(header.toString("ascii", 8, 12), "WAVE", "Bytes 8-11 should be WAVE");

  // Verify fmt subchunk
  assert.equal(header.toString("ascii", 12, 16), "fmt ", "Bytes 12-15 should be 'fmt '");
  assert.equal(header.readUInt32LE(16), 16, "Subchunk1Size should be 16 for PCM");
  assert.equal(header.readUInt16LE(20), 1, "Audio format should be 1 (PCM)");

  // Verify channel count
  assert.equal(header.readUInt16LE(22), numChannels, "NumChannels should match input");

  // Verify sample rate
  assert.equal(header.readUInt32LE(24), sampleRate, "SampleRate should match input");

  // Verify byte rate (SampleRate * NumChannels * BitsPerSample/8)
  const expectedByteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  assert.equal(header.readUInt32LE(28), expectedByteRate, "ByteRate calculation incorrect");

  // Verify block align (NumChannels * BitsPerSample/8)
  const expectedBlockAlign = (numChannels * bitsPerSample) / 8;
  assert.equal(header.readUInt16LE(32), expectedBlockAlign, "BlockAlign calculation incorrect");

  // Verify bits per sample
  assert.equal(header.readUInt16LE(34), bitsPerSample, "BitsPerSample should match input");

  // Verify data chunk marker
  assert.equal(header.toString("ascii", 36, 40), "data", "Bytes 36-39 should be 'data'");

  // Verify data chunk size
  assert.equal(header.readUInt32LE(40), pcmByteLength, "Data chunk size should match PCM length");
});

test("wrapPcmAsWav produces valid WAV container", async () => {
  // Create test PCM data (100 bytes of silence)
  const pcmBuffer = Buffer.alloc(100);
  const pcmBase64 = pcmBuffer.toString("base64");
  const mimeType = "audio/L16;codec=pcm;rate=24000;channels=1;bits=16";

  const wrappedBase64 = testWrapPcmAsWav(pcmBase64, mimeType);
  const wrappedBuffer = Buffer.from(wrappedBase64, "base64");

  // Wrapped buffer should be 44 bytes header + 100 bytes PCM = 144 bytes
  assert.equal(wrappedBuffer.length, 144, "Wrapped audio should be 44 (header) + 100 (PCM) = 144 bytes");

  // Verify WAV header structure
  assert.equal(wrappedBuffer.toString("ascii", 0, 4), "RIFF", "Should start with RIFF");
  assert.equal(wrappedBuffer.toString("ascii", 8, 12), "WAVE", "Should contain WAVE marker");
  assert.equal(wrappedBuffer.toString("ascii", 36, 40), "data", "Should contain data chunk marker");

  // Verify file size in header matches actual size
  const fileSizeField = wrappedBuffer.readUInt32LE(4);
  assert.equal(fileSizeField, 36 + 100, "File size field should be 36 + PCM size");

  // Verify data chunk size matches PCM length
  const dataSizeField = wrappedBuffer.readUInt32LE(40);
  assert.equal(dataSizeField, 100, "Data chunk size should match PCM length");
});

test("wrapPcmAsWav handles missing MIME parameters with defaults", async () => {
  const pcmBuffer = Buffer.alloc(50);
  const pcmBase64 = pcmBuffer.toString("base64");

  // MIME type with no parameters - should use defaults
  const wrappedBase64 = testWrapPcmAsWav(pcmBase64, "audio/L16");
  const wrappedBuffer = Buffer.from(wrappedBase64, "base64");

  // Should still produce valid WAV
  assert.equal(wrappedBuffer.toString("ascii", 0, 4), "RIFF", "Should be valid WAV");

  // Verify default sample rate (24000)
  assert.equal(wrappedBuffer.readUInt32LE(24), 24000, "Should use default sample rate of 24000");

  // Verify default channels (1)
  assert.equal(wrappedBuffer.readUInt16LE(22), 1, "Should use default channels of 1");

  // Verify default bits per sample (16)
  assert.equal(wrappedBuffer.readUInt16LE(34), 16, "Should use default bits per sample of 16");
});

test("parsePcmParam does not mis-match partial parameter names", async () => {
  const pcmBuffer = Buffer.alloc(50);
  const pcmBase64 = pcmBuffer.toString("base64");

  // 'bitrate' must not cause 'rate' extraction to return 48000
  const wrappedBase64 = testWrapPcmAsWav(pcmBase64, "audio/L16;bitrate=48000;rate=24000");
  const wrappedBuffer = Buffer.from(wrappedBase64, "base64");

  // rate=24000 should win, not bitrate=48000
  assert.equal(wrappedBuffer.readUInt32LE(24), 24000,
    "Should extract rate=24000, not the 'rate' substring of bitrate=48000");
});

test("parsePcmParam extracts rate when bitrate appears first", async () => {
  const pcmBuffer = Buffer.alloc(50);
  const pcmBase64 = pcmBuffer.toString("base64");

  // bitrate=48000 appears before rate=24000; rate should still extract 24000
  const wrappedBase64 = testWrapPcmAsWav(pcmBase64, "audio/L16;bitrate=48000;rate=24000");
  const wrappedBuffer = Buffer.from(wrappedBase64, "base64");

  assert.equal(wrappedBuffer.readUInt32LE(24), 24000,
    "Should extract rate=24000, not the 'rate' substring of bitrate=48000");
});
