import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {generateEmbeddingHandler, computeEmbeddingCreditCost} from "./generateEmbedding.js";
import type {CreditSpendAllocation} from "./services/creditService.js";

let counter = 0;
function buildAuth() {
  counter += 1;
  const uid = `uid-${counter}`;
  return { uid, token: { uid, email: `user-${counter}@example.com` } };
}

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);
const mockEmbedder = async (_text: string, _taskType: string) => MOCK_EMBEDDING;

function makeOptions(overrides: {
  embedder?: (text: string, taskType: string) => Promise<number[]>;
  spendCreditsImpl?: (userId: string, amount: number) => Promise<CreditSpendAllocation[] | null>;
  refundCreditImpl?: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>;
} = {}) {
  return {
    embedder: overrides.embedder ?? mockEmbedder,
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

test("generateEmbedding: rejects unauthenticated request", async () => {
  const request = { auth: null, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "unauthenticated");
      return true;
    }
  );
});

test("generateEmbedding: rejects missing or invalid request data", async () => {
  const auth = buildAuth();
  const invalidRequests = [
    { auth, data: null },
    { auth, data: undefined },
    { auth, data: "not-an-object" },
    { auth, data: 123 },
    { auth, data: [] },
  ] as Array<{ auth: unknown; data: unknown }>;

  for (const request of invalidRequests) {
    await assert.rejects(
      () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
      (err: HttpsError) => {
        assert.equal(err.code, "invalid-argument");
        assert.match(err.message, /Request data must be an object/i);
        return true;
      }
    );
  }
});

test("generateEmbedding: rejects empty text", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /text/i);
      return true;
    }
  );
});

test("generateEmbedding: rejects whitespace-only text", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "   " } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /text/i);
      return true;
    }
  );
});

test("generateEmbedding: rejects text over max length", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "x".repeat(8_001) } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /8000/);
      return true;
    }
  );
});

test("generateEmbedding: accepts text of exactly max length", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "x".repeat(8_000) } };
  const result = await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions()
  );
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

test("generateEmbedding: rejects invalid taskType", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello", taskType: "INVALID_TYPE" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /taskType/);
      return true;
    }
  );
});

test("generateEmbedding: returns embedding for valid request", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "Tell me about dragons." } };
  const result = await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions()
  );
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

test("generateEmbedding: passes taskType to embedder", async () => {
  const auth = buildAuth();
  const capturedArgs: { text: string; taskType: string }[] = [];
  const trackingEmbedder = async (text: string, taskType: string) => {
    capturedArgs.push({ text, taskType });
    return MOCK_EMBEDDING;
  };

  const request = { auth, data: { text: "hello", taskType: "RETRIEVAL_QUERY" } };
  await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: trackingEmbedder }));
  assert.equal(capturedArgs.length, 1);
  assert.equal(capturedArgs[0].taskType, "RETRIEVAL_QUERY");
});

test("generateEmbedding: defaults taskType to RETRIEVAL_DOCUMENT", async () => {
  const auth = buildAuth();
  const capturedArgs: { text: string; taskType: string }[] = [];
  const trackingEmbedder = async (text: string, taskType: string) => {
    capturedArgs.push({ text, taskType });
    return MOCK_EMBEDDING;
  };

  const request = { auth, data: { text: "hello" } };
  await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: trackingEmbedder }));
  assert.equal(capturedArgs[0].taskType, "RETRIEVAL_DOCUMENT");
});

test("generateEmbedding: wraps embedder errors as HttpsError internal", async () => {
  const auth = buildAuth();
  const failingEmbedder = async (_text: string, _taskType: string): Promise<number[]> => {
    throw new Error("Vertex AI exploded");
  };
  const request = { auth, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: failingEmbedder })),
    (err: HttpsError) => {
      assert.equal(err.code, "internal");
      return true;
    }
  );
});

test("generateEmbedding: throttles a single user after too many requests within the window", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello" } };

  // Throttle limit is 20 requests/minute per user.
  for (let i = 0; i < 20; i++) {
    await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions());
  }

  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "resource-exhausted");
      return true;
    }
  );
});

test("generateEmbedding: does not throttle a different user", async () => {
  const throttledAuth = buildAuth();
  const throttledRequest = { auth: throttledAuth, data: { text: "hello" } };
  for (let i = 0; i < 20; i++) {
    await generateEmbeddingHandler(throttledRequest as unknown as CallableRequest, makeOptions());
  }

  const otherAuth = buildAuth();
  const otherRequest = { auth: otherAuth, data: { text: "hello" } };
  const result = await generateEmbeddingHandler(otherRequest as unknown as CallableRequest, makeOptions());
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

// ── Billing ──────────────────────────────────────────────────────────────────

test("generateEmbedding: spends 1 credit for a request under 50,000 characters", async () => {
  const auth = buildAuth();
  let spentAmount: number | null = null;
  const request = { auth, data: { text: "hello" } };

  await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions({
      spendCreditsImpl: async (_userId, amount) => {
        spentAmount = amount;
        return [{ transactionId: "mock-tx-id", amount }];
      },
    }),
  );

  assert.equal(spentAmount, 100);
});

test("generateEmbedding: rejects when credits are insufficient", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello" } };

  await assert.rejects(
    () =>
      generateEmbeddingHandler(
        request as unknown as CallableRequest,
        makeOptions({ spendCreditsImpl: async () => null }),
      ),
    (err: HttpsError) => {
      assert.equal(err.code, "failed-precondition");
      return true;
    }
  );
});

test("generateEmbedding: refunds the credit when the embedder fails", async () => {
  const auth = buildAuth();
  let refunded = false;
  const request = { auth, data: { text: "hello" } };

  await assert.rejects(() =>
    generateEmbeddingHandler(
      request as unknown as CallableRequest,
      makeOptions({
        embedder: async () => { throw new Error("Vertex AI exploded"); },
        refundCreditImpl: async () => { refunded = true; },
      }),
    ),
  );

  assert.equal(refunded, true);
});

test("computeEmbeddingCreditCost: 1 credit under 50,000 characters", () => {
  assert.equal(computeEmbeddingCreditCost(1), 100);
  assert.equal(computeEmbeddingCreditCost(50_000), 100);
});

test("computeEmbeddingCreditCost: 2 credits at 50,001 characters", () => {
  assert.equal(computeEmbeddingCreditCost(50_001), 200);
});
