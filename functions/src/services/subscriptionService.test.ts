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
    getDb: async () => fakeDb as never,
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

test('getOrCreateDefaultSubscription grants signup credits for new user', async () => {
  let addedCreditArgs: unknown = null;
  const mockDeps = {
    getDb: async () => ({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [{ id: 'sub-new' }],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              id: 'sub-1', userId: 'user-1', planTier: 'free', planStatus: 'active', currentCredits: 0,
              termsVersion: null, termsAcceptedAt: null, nextExpiryDate: null,
            }],
          }),
        }),
      }),
    }),
    creditService: {
      addCredits: async (userId: string, amount: number, expiresAt: Date | null, transactionType: string, referenceId?: string) => {
        addedCreditArgs = { userId, amount, expiresAt, transactionType, referenceId };
      },
    },
  } as const;

  const service = createSubscriptionService(mockDeps as never);
  const subscription = await service.getOrCreateDefaultSubscription('user-1');

  assert.equal(subscription.currentCredits, 0);
  assert.deepEqual(addedCreditArgs, {
    userId: 'user-1',
    amount: 50,
    expiresAt: null,
    transactionType: 'signup',
    referenceId: 'signup',
  });
});

test('getOrCreateDefaultSubscription skips signup credits for existing user', async () => {
  let addCreditsWasCalled = false;
  const mockDeps = {
    getDb: async () => ({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              id: 'sub-1', userId: 'user-1', planTier: 'free', planStatus: 'active', currentCredits: 50,
              termsVersion: null, termsAcceptedAt: null, nextExpiryDate: null,
            }],
          }),
        }),
      }),
    }),
    creditService: {
      addCredits: async () => { addCreditsWasCalled = true; },
    },
  } as const;

  const service = createSubscriptionService(mockDeps as never);
  await service.getOrCreateDefaultSubscription('user-1');
  assert.equal(addCreditsWasCalled, false);
});
