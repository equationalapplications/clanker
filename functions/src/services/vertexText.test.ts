import assert from "node:assert/strict";
import test from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import {
  isRetryableEmptyResponseFinishReason,
  generateTextWithRetry,
  __setGenAIClientForTests,
} from "./vertexText.js";

function fakeClient(responses: unknown[]) {
  let call = 0;
  return {
    models: {
      generateContent: async () => {
        const r = responses[call] ?? responses[responses.length - 1];
        call += 1;
        return r;
      },
    },
    calls: () => call,
  };
}

const textResponse = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
});
const emptyResponse = (finishReason?: string) => ({
  candidates: finishReason ? [{ content: { parts: [] }, finishReason }] : [],
});

test("isRetryableEmptyResponseFinishReason: MAX_TOKENS and SAFETY are non-retryable", () => {
  assert.equal(isRetryableEmptyResponseFinishReason("MAX_TOKENS"), false);
  assert.equal(isRetryableEmptyResponseFinishReason("SAFETY"), false);
  assert.equal(isRetryableEmptyResponseFinishReason("STOP"), true);
  assert.equal(isRetryableEmptyResponseFinishReason(undefined), true);
});

test("generateTextWithRetry: returns first non-empty candidate text", async () => {
  const client = fakeClient([textResponse("hello")]);
  __setGenAIClientForTests(client as never);
  const { text } = await generateTextWithRetry({
    model: "m", contents: "hi", config: {}, logContext: "test",
  });
  assert.equal(text, "hello");
  assert.equal(client.calls(), 1);
});

test("generateTextWithRetry: retries once on retryable empty then succeeds", async () => {
  const client = fakeClient([emptyResponse("OTHER"), textResponse("ok")]);
  __setGenAIClientForTests(client as never);
  const { text } = await generateTextWithRetry({
    model: "m", contents: "hi", config: {}, logContext: "test",
  });
  assert.equal(text, "ok");
  assert.equal(client.calls(), 2);
});

test("generateTextWithRetry: retries once when candidates array is empty", async () => {
  const client = fakeClient([emptyResponse(), textResponse("ok")]);
  __setGenAIClientForTests(client as never);
  const { text } = await generateTextWithRetry({
    model: "m", contents: "hi", config: {}, logContext: "test",
  });
  assert.equal(text, "ok");
  assert.equal(client.calls(), 2);
});

test("generateTextWithRetry: does NOT retry on non-retryable finishReason", async () => {
  const client = fakeClient([emptyResponse("SAFETY"), textResponse("never")]);
  __setGenAIClientForTests(client as never);
  await assert.rejects(
    () => generateTextWithRetry({ model: "m", contents: "hi", config: {}, logContext: "test" }),
    (e: HttpsError) => e.code === "internal",
  );
  assert.equal(client.calls(), 1);
});

test("generateTextWithRetry: throws internal HttpsError after retry still empty", async () => {
  const client = fakeClient([emptyResponse("OTHER"), emptyResponse("OTHER")]);
  __setGenAIClientForTests(client as never);
  await assert.rejects(
    () => generateTextWithRetry({ model: "m", contents: "hi", config: {}, logContext: "test" }),
    (e: HttpsError) => e.code === "internal" && e.message === "Model returned an empty response.",
  );
  assert.equal(client.calls(), 2);
});
