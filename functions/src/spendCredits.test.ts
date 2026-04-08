import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";

import {spendCreditsHandler} from "./spendCredits.js";

test("spendCreditsHandler validates amount", async () => {
  await assert.rejects(
    async () =>
      spendCreditsHandler({
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          amount: 0,
          description: "chat message",
        },
      } as never),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("spendCreditsHandler spends credits through Supabase RPC", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(JSON.stringify({remaining_credits: 97}), {status: 200}),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in spendCredits test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await spendCreditsHandler({
      auth: {
        uid: "firebase-uid-1",
        token: {
          uid: "firebase-uid-1",
          email: "person@example.com",
        },
      },
      data: {
        amount: 3.8,
        description: "chat response",
        referenceId: "message-123",
      },
    } as never);

    assert.deepEqual(result, {
      success: true,
      result: {remaining_credits: 97},
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[1]?.url ?? "", /spend_user_credits$/);

    const payload = JSON.parse(calls[1]?.body ?? "{}");
    assert.equal(payload.p_credit_amount, 3);
    assert.equal(payload.p_description, "chat response");
    assert.equal(payload.p_reference_id, "message-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
