import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionService } from './subscriptionService.js';

test('upsertSubscription defaults first insert credits to 50 when omitted', async () => {
  let insertValues: Record<string, unknown> | null = null;

  const fakeDb = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues = values;
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [values],
          }),
        };
      },
    }),
  };

  const service = createSubscriptionService({
    getDb: async () => fakeDb as any,
  });

  const upserted = await service.upsertSubscription({
    userId: 'user-1',
    planTier: 'free',
    planStatus: 'active',
  });

  const insertedCredits = (insertValues as { currentCredits?: unknown } | null)?.currentCredits;
  const upsertedCredits = (upserted as { currentCredits?: unknown } | null)?.currentCredits;

  assert.equal(insertedCredits, 50);
  assert.equal(upsertedCredits, 50);
});
