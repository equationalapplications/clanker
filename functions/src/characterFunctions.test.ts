import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.NODE_ENV = "test";

const {syncCharacterHandler, deleteCharacterHandler, getUserCharactersHandler, getPublicCharacterHandler} = await import("./characterFunctions.js");
const {CharacterOwnershipError} = await import("./services/characterService.js");

type CharacterFunctionDeps = NonNullable<Parameters<typeof syncCharacterHandler>[1]>;

function buildDeps(): CharacterFunctionDeps {
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
    characterService: {
      getUserCharacterCount: async () => {
        throw new Error("Unexpected character service call");
      },
      getCharacterMessageCount: async () => {
        throw new Error("Unexpected character service call");
      },
      upsertCharacter: async () => {
        throw new Error("Unexpected character service call");
      },
      deleteCharacter: async () => {
        throw new Error("Unexpected character service call");
      },
      getUserCharacters: async () => {
        throw new Error("Unexpected character service call");
      },
      getPublicCharacterById: async () => {
        throw new Error("Unexpected character service call");
      },
    },
    subscriptionService: {
      getSubscription: async () => {
        throw new Error("Unexpected subscription service call");
      },
    },
  } as unknown as CharacterFunctionDeps;
}

const auth = {
  uid: "firebase-uid-1",
  token: {
    uid: "firebase-uid-1",
    email: "person@example.com",
  },
};

test("syncCharacterHandler rejects undefined payload", async () => {
  await assert.rejects(
    async () => syncCharacterHandler({auth, data: undefined} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Valid character data is required")
  );
});

test("syncCharacterHandler rejects null payload", async () => {
  await assert.rejects(
    async () => syncCharacterHandler({auth, data: null} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Valid character data is required")
  );
});

test("deleteCharacterHandler rejects undefined payload", async () => {
  await assert.rejects(
    async () => deleteCharacterHandler({auth, data: undefined} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Character ID is required")
  );
});

test("deleteCharacterHandler rejects non-string characterId", async () => {
  await assert.rejects(
    async () => deleteCharacterHandler({auth, data: {characterId: 7}} as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("Character ID is required")
  );
});

test("syncCharacterHandler rejects invalid optional text fields", async () => {
  await assert.rejects(
    async () => syncCharacterHandler({
      auth,
      data: {
        character: {
          name: "Nova",
          avatar: 42,
        },
      },
    } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("character.avatar must be a string or null")
  );
});

test("syncCharacterHandler rejects invalid optional boolean field", async () => {
  await assert.rejects(
    async () => syncCharacterHandler({
      auth,
      data: {
        character: {
          name: "Nova",
          isPublic: "true",
        },
      },
    } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "invalid-argument" &&
      err.message.includes("character.isPublic must be a boolean")
  );
});

test("syncCharacterHandler returns timestamps as ISO strings", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const updatedAt = new Date("2026-01-02T00:00:00.000Z");

  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: "Nova",
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({id: "user-1"} as never),
      },
      subscriptionService: {
        getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
      },
      characterService: {
        upsertCharacter: async () => ({
          id: "character-1",
          userId: "user-1",
          name: "Nova",
          avatar: null,
          appearance: null,
          traits: null,
          emotions: null,
          context: null,
          isPublic: false,
          createdAt,
          updatedAt,
        } as never),
      },
    } as unknown as CharacterFunctionDeps
  );

  assert.equal(typeof result.createdAt, "string");
  assert.equal(typeof result.updatedAt, "string");
  assert.equal(result.createdAt, createdAt.toISOString());
  assert.equal(result.updatedAt, updatedAt.toISOString());
});

test("syncCharacterHandler ignores client-supplied createdAt and updatedAt", async () => {
  const receivedPayloads: Array<Record<string, unknown>> = [];

  await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: "Nova",
          createdAt: "1900-01-01T00:00:00.000Z",
          updatedAt: "3000-01-01T00:00:00.000Z",
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({id: "user-1"} as never),
      },
      subscriptionService: {
        getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
      },
      characterService: {
        upsertCharacter: async (payload: unknown) => {
          receivedPayloads.push(payload as Record<string, unknown>);
          return {
            id: "character-1",
            userId: "user-1",
            name: "Nova",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          } as never;
        },
      },
    } as unknown as CharacterFunctionDeps
  );

  assert.equal(receivedPayloads.length, 1);
  assert.equal(receivedPayloads[0]?.createdAt, undefined);
  assert.equal(receivedPayloads[0]?.updatedAt, undefined);
});

test("getUserCharactersHandler returns character timestamps as ISO strings", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const updatedAt = new Date("2026-01-02T00:00:00.000Z");

  const result = await getUserCharactersHandler(
    {
      auth,
      data: {},
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({id: "user-1"} as never),
      },
      subscriptionService: {
        getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
      },
      characterService: {
        getUserCharacters: async () => ([
          {
            id: "character-1",
            userId: "user-1",
            name: "Nova",
            avatar: null,
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt,
            updatedAt,
          },
        ] as never),
      },
    } as unknown as CharacterFunctionDeps
  );

  assert.equal(result.characters.length, 1);
  assert.equal(typeof result.characters[0]?.createdAt, "string");
  assert.equal(typeof result.characters[0]?.updatedAt, "string");
  assert.equal(result.characters[0]?.createdAt, createdAt.toISOString());
  assert.equal(result.characters[0]?.updatedAt, updatedAt.toISOString());
  assert.equal(
    (result.characters[0] as Record<string, unknown>).ownerUserId,
    "firebase-uid-1"
  );
  assert.equal(
    (result.characters[0] as Record<string, unknown>).userId,
    undefined
  );
});

