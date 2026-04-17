import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.NODE_ENV = "test";

const {acceptTermsHandler, updateUserProfileHandler} = await import("./userFunctions.js");

type AcceptTermsDeps = NonNullable<Parameters<typeof acceptTermsHandler>[1]>;
type UpdateUserProfileDeps = NonNullable<Parameters<typeof updateUserProfileHandler>[1]>;

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

function buildUpdateUserProfileDeps(overrides: Partial<UpdateUserProfileDeps> = {}): UpdateUserProfileDeps {
  const defaultDeps: UpdateUserProfileDeps = {
    userRepository: {
      findUserByFirebaseUid: async () => ({
        id: "user-1",
      } as never),
      updateUser: async () => ({
        id: "user-1",
        firebaseUid: "firebase-uid-1",
        email: "person@example.com",
        displayName: "Display",
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never),
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
  } as unknown as UpdateUserProfileDeps;

  return {
    ...defaultDeps,
    ...overrides,
    userRepository: {
      ...defaultDeps.userRepository,
      ...(overrides.userRepository ?? {}),
    },
  };
}

test("updateUserProfileHandler rejects unauthenticated requests", async () => {
  await assert.rejects(
    async () => updateUserProfileHandler({auth: null, data: {displayName: "A"}} as never),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "unauthenticated" &&
      err.message.includes("Authentication required")
  );
});

test("updateUserProfileHandler rejects invalid payload", async () => {
  await assert.rejects(
    async () =>
      updateUserProfileHandler(
        {auth, data: {displayName: 123}} as never,
        buildUpdateUserProfileDeps()
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("displayName")
  );
});

test("updateUserProfileHandler returns not-found when user does not exist", async () => {
  const deps = buildUpdateUserProfileDeps({
    userRepository: {
      findUserByFirebaseUid: async () => null,
      updateUser: async () => {
        throw new Error("Unexpected update");
      },
    },
  } as unknown as Partial<UpdateUserProfileDeps>);

  await assert.rejects(
    async () => updateUserProfileHandler({auth, data: {displayName: "A"}} as never, deps),
    (err: unknown) =>
      err instanceof HttpsError && err.code === "not-found" && err.message.includes("User not found")
  );
});

test("updateUserProfileHandler updates profile on valid payload", async () => {
  let capturedUserId = "";
  let capturedUpdates: Record<string, unknown> | null = null;

  const deps = buildUpdateUserProfileDeps({
    userRepository: {
      findUserByFirebaseUid: async () => ({id: "user-42"} as never),
      updateUser: async (userId: string, updates: Record<string, unknown>) => {
        capturedUserId = userId;
        capturedUpdates = updates;
        return {
          id: "user-42",
          firebaseUid: "firebase-uid-1",
          email: "person@example.com",
          displayName: "New Name",
          avatarUrl: "https://example.com/avatar.png",
          isProfilePublic: true,
          defaultCharacterId: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        } as never;
      },
    },
  } as unknown as Partial<UpdateUserProfileDeps>);

  const result = await updateUserProfileHandler(
    {
      auth,
      data: {
        displayName: "  New Name  ",
        avatarUrl: "https://example.com/avatar.png",
        isProfilePublic: true,
        defaultCharacterId: "",
      },
    } as never,
    deps
  );

  assert.equal(capturedUserId, "user-42");
  assert.deepEqual(capturedUpdates, {
    displayName: "New Name",
    avatarUrl: "https://example.com/avatar.png",
    isProfilePublic: true,
    defaultCharacterId: null,
  });
  assert.equal(result.id, "user-42");
  assert.equal(result.displayName, "New Name");
});
