import assert from "node:assert/strict";
import test from "node:test";

import {createSubscriptionService} from "./services/subscriptionService.js";

test("acceptTerms bootstraps defaults before writing terms", async () => {
  let updateCalls = 0;
  let insertCalls = 0;
  let bootstrapped = false;

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: async () => {
        insertCalls += 1;
        return [];
      },
      onConflictDoNothing: async () => [],
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          updateCalls += 1;
        },
      }),
    }),
  };

  const service = createSubscriptionService({
    getDb: async () => fakeDb as never,
  });

  service.getOrCreateDefaultSubscription = async () => {
    bootstrapped = true;
    return {} as never;
  };

  await service.acceptTerms("user-1", "v1", new Date("2026-04-20T00:00:00.000Z"));

  assert.equal(bootstrapped, true);
  assert.equal(updateCalls, 1);
  assert.equal(insertCalls, 0);
});