test("syncCharacterHandler rejects invalid timestamp value types", async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: "Nova",
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({id: "user-1"} as never),
          },
          subscriptionService: {
            getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
          },
          characterService: {
            upsertCharacter: async () => ({
              id: "character-1",
              userId: "user-1",
              name: "Nova",
              createdAt: {invalid: true},
              updatedAt: new Date("2026-01-02T00:00:00.000Z"),
            } as never),
          },
        } as unknown as CharacterFunctionDeps
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "internal" &&
      err.message.includes("Failed to sync character")
  );
});

test("syncCharacterHandler rejects users without cloud-character subscription access", async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: "Nova",
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({id: "user-1"} as never),
          },
          subscriptionService: {
            getSubscription: async () => ({planTier: "free", planStatus: "active"} as never),
          },
          characterService: {
            upsertCharacter: async () => {
              throw new Error("Unexpected character service call");
            },
          },
        } as unknown as CharacterFunctionDeps
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "permission-denied" &&
      err.message.includes("subscription is required")
  );
});

test("getUserCharactersHandler rejects users without cloud-character subscription access", async () => {
  await assert.rejects(
    async () =>
      getUserCharactersHandler(
        {
          auth,
          data: {},
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({id: "user-1"} as never),
          },
          subscriptionService: {
            getSubscription: async () => ({planTier: "free", planStatus: "active"} as never),
          },
          characterService: {
            getUserCharacters: async () => {
              throw new Error("Unexpected character service call");
            },
          },
        } as unknown as CharacterFunctionDeps
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "permission-denied" &&
      err.message.includes("subscription is required")
  );
});

test("getPublicCharacterHandler rejects users without cloud-character subscription access", async () => {
  await assert.rejects(
    async () =>
      getPublicCharacterHandler(
        {
          auth,
          data: {
            characterId: "123e4567-e89b-42d3-a456-426614174000",
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({id: "user-1"} as never),
          },
          subscriptionService: {
            getSubscription: async () => ({planTier: "free", planStatus: "active"} as never),
          },
          characterService: {
            getPublicCharacterById: async () => {
              throw new Error("Unexpected character service call");
            },
          },
        } as unknown as CharacterFunctionDeps
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "permission-denied" &&
      err.message.includes("subscription is required")
  );
});
test("getPublicCharacterHandler returns shared public character", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const updatedAt = new Date("2026-01-02T00:00:00.000Z");
  const result = await getPublicCharacterHandler(
    {
      auth,
      data: {
        characterId: "123e4567-e89b-42d3-a456-426614174000",
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({id: "user-1"} as never),
        findUserById: async (id: string) =>
          id === "owner-1"
            ? ({id: "owner-1", firebaseUid: "owner-firebase-uid"} as never)
            : null,
      },
      subscriptionService: {
        getSubscription: async () => ({planTier: "monthly_50", planStatus: "active"} as never),
      },
      characterService: {
        getPublicCharacterById: async () => ({
          id: "123e4567-e89b-42d3-a456-426614174000",
          userId: "owner-1",
          name: "Nova",
          avatar: "https://example.com/avatar.png",
          appearance: "Tall",
          traits: "Calm",
          emotions: "Happy",
          context: "Shared",
          isPublic: true,
          createdAt,
          updatedAt,
        } as never),
      },
    } as unknown as CharacterFunctionDeps
  );

  const payload = result as Record<string, unknown>;
  assert.equal(payload.id, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(payload.name, "Nova");
  assert.equal(payload.createdAt, createdAt.toISOString());
  assert.equal(payload.updatedAt, updatedAt.toISOString());
  assert.equal(payload.ownerUserId, "owner-firebase-uid");
  assert.equal(payload.userId, undefined);
});

test("syncCharacterHandler rejects when character belongs to another user", async () => {
  await assert.rejects(
    async () => syncCharacterHandler(
      {
        auth,
        data: {
          character: {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Nova",
          },
        },
      } as never,
      {
        userRepository: {
          findUserByFirebaseUid: async () => ({id: "user-1"} as never),
        },
        subscriptionService: {
          getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
        },
        characterService: {
          upsertCharacter: async () => {
            throw new CharacterOwnershipError();
          },
        },
      } as unknown as CharacterFunctionDeps
    ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "permission-denied" &&
      err.message.includes("does not belong to authenticated user")
  );
});

test("deleteCharacterHandler rejects when character belongs to another user", async () => {
  await assert.rejects(
    async () => deleteCharacterHandler(
      {
        auth,
        data: {
          characterId: "00000000-0000-4000-8000-000000000001",
        },
      } as never,
      {
        userRepository: {
          findUserByFirebaseUid: async () => ({id: "user-1"} as never),
        },
        subscriptionService: {
          getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
        },
        characterService: {
          deleteCharacter: async () => {
            throw new CharacterOwnershipError();
          },
        },
      } as unknown as CharacterFunctionDeps
    ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === "permission-denied" &&
      err.message.includes("does not belong to authenticated user")
  );
});

test("syncCharacterHandler response includes ownerUserId", async () => {
  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: "Nova",
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({id: "user-1"} as never),
      },
      subscriptionService: {
        getSubscription: async () => ({planTier: "monthly_20", planStatus: "active"} as never),
      },
      characterService: {
        upsertCharacter: async () => ({
          id: "character-1",
          userId: "user-1",
          name: "Nova",
          avatar: null,
          appearance: null,
          traits: null,
          emotions: null,
          context: null,
          isPublic: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        } as never),
      },
    } as unknown as CharacterFunctionDeps
  );

  assert.equal(
    (result as Record<string, unknown>).ownerUserId,
    "firebase-uid-1"
  );
  assert.equal((result as Record<string, unknown>).userId, undefined);
});
