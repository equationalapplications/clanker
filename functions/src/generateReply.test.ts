import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {generateReplyHandler, toGenAITool, buildToolsForRequest} from "./generateReply.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;
type SubscriptionRecord = NonNullable<Awaited<ReturnType<typeof subscriptionService.getSubscription>>>;

const originalGetOrCreateUser = userRepository.getOrCreateUserByFirebaseIdentity;
const originalGetSubscription = subscriptionService.getSubscription;
const originalGetOrCreateDefaultSubscription = subscriptionService.getOrCreateDefaultSubscription;
const originalSpendCredits = creditService.spendCredits;
const originalGetCredits = creditService.getCredits;

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

function buildUser(auth: ReturnType<typeof buildAuth>): UserRecord {
  return {
    id: `user-${auth.uid}`,
    firebaseUid: auth.uid,
    email: auth.token.email,
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildSubscription(
  userId: string,
  planTier: "payg" | "monthly_20",
  currentCredits: number,
  planStatus: "active" | "cancelled" | "expired" = "active"
): SubscriptionRecord {
  return {
    id: `sub-${userId}`,
    userId,
    planTier,
    planStatus,
    currentCredits,
    termsVersion: null,
    termsAcceptedAt: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    nextExpiryDate: null,
    documentsIngestedCount: 0,
    documentsIngestedDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildStructuredRequestData(
  text = 'hello',
  characterId?: string,
  unsyncedHistory?: { id: string; role: 'user'; text: string; createdAt: number }[],
) {
  const payload: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text }] }],
    systemInstruction: 'You are a helpful AI assistant.',
  }

  if (characterId) {
    payload.characterId = characterId
  }

  if (unsyncedHistory) {
    payload.unsyncedHistory = unsyncedHistory
  }

  return payload
}

async function withServiceMocks(run: () => Promise<void>) {
  try {
    await run();
  } finally {
    userRepository.getOrCreateUserByFirebaseIdentity = originalGetOrCreateUser;
    subscriptionService.getSubscription = originalGetSubscription;
    subscriptionService.getOrCreateDefaultSubscription = originalGetOrCreateDefaultSubscription;
    creditService.spendCredits = originalSpendCredits;
    creditService.getCredits = originalGetCredits;
  }
}

test("toGenAITool maps a google_search entry to the camelCase googleSearch field", () => {
  const result = toGenAITool({ google_search: {} } as never);
  assert.deepEqual(result, { googleSearch: {} });
});

test("toGenAITool passes functionDeclarations entries through", () => {
  const functionDeclarations = [
    { name: "get_current_time", description: "Returns the current time." },
  ];
  const result = toGenAITool({ functionDeclarations } as never);
  assert.deepEqual(result, { functionDeclarations });
});

test("toGenAITool throws on an unrecognized tool entry", () => {
  assert.throws(
    () => toGenAITool({} as never),
    /Unsupported tool entry/
  );
});

test("buildToolsForRequest falls back to googleSearch when no tools are provided", () => {
  const result = buildToolsForRequest(undefined);
  assert.deepEqual(result, [{ googleSearch: {} }]);
});

test("buildToolsForRequest uses provided functionDeclarations and omits googleSearch when tools are present", () => {
  const tools = [{ name: "get_current_time", description: "Get the time", parameters: { type: "object", properties: {} } }];
  const result = buildToolsForRequest(tools);
  assert.deepEqual(result, [{ functionDeclarations: tools }]);
});

test("generateReplyHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => generateReplyHandler({auth: null, data: {prompt: "Hello"}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("generateReplyHandler validates prompt", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              prompt: "   ",
            },
          } as never,
          {
            generateText: async () => ({ text: "unused" }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
    );
  });
});

test("generateReplyHandler returns soft break for legacy prompt-only requests", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const result = await generateReplyHandler(
      {
        auth,
        data: {
          prompt: "hello legacy",
        },
      } as never,
      {
        generateText: async () => {
          throw new Error('generateText should not be invoked for legacy soft breaks')
        },
      }
    );

    assert.equal(
      result.reply,
      "🤖 **System Update:** A massive brain upgrade is available! Please update Clanker to the latest version in the App Store to continue chatting.",
    );
    assert.ok(typeof result.messageId === 'string' && result.messageId.startsWith('system-update-'))
    assert.equal(result.creditsSpent, 0)
    assert.equal(result.remainingCredits, undefined)
  });
});

test("generateReplyHandler allows intro requests with structured payload to proceed", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    let generateTextCalled = false;
    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [
            { role: 'user', parts: [{ text: 'hello intro' }] },
          ],
          systemInstruction: 'You are a helpful assistant.',
          referenceId: "intro-char-1",
        },
      } as never,
      {
        generateText: async () => {
          generateTextCalled = true;
          return { text: 'intro response' };
        },
      }
    );

    assert.ok(generateTextCalled, 'generateText should be invoked for intro requests');
    assert.equal(result.reply, 'intro response');
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
  });
});

