import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {generateEmbeddingHandler} from "./generateEmbedding.js";

let counter = 0;
function buildAuth() {
  counter += 1;
  const uid = `uid-${counter}`;
  return { uid, token: { uid, email: `user-${counter}@example.com` } };
}

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);
const mockEmbedder = async (_text: string, _taskType: string) => MOCK_EMBEDDING;

test("generateEmbedding: rejects unauthenticated request", async () => {
  const request = { auth: null, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
      () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
    { embedder: mockEmbedder }
  );
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

test("generateEmbedding: rejects invalid taskType", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello", taskType: "INVALID_TYPE" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: mockEmbedder }),
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
    { embedder: mockEmbedder }
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
  await generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: trackingEmbedder });
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
  await generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: trackingEmbedder });
  assert.equal(capturedArgs[0].taskType, "RETRIEVAL_DOCUMENT");
});

test("generateEmbedding: wraps embedder errors as HttpsError internal", async () => {
  const auth = buildAuth();
  const failingEmbedder = async (_text: string, _taskType: string): Promise<number[]> => {
    throw new Error("Vertex AI exploded");
  };
  const request = { auth, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, { embedder: failingEmbedder }),
    (err: HttpsError) => {
      assert.equal(err.code, "internal");
      return true;
    }
  );
});
