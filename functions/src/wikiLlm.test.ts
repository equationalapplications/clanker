import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";

import {wikiLlmHandler} from "./wikiLlm.js";
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
    nextExpiryDate: null,
    documentsIngestedCount: 0,
    documentsIngestedDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("wikiLlm: rejects unauthenticated requests", async () => {
  const request = {auth: null, data: {systemPrompt: "sys", userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest),
    (err: HttpsError) => {
      assert.equal(err.code, "unauthenticated");
      return true;
    }
  );
});

test("wikiLlm: rejects missing systemPrompt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {systemPrompt: "", userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      return true;
    }
  );
});

test("wikiLlm: rejects oversized systemPrompt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {systemPrompt: "x".repeat(32_001), userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /systemPrompt must be at most/);
      return true;
    }
  );
});

test("wikiLlm: rejects oversized userPrompt", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {systemPrompt: "sys", userPrompt: "y".repeat(500_001)}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      getSubscription: async () => buildSubscription(user.id, "monthly_20"),
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /userPrompt must be at most/);
      return true;
    }
  );
});


test("wikiLlm: rejects when insufficient credits", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const request = {auth, data: {systemPrompt: "sys", userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      creditService: {
        spendCredits: async () => null,
        refundCredit: async () => {},
      },
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "failed-precondition");
      return true;
    }
  );
});

test("wikiLlm: returns generated text when credits are available", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const mockGenerateText = async (_sys: string, _user: string) => "Generated wiki response";

  const request = {auth, data: {systemPrompt: "You are an assistant.", userPrompt: "Tell me facts."}};
  const result = await wikiLlmHandler(request as CallableRequest, {
    generateText: mockGenerateText,
    getUser: async () => user,
    creditService: {
      spendCredits: async () => "tx-123",
      refundCredit: async () => {},
    },
  });

  assert.equal(result.text, "Generated wiki response");
});

test("wikiLlm: refunds credit when generateText fails", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  let refunded = false;

  const request = {auth, data: {systemPrompt: "You are an assistant.", userPrompt: "Tell me facts."}};
  await assert.rejects(
    () => wikiLlmHandler(request as CallableRequest, {
      getUser: async () => user,
      generateText: async () => { throw new Error("Vertex failed"); },
      creditService: {
        spendCredits: async () => "tx-123",
        refundCredit: async () => { refunded = true; },
      },
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "internal");
      assert.ok(refunded, "refundCredit should be called when generation fails");
      return true;
    }
  );
});