test("generateReplyHandler rejects oversized structured contents payloads", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [
                { role: 'user', parts: [{ text: 'a'.repeat(12_001) }] },
              ],
              systemInstruction: 'You are a helpful assistant.',
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});

test("generateReplyHandler rejects malformed structured contents items", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [null],
              systemInstruction: 'You are a helpful assistant.',
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [{ role: 'user', parts: [{}] }],
              systemInstruction: 'You are a helpful assistant.',
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});

test("generateReplyHandler rejects tools with an unrecognized name", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
              systemInstruction: 'You are a helpful assistant.',
              tools: [{ name: 'delete_everything', description: 'Bad tool', parameters: { type: 'object', properties: {} } }],
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});

test("generateReplyHandler accepts recognized tools and forwards them to generateText", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const tools = [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }];
    let receivedTools: unknown;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
          systemInstruction: 'You are a helpful assistant.',
          tools,
        },
      } as never,
      {
        generateText: async (input) => {
          receivedTools = input.tools;
          return { text: 'It is noon.' };
        },
      }
    );

    assert.deepEqual(receivedTools, tools);
    assert.equal(result.reply, 'It is noon.');
  });
});

test("generateReplyHandler accepts contents with functionCall and functionResponse parts", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [
            { role: 'user', parts: [{ text: 'what time is it' }] },
            { role: 'model', parts: [{ functionCall: { name: 'get_current_time', args: {} } }] },
            { role: 'user', parts: [{ functionResponse: { name: 'get_current_time', response: { output: 'noon' } } }] },
          ],
          systemInstruction: 'You are a helpful assistant.',
        },
      } as never,
      {
        generateText: async () => ({ text: 'It is noon.' }),
      }
    );

    assert.equal(result.reply, 'It is noon.');
  });
});

test("generateReplyHandler rejects a contents part with neither text, functionCall, nor functionResponse", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [{ role: 'model', parts: [{ functionCall: { args: {} } }] }],
              systemInstruction: 'You are a helpful assistant.',
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});

test("generateReplyHandler returns functionCalls instead of throwing on an empty text response", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const functionCalls = [{ name: 'get_current_time', args: {} }];

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
          systemInstruction: 'You are a helpful assistant.',
          tools: [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }],
        },
      } as never,
      {
        generateText: async () => ({ functionCalls }),
      }
    );

    assert.deepEqual(result.functionCalls, functionCalls);
    assert.equal(result.reply, '');
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
  });
});

test("generateReplyHandler spends one credit for payg users", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return 'mock-tx-id';
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: "reply from model" }),
      }
    );

    assert.equal(result.reply, "reply from model");
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(result.planTier, "payg");
    assert.equal(result.planStatus, "active");
    assert.ok(typeof result.verifiedAt === "string" && result.verifiedAt.length > 0);
    assert.equal(spendCalls, 1);
  });
});

test("generateReplyHandler rejects users without credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "monthly_20", 0);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return null;
    };
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: buildStructuredRequestData('hello'),
          } as never,
          {
            generateText: async () => ({ text: "subscriber reply" }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );

    assert.equal(spendCalls, 1);
  });
});

test("generateReplyHandler allows cancelled plans to spend remaining credits", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3, "cancelled");
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return 'mock-tx-id';
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: "reply from model" }),
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
    assert.equal(spendCalls, 1);
  });
});

test("generateReplyHandler rejects when user has no credits and no unlimited plan", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 0);
    creditService.spendCredits = async () => null;
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: buildStructuredRequestData('hello'),
          } as never,
          {
            generateText: async () => ({ text: "unused" }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );
  });
});

test("generateReplyHandler rejects unsyncedHistory entries with non-user roles", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 4;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              ...buildStructuredRequestData('hello'),
              characterId: 'char-uuid-123',
              unsyncedHistory: [
                { id: 'msg-1', role: 'model' as const, text: 'hi', createdAt: 1_000_000 },
              ],
            },
          } as never,
          {
            generateText: async () => ({ text: "reply" }),
          }
        ),
      (err: unknown) =>
        err instanceof HttpsError &&
        err.code === "invalid-argument" &&
        /user-role messages/.test((err as Error).message)
    );
  });
});

test("generateReplyHandler validates character ownership before bulk inserting unsyncedHistory", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 4;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: (_table: unknown) => ({
        values: (_rows: unknown[]) => ({
          onConflictDoNothing: (_opts: unknown) => Promise.resolve(),
        }),
      }),
    };

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              ...buildStructuredRequestData('hello'),
              characterId: 'char-uuid-123',
              unsyncedHistory: [
                { id: 'msg-1', role: 'user' as const, text: 'hi', createdAt: 1_000_000 },
              ],
            },
          } as never,
          {
            generateText: async () => ({ text: "reply" }),
            getDb: async () => mockDb as never,
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "permission-denied"
    );
  });
});

