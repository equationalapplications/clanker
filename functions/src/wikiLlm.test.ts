import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";

import {wikiLlmHandler} from "./wikiLlm.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;
type SubscriptionRecord = NonNullable<Awaited<ReturnType<typeof subscriptionService.getSubscription>>>;

const originalGetOrCreateUser = userRepository.getOrCreateUserByFirebaseIdentity;
const originalGetSubscription = subscriptionService.getSubscription;

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
  userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
  subscriptionService.getSubscription = async () => buildSubscription(user.id, "monthly_20");

  const request = {auth, data: {systemPrompt: "", userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      return true;
    }
  );

  userRepository.getOrCreateUserByFirebaseIdentity = originalGetOrCreateUser;
  subscriptionService.getSubscription = originalGetSubscription;
});

test("wikiLlm: rejects non-premium users", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
  subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg");

  const request = {auth, data: {systemPrompt: "sys", userPrompt: "hi"}};
  await assert.rejects(
    () => wikiLlmHandler(request as unknown as CallableRequest),
    (err: HttpsError) => {
      assert.equal(err.code, "permission-denied");
      return true;
    }
  );

  userRepository.getOrCreateUserByFirebaseIdentity = originalGetOrCreateUser;
  subscriptionService.getSubscription = originalGetSubscription;
});

test("wikiLlm: returns generated text for premium users", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
  subscriptionService.getSubscription = async () => buildSubscription(user.id, "monthly_20");

  const mockGenerateText = async (_sys: string, _user: string) => "Generated wiki response";

  const request = {auth, data: {systemPrompt: "You are an assistant.", userPrompt: "Tell me facts."}};
  const result = await wikiLlmHandler(request as CallableRequest, {generateText: mockGenerateText});

  assert.equal(result.text, "Generated wiki response");

  userRepository.getOrCreateUserByFirebaseIdentity = originalGetOrCreateUser;
  subscriptionService.getSubscription = originalGetSubscription;
});
