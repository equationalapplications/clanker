import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";

import {generateImageHandler} from "./generateImage.js";

test("generateImageHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => generateImageHandler({auth: null, data: {prompt: "Hello"}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateImageHandler validates prompt", async () => {
  await assert.rejects(
    async () =>
      generateImageHandler(
        {
          auth: {
            uid: "firebase-uid-1",
            token: {
              uid: "firebase-uid-1",
              email: "person@example.com",
            },
          },
          data: {
            prompt: "   ",
          },
        } as never,
        {
          generateImage: async () => ({
            imageBase64: "aGVsbG8=",
            mimeType: "image/png",
          }),
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );

  await assert.rejects(
    async () =>
      generateImageHandler(
        {
          auth: {
            uid: "firebase-uid-1",
            token: {
              uid: "firebase-uid-1",
              email: "person@example.com",
            },
          },
          data: {
            prompt: "x".repeat(2_001),
          },
        } as never,
        {
          generateImage: async () => ({
            imageBase64: "aGVsbG8=",
            mimeType: "image/png",
          }),
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );

  await assert.rejects(
    async () =>
      generateImageHandler(
        {
          auth: {
            uid: "firebase-uid-1",
            token: {
              uid: "firebase-uid-1",
              email: "person@example.com",
            },
          },
          data: {
            prompt: "valid prompt",
            referenceId: "x".repeat(129),
          },
        } as never,
        {
          generateImage: async () => ({
            imageBase64: "aGVsbG8=",
            mimeType: "image/png",
          }),
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("generateImageHandler spends one credit for payg users", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 3}]),
      {status: 200}
    ),
    new Response(JSON.stringify({remaining_credits: 2}), {status: 200}),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateImage test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await generateImageHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "anime cat hero portrait",
          referenceId: "image-request-123",
        },
      } as never,
      {
        generateImage: async () => ({
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
        }),
      }
    );

    assert.equal(result.imageBase64, "aGVsbG8=");
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");

    assert.equal(calls.length, 3);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions/);
    assert.match(calls[2]?.url ?? "", /spend_user_credits$/);
    const spendPayload = JSON.parse(calls[2]?.body ?? "{}") as {p_reference_id?: string};
    assert.equal(spendPayload.p_reference_id, "image-request-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImageHandler rejects unsupported mime type from model", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 3}]),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateImage test");
    }

    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateImageHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => ({
              imageBase64: "aGVsbG8=",
              mimeType: "text/html",
            }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImageHandler does not spend credit for unlimited users", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "monthly_20", current_credits: 0}]),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateImage test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await generateImageHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hero portrait",
        },
      } as never,
      {
        generateImage: async () => ({
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
        }),
      }
    );

    assert.equal(result.creditsSpent, 0);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.planTier, "monthly_20");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImageHandler rejects users without unlimited plan and no credits", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 0}]),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateImage test");
    }

    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateImageHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => ({
              imageBase64: "aGVsbG8=",
              mimeType: "image/png",
            }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "resource-exhausted"
    );

    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImageHandler does not spend credit when generation fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 3}]),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });

    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateImage test");
    }

    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateImageHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hero portrait",
            },
          } as never,
          {
            generateImage: async () => {
              throw new Error("model down");
            },
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
