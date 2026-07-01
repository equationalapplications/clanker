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
  let selectCalls = 0;
  const mockDeps = {
    getDb: async () => ({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [{ id: 'sub-1' }],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCalls += 1;
              if (selectCalls === 1) {
                return [{
                  id: 'sub-1', userId: 'user-1', planTier: 'free', planStatus: 'active', currentCredits: 0,
                  termsVersion: null, termsAcceptedAt: null, nextExpiryDate: null,
                }];
              }
              return [];
            },
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

test('getOrCreateDefaultSubscription grants signup credits when subscription row was pre-created but no credit rows exist', async () => {
  let addedCreditArgs: unknown = null;
  let selectCalls = 0;

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
            limit: async () => {
              selectCalls += 1;
              if (selectCalls === 1) {
                return [{
                  id: 'sub-1', userId: 'user-1', planTier: 'free', planStatus: 'active', currentCredits: 0,
                  termsVersion: null, termsAcceptedAt: null, nextExpiryDate: null,
                }];
              }
              return [];
            },
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
  await service.getOrCreateDefaultSubscription('user-1');

  assert.deepEqual(addedCreditArgs, {
    userId: 'user-1',
    amount: 50,
    expiresAt: null,
    transactionType: 'signup',
    referenceId: 'signup',
  });
});

test('getOrCreateDefaultSubscription does not add signup credits when existing user already has credit rows', async () => {
  let addCreditsWasCalled = false;
  let selectCalls = 0;

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
            limit: async () => {
              selectCalls += 1;
              if (selectCalls === 1) {
                return [{
                  id: 'sub-1', userId: 'user-1', planTier: 'free', planStatus: 'active', currentCredits: 50,
                  termsVersion: null, termsAcceptedAt: null, nextExpiryDate: null,
                }];
              }
              return [{
                id: 'tx-1', userId: 'user-1', delta: 50, reason: 'signup', referenceId: 'signup',
                initialAmount: 50, remainingBalance: 50, transactionType: 'signup', expiresAt: null,
              }];
            },
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
  assert.equal(selectCalls, 3);
});

test('upsertSubscription writes subscriptionProvider and cancelAtPeriodEnd on insert and update', async () => {
  let insertValues: Record<string, unknown> | null = null;
  let updateSet: Record<string, unknown> | null = null;

  const fakeDb = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues = values;
        return {
          onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
            updateSet = args.set;
            return {
              returning: async () => [{ ...values, ...args.set }],
            };
          },
        };
      },
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });

  await service.upsertSubscription({
    userId: 'user-1',
    planTier: 'monthly_20',
    planStatus: 'active',
    subscriptionProvider: 'stripe',
    cancelAtPeriodEnd: true,
  });

  assert.equal((insertValues as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, 'stripe');
  assert.equal((insertValues as { cancelAtPeriodEnd?: unknown } | null)?.cancelAtPeriodEnd, true);
  assert.equal((updateSet as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, 'stripe');
  assert.equal((updateSet as { cancelAtPeriodEnd?: unknown } | null)?.cancelAtPeriodEnd, true);
});

test('upsertSubscription passing null for subscriptionProvider clears it on update', async () => {
  let updateSet: Record<string, unknown> | null = null;

  const fakeDb = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
          updateSet = args.set;
          return { returning: async () => [{ ...values, ...args.set }] };
        },
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });

  await service.upsertSubscription({
    userId: 'user-1',
    planTier: 'free',
    planStatus: 'cancelled',
    subscriptionProvider: null,
  });

  assert.equal((updateSet as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, null);
});

test('findUserIdByStripeCustomerId returns the matching userId', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ userId: 'user-42' }],
        }),
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });
  const userId = await service.findUserIdByStripeCustomerId('cus_123');

  assert.equal(userId, 'user-42');
});

test('findUserIdByStripeCustomerId returns null when no match', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });
  const userId = await service.findUserIdByStripeCustomerId('cus_missing');

  assert.equal(userId, null);
});
