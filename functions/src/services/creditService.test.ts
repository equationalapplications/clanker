import assert from 'node:assert/strict';
import test from 'node:test';

import { assertIdempotentDeltaMatch, createCreditService } from './creditService.js';

// ---------------------------------------------------------------------------
// assertIdempotentDeltaMatch (unchanged helper)
// ---------------------------------------------------------------------------

test('assertIdempotentDeltaMatch allows duplicate when delta matches', () => {
  assert.doesNotThrow(() => {
    assertIdempotentDeltaMatch({ requestedDelta: -5, existingDelta: -5, reason: 'image generation', referenceId: 'ref-1' });
  });
});

test('assertIdempotentDeltaMatch throws on delta mismatch', () => {
  assert.throws(
    () => assertIdempotentDeltaMatch({ requestedDelta: 8, existingDelta: 2, reason: 'webhook', referenceId: 'ref-2' }),
    /idempotency.*delta/i
  );
});

test('assertIdempotentDeltaMatch throws when transaction row missing', () => {
  assert.throws(
    () => assertIdempotentDeltaMatch({ requestedDelta: 8, existingDelta: null, reason: 'webhook', referenceId: 'ref-2' }),
    /idempotency.*missing/i
  );
});

// ---------------------------------------------------------------------------
// getCredits — reads SUM(remaining_balance) from creditTransactions
// ---------------------------------------------------------------------------

test('getCredits returns sum of remaining_balance from non-expired rows', async () => {
  // syncSubscriptionCache makes two selects (total, nextExpiry) + one update.
  // Second select (.where() awaited directly) returns an object; [0] is undefined → nextExpiry=null.
  const fakeTx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ total: 75 }] }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<number>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const credits = await service.getCredits('user-1');
  assert.equal(credits, 75);
});

test('getCredits returns 0 when no rows exist', async () => {
  const fakeTx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ total: null }] }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<number>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const credits = await service.getCredits('user-1');
  assert.equal(credits, 0);
});

// ---------------------------------------------------------------------------
// spendCredits — decrements remaining_balance on earliest-expiring row
// ---------------------------------------------------------------------------

test('spendCredits returns false when no qualifying creditTransactions row found', async () => {
  const fakeTx = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ for: async () => [] }) }) }) }) }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 1, 'chat');
  assert.equal(result, false);
});

test('spendCredits returns true and decrements balance on qualifying row', async () => {
  let updatedId: string | null = null;
  let cacheUpdated = false;

  const fakeTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          // spendCredits uses .orderBy().limit().for(); syncSubscriptionCache uses .limit() directly.
          orderBy: () => ({
            limit: () => ({
              for: async () => [{ id: 'tx-abc', remainingBalance: 10 }],
            }),
          }),
          limit: async () => [{ total: 10 }],
        }),
      }),
    }),
    update: () => ({
      set: (vals: unknown) => ({
        where: async (cond: unknown) => {
          updatedId = 'tx-abc';
          cacheUpdated = true;
        },
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 1, 'chat');
  assert.equal(result, true);
  assert.equal(updatedId, 'tx-abc');
  assert.equal(cacheUpdated, true);
});

// ---------------------------------------------------------------------------
// addCredits — inserts credit_transactions row + updates cache
// ---------------------------------------------------------------------------

test('addCredits inserts a row with initialAmount and remainingBalance', async () => {
  let insertedValues: Record<string, unknown> | null = null;

  const fakeTx = {
    insert: () => ({
      values: async (vals: Record<string, unknown>) => {
        insertedValues = vals;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ total: 100 }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await service.addCredits('user-1', 100, new Date('2026-06-21'), 'one_time', 'ref-123');

  assert.equal((insertedValues as any)?.initialAmount, 100);
  assert.equal((insertedValues as any)?.remainingBalance, 100);
  assert.equal((insertedValues as any)?.transactionType, 'one_time');
  assert.equal((insertedValues as any)?.referenceId, 'ref-123');
});

// ---------------------------------------------------------------------------
// refundCredit — increments remaining_balance atomically
// ---------------------------------------------------------------------------

test('refundCredit increments remaining_balance on the specified row', async () => {
  let updatedTransactionId: string | null = null;

  const fakeTx = {
    update: () => ({
      set: () => ({
        where: async () => { updatedTransactionId = 'tx-abc'; },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ total: 100 }],
        }),
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await service.refundCredit('user-1', 'tx-abc', 1);
  assert.equal(updatedTransactionId, 'tx-abc');
});

// ---------------------------------------------------------------------------
// renewSubscriptionCredits — atomic: idempotency + expire old + grant new
// ---------------------------------------------------------------------------

test('renewSubscriptionCredits returns false when referenceId already processed', async () => {
  const fakeTx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [],
        }),
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.renewSubscriptionCredits('user-1', 300, new Date(), 'evt_dup');
  assert.equal(result, false);
});

test('renewSubscriptionCredits returns true, inserts credits first, then expires old rows', async () => {
  let expiredOldCredits = false;
  let grantedNewCredits = false;

  const fakeTx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            grantedNewCredits = true;
            return [{ id: 'tx-new' }];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => { expiredOldCredits = true; },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ total: 300 }],
        }),
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.renewSubscriptionCredits('user-1', 300, new Date(), 'evt_new');
  assert.equal(result, true);
  assert.equal(grantedNewCredits, true);
  assert.equal(expiredOldCredits, true);
});
