import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.NODE_ENV = "test";

const {acceptTermsHandler} = await import("./userFunctions.js");

type AcceptTermsDeps = NonNullable<Parameters<typeof acceptTermsHandler>[1]>;

function buildDeps(): AcceptTermsDeps {
  return {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => {
        throw new Error("Unexpected repository call");
      },
      findUserByEmail: async () => {
        throw new Error("Unexpected repository call");
      },
      findUserByFirebaseUid: async () => {
        throw new Error("Unexpected repository call");
      },
      updateUser: async () => {
        throw new Error("Unexpected repository call");
      },
    },
    subscriptionService: {
      getSubscription: async () => {
        throw new Error("Unexpected subscription call");
      },
      upsertSubscription: async () => {
        throw new Error("Unexpected subscription call");
      },
      acceptTerms: async () => {
        throw new Error("Unexpected subscription call");
      },
    },
  } as unknown as AcceptTermsDeps;
}

const auth = {
  uid: "firebase-uid-1",
  token: {
    uid: "firebase-uid-1",
    email: "person@example.com",
  },
};

test("acceptTermsHandler rejects undefined payload", async () => {
  await assert.rejects(
    async () => acceptTermsHandler({auth, data: undefined} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Terms version is required")
  );
});

test("acceptTermsHandler rejects null payload", async () => {
  await assert.rejects(
    async () => acceptTermsHandler({auth, data: null} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Terms version is required")
  );
});

test("acceptTermsHandler rejects non-string termsVersion", async () => {
  await assert.rejects(
    async () => acceptTermsHandler({auth, data: {termsVersion: 123}} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Terms version is required")
  );
});

test("acceptTermsHandler rejects blank termsVersion", async () => {
  await assert.rejects(
    async () => acceptTermsHandler({auth, data: {termsVersion: "   "}} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Terms version is required")
  );
});
