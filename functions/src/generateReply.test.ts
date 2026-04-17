import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SUPABASE_URL = "https://supabase.example.co";

import {generateReplyHandler} from "./generateReply.js";

test("generateReplyHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => generateReplyHandler({auth: null, data: {prompt: "Hello"}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateReplyHandler validates prompt", async () => {
  await assert.rejects(
    async () =>
      generateReplyHandler(
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
          generateText: async () => "unused",
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );

  await assert.rejects(
    async () =>
      generateReplyHandler(
        {
          auth: {
            uid: "firebase-uid-1",
            token: {
              uid: "firebase-uid-1",
              email: "person@example.com",
            },
          },
          data: {
            prompt: "x".repeat(12_001),
          },
        } as never,
        {
          generateText: async () => "unused",
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );

  await assert.rejects(
    async () =>
      generateReplyHandler(
        {
          auth: {
            uid: "firebase-uid-1",
            token: {
              uid: "firebase-uid-1",
              email: "person@example.com",
            },
          },
          data: {
            prompt: "hello",
            referenceId: "x".repeat(129),
          },
        } as never,
        {
          generateText: async () => "unused",
        }
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("generateReplyHandler spends one credit for payg users", async () => {
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
      throw new Error("Unexpected fetch call in generateReply test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
          referenceId: "message-123",
        },
      } as never,
      {
        generateText: async () => "reply from model",
      }
    );

    assert.equal(result.reply, "reply from model");
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");

    assert.equal(calls.length, 3);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions/);
    assert.match(calls[2]?.url ?? "", /spend_user_credits$/);

    const spendPayload = JSON.parse(calls[2]?.body ?? "{}");
    assert.equal(spendPayload.p_credit_amount, 1);
    assert.equal(spendPayload.p_reference_id, "message-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler does not spend credit when model generation fails", async () => {
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
      throw new Error("Unexpected fetch call in generateReply test");
    }

    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hello",
              referenceId: "message-123",
            },
          } as never,
          {
            generateText: async () => {
              throw new Error("model down");
            },
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler preserves HttpsError from model generation", async () => {
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
      throw new Error("Unexpected fetch call in generateReply test");
    }

    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hello",
              referenceId: "message-123",
            },
          } as never,
          {
            generateText: async () => {
              throw new HttpsError("failed-precondition", "Vertex AI unavailable");
            },
          }
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "failed-precondition" &&
        err.message.includes("Vertex AI unavailable")
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler does not spend credits for unlimited users", async () => {
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
      throw new Error("Unexpected fetch call in generateReply test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "subscriber reply",
      }
    );

    assert.equal(result.reply, "subscriber reply");
    assert.equal(result.creditsSpent, 0);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.planTier, "monthly_20");

    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /user_app_subscriptions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler falls back to email lookup when UID lookup misses", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{url: string; body: string}> = [];

  const responses = [
    new Response(JSON.stringify(null), {status: 200}),
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
      throw new Error("Unexpected fetch call in generateReply test");
    }

    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "reply from model",
      }
    );

    assert.equal(result.reply, "reply from model");
    assert.equal(calls.length, 3);
    assert.match(calls[0]?.url ?? "", /get_user_id_by_firebase_uid$/);
    assert.match(calls[1]?.url ?? "", /get_user_id_by_email$/);
    assert.match(calls[2]?.url ?? "", /user_app_subscriptions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler rejects when user has no credits and no unlimited plan", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 0}]),
      {status: 200}
    ),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hello",
            },
          } as never,
          {
            generateText: async () => "unused",
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "resource-exhausted"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler returns expected response shape", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 2}]),
      {status: 200}
    ),
    new Response(JSON.stringify({remaining_credits: 1}), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "shape-check",
      }
    );

    assert.deepEqual(result, {
      reply: "shape-check",
      creditsSpent: 1,
      remainingCredits: 1,
      planTier: "payg",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler rejects invalid spend_user_credits payload", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 2}]),
      {status: 200}
    ),
    new Response(JSON.stringify({unexpected: "value"}), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth: {
              uid: "firebase-uid-1",
              token: {
                uid: "firebase-uid-1",
                email: "person@example.com",
              },
            },
            data: {
              prompt: "hello",
            },
          } as never,
          {
            generateText: async () => "shape-check",
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler accepts array spend_user_credits payload", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 2}]),
      {status: 200}
    ),
    new Response(JSON.stringify([{remaining_credits: 1}]), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "shape-check",
      }
    );

    assert.equal(result.remainingCredits, 1);
    assert.equal(result.creditsSpent, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler accepts numeric spend_user_credits payload", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 2}]),
      {status: 200}
    ),
    new Response(JSON.stringify(1), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "shape-check",
      }
    );

    assert.equal(result.remainingCredits, 1);
    assert.equal(result.creditsSpent, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateReplyHandler accepts boolean spend_user_credits payload", async () => {
  const originalFetch = globalThis.fetch;

  const responses = [
    new Response(JSON.stringify("supabase-user-id"), {status: 200}),
    new Response(
      JSON.stringify([{plan_tier: "payg", current_credits: 2}]),
      {status: 200}
    ),
    new Response(JSON.stringify(true), {status: 200}),
  ];

  globalThis.fetch = (async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected fetch call in generateReply test");
    }
    return next;
  }) as typeof fetch;

  try {
    const result = await generateReplyHandler(
      {
        auth: {
          uid: "firebase-uid-1",
          token: {
            uid: "firebase-uid-1",
            email: "person@example.com",
          },
        },
        data: {
          prompt: "hello",
        },
      } as never,
      {
        generateText: async () => "shape-check",
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
