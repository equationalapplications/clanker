import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.NODE_ENV = "test";

const {syncCharacterHandler, deleteCharacterHandler} = await import("./characterFunctions.js");

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