test("generateReplyHandler does not bootstrap a subscription in the new credit flow", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let bootstrapCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => null as never;
    subscriptionService.getOrCreateDefaultSubscription = async () => {
      bootstrapCalls += 1;
      return buildSubscription(user.id, "payg", 50);
    };
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 49;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: "reply from model" }),
      }
    );

    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 49);
    assert.equal(bootstrapCalls, 0);
  });
});

test("generateReplyHandler refunds credit when model generation fails", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;
    let refundCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return 'mock-tx-id';
    };
    creditService.refundCredit = async (userId, transactionId, amount) => {
      assert.equal(userId, user.id);
      assert.equal(transactionId, 'mock-tx-id');
      assert.equal(amount, 1);
      refundCalls += 1;
    };
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: buildStructuredRequestData('hello'),
          } as never,
          {
            generateText: async () => {
              throw new Error("model down");
            },
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "internal"
    );

    assert.equal(spendCalls, 1);
    assert.equal(refundCalls, 1);
  });
});

test("generateReplyHandler preserves HttpsError from model generation and refunds credit", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let spendCalls = 0;
    let refundCalls = 0;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return 'mock-tx-id';
    };
    creditService.refundCredit = async (userId, transactionId, amount) => {
      assert.equal(userId, user.id);
      assert.equal(transactionId, 'mock-tx-id');
      assert.equal(amount, 1);
      refundCalls += 1;
    };
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: buildStructuredRequestData('hello'),
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

    assert.equal(spendCalls, 1);
    assert.equal(refundCalls, 1);
  });
});

test("generateReplyHandler maps identity conflicts to failed-precondition", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    userRepository.getOrCreateUserByFirebaseIdentity = async () => {
      throw new Error("Existing user email is linked to a different Firebase UID.");
    };
    subscriptionService.getSubscription = async () => buildSubscription("unused-user", "payg", 1);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 0;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: buildStructuredRequestData('hello'),
          } as never,
          {
            generateText: async () => ({ text: "unused" }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
    );
  });
});

test("generateReplyHandler bulk inserts unsyncedHistory before generating a reply", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 4;

    const insertedRows: unknown[] = [];
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'char-uuid-123' }],
          }),
        }),
      }),
      insert: (_table: unknown) => ({
        values: (rows: unknown[]) => {
          insertedRows.push(...rows);
          return {
            onConflictDoNothing: (_opts: unknown) => Promise.resolve(),
          };
        },
      }),
    };

    const unsyncedHistory = [
      { id: 'msg-1', role: 'user' as const, text: 'hello from edge', createdAt: 1_000_000 },
    ];

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          ...buildStructuredRequestData('continue the conversation'),
          characterId: 'char-uuid-123',
          unsyncedHistory,
        },
      } as never,
      {
        generateText: async () => ({ text: "cloud reply" }),
        getDb: async () => mockDb as never,
      }
    );

    assert.equal(result.reply, "cloud reply");
    assert.equal(insertedRows.length, 1);

    const row0 = insertedRows[0] as Record<string, unknown>;
    assert.equal(row0.messageId, 'msg-1');
    assert.equal(row0.characterId, 'char-uuid-123');
    assert.equal(row0.senderUserId, user.id);
    assert.equal(row0.text, 'hello from edge');
    assert.deepEqual(row0.createdAt, new Date(1_000_000));
  });
});

test("generateReplyHandler still returns reply when unsyncedHistory DB insert fails", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 5);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 4;

    const failingDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 'char-uuid-456' }],
          }),
        }),
      }),
      insert: (_table: unknown) => ({
        values: (_rows: unknown[]) => ({
          onConflictDoNothing: (_opts: unknown) => {
            throw new Error("DB connection refused");
          },
        }),
      }),
    };

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          ...buildStructuredRequestData('still works'),
          characterId: 'char-uuid-456',
          unsyncedHistory: [
            { id: 'msg-3', role: 'user' as const, text: 'will fail to insert', createdAt: 2_000_000 },
          ],
        },
      } as never,
      {
        generateText: async () => ({ text: "reply despite db failure" }),
        getDb: async () => failingDb as never,
      }
    );

    assert.equal(result.reply, "reply despite db failure");
    assert.equal(result.creditsSpent, 1);
  });
});

test("generateReplyHandler forwards groundingMetadata when the model grounds its reply", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const groundingMetadata = {
      webSearchQueries: ['weather in Tokyo'],
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
    };

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('what is the weather in Tokyo'),
      } as never,
      {
        generateText: async () => ({ text: 'It is sunny in Tokyo.', groundingMetadata }),
      }
    );

    assert.equal(result.reply, 'It is sunny in Tokyo.');
    assert.deepEqual(result.groundingMetadata, groundingMetadata);
  });
});

test("generateReplyHandler omits groundingMetadata when the model does not ground its reply", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: 'hi there' }),
      }
    );

    assert.equal(result.reply, 'hi there');
    assert.equal(result.groundingMetadata, undefined);
  });
});
