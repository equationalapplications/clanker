import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {spendCreditsHandler} from "./spendCredits.js";
import {userRepository} from "./services/userRepository.js";
import {creditService} from "./services/creditService.js";

type UserRecord = NonNullable<Awaited<ReturnType<typeof userRepository.findUserByFirebaseUid>>>;

const originalFindUser = userRepository.findUserByFirebaseUid;
const originalSpendCredits = creditService.spendCredits;

function buildUser(uid: string, email: string): UserRecord {
  return {
    id: `user-${uid}`,
    firebaseUid: uid,
    email,
    displayName: null,
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function withServiceMocks(run: () => Promise<void>) {
  try {
    await run();
  } finally {
    userRepository.findUserByFirebaseUid = originalFindUser;
    creditService.spendCredits = originalSpendCredits;
  }
}

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

test("spendCreditsHandler calls credit service with floored amount", async () => {
  await withServiceMocks(async () => {
    const uid = "firebase-uid-1";
    const email = "person@example.com";
    const user = buildUser(uid, email);

    let spendCalls = 0;

    userRepository.findUserByFirebaseUid = async () => user;
    creditService.spendCredits = async (userId, amount, description, referenceId) => {
      spendCalls += 1;
      assert.equal(userId, user.id);
      assert.equal(amount, 3);
      assert.equal(description, "chat response");
      assert.equal(referenceId, "message-123");
      return true;
    };

    const result = await spendCreditsHandler({
      auth: {
        uid,
        token: {
          uid,
          email,
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
    });
    assert.equal(spendCalls, 1);
  });
});

test("spendCreditsHandler throws resource-exhausted when spend fails", async () => {
  await withServiceMocks(async () => {
    const uid = "firebase-uid-2";
    const email = "low-balance@example.com";
    const user = buildUser(uid, email);

    userRepository.findUserByFirebaseUid = async () => user;
    creditService.spendCredits = async () => false;

    await assert.rejects(
      async () =>
        spendCreditsHandler({
          auth: {
            uid,
            token: {
              uid,
              email,
            },
          },
          data: {
            amount: 1,
            description: "chat response",
          },
        } as never),
      (err: unknown) => err instanceof HttpsError && err.code === "resource-exhausted"
    );
  });
});
