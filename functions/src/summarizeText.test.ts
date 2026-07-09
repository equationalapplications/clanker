import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {summarizeTextHandler} from "./summarizeText.js";
import type {CreditSpendAllocation} from "./services/creditService.js";

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

function makeOptions(overrides: {
  generateSummary?: (prompt: string) => Promise<string>;
  spendCreditsImpl?: (userId: string, amount: number) => Promise<CreditSpendAllocation[] | null>;
  refundCreditImpl?: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>;
} = {}) {
  return {
    generateSummary: overrides.generateSummary ?? (async () => "mock summary"),
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: "user-1",
        firebaseUid: "firebase-uid-1",
        email: "test@example.com",
        displayName: null,
        expoPushToken: null,
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    creditService: {
      spendCredits: overrides.spendCreditsImpl ?? (async () => [{transactionId: "mock-tx-id", amount: 1}]),
      refundCredit: overrides.refundCreditImpl ?? (async () => {}),
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
        makeOptions({generateSummary: async () => "unused"}),
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
    makeOptions({generateSummary: async () => " 0123456789ABCDEF "}),
  );

  assert.equal(result.summary, "0123456789AB");
});

test("summarizeTextHandler spends 1 credit before summarizing", async () => {
  const auth = buildAuth();
  let spentAmount: number | null = null;

  const result = await summarizeTextHandler(
    {
      auth,
      data: {text: "hello", maxCharacters: 50},
    } as never,
    makeOptions({
      spendCreditsImpl: async (_userId, amount) => {
        spentAmount = amount;
        return [{transactionId: "mock-tx-id", amount: 100}];
      },
    }),
  );

  assert.equal(spentAmount, 100);
  assert.equal(result.summary, "mock summary");
});

test("summarizeTextHandler rejects when credits are insufficient", async () => {
  const auth = buildAuth();

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({spendCreditsImpl: async () => null}),
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
  );
});

test("summarizeTextHandler refunds the credit when the model call fails", async () => {
  const auth = buildAuth();
  let refunded = false;

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({
          generateSummary: async () => { throw new Error("Vertex AI unavailable"); },
          refundCreditImpl: async () => { refunded = true; },
        }),
      ),
  );

  assert.equal(refunded, true);
});

test("summarizeTextHandler refunds the credit when the model returns an empty summary", async () => {
  const auth = buildAuth();
  let refunded = false;

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({
          generateSummary: async () => "   ",
          refundCreditImpl: async () => { refunded = true; },
        }),
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "internal"
  );

  assert.equal(refunded, true);
});

import { __setGenAIClientForTests } from "./services/vertexText.js";
import { getSummaryGeneratorForTests } from "./summarizeText.js";

test("summarizeText generator: retries once on retryable empty then returns text", async () => {
  let call = 0;
  __setGenAIClientForTests({
    models: {
      generateContent: async () => {
        call += 1;
        return call === 1
          ? { candidates: [{ content: { parts: [] }, finishReason: "OTHER" }] }
          : { candidates: [{ content: { parts: [{ text: "summary" }] }, finishReason: "STOP" }] };
      },
    },
  } as never);
  const gen = getSummaryGeneratorForTests();
  const out = await gen("prompt");
  assert.equal(out, "summary");
  assert.equal(call, 2);
  __setGenAIClientForTests(undefined);
});
