import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {summarizeTextHandler} from "./summarizeText.js";

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

test("summarizeTextHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => summarizeTextHandler({auth: null, data: {text: "hello", maxCharacters: 100}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("summarizeTextHandler validates input payload", async () => {
  const auth = buildAuth();

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {
          auth,
          data: {
            text: "   ",
            maxCharacters: 200,
          },
        } as never,
        {
          generateSummary: async () => "unused",
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("summarizeTextHandler enforces maxCharacters upper bound", async () => {
  const auth = buildAuth();

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {
          auth,
          data: {
            text: "hello",
            maxCharacters: 4001,
          },
        } as never,
        {
          generateSummary: async () => "unused",
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("summarizeTextHandler trims and truncates generated summary", async () => {
  const auth = buildAuth();

  const result = await summarizeTextHandler(
    {
      auth,
      data: {
        text: "Long conversation transcript",
        maxCharacters: 12,
      },
    } as never,
    {
      generateSummary: async () => " 0123456789ABCDEF ",
    }
  );

  assert.equal(result.summary, "0123456789AB");
});
