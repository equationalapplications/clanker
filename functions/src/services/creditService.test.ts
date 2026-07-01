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
  // syncSubscriptionCache makes two selects: (1) total with .limit(), (2) nextExpiry awaited directly.
  let selectCount = 0;
  const fakeTx = {
    select: () => {
      selectCount++;
      return {
        from: () => ({
          where: () => {
            const rows = selectCount % 2 !== 0 ? [{ total: 75 }] : [{ minExpiry: null }];
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      };
    },
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
  let selectCount = 0;
  const fakeTx = {
    select: () => {
      selectCount++;
      return {
        from: () => ({
          where: () => {
            const rows = selectCount % 2 !== 0 ? [{ total: null }] : [{ minExpiry: null }];
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      };
    },
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

test('spendCredits returns null when no qualifying creditTransactions row found', async () => {
  // select() call order: (1) subscriptions lock, (2) net balance check → 0 → InsufficientCreditsError.
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],  // subscriptions FOR UPDATE lock
    [{ total: 0 }],           // net balance → insufficient
  ];
  let selectIdx = 0;
  const fakeTx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
      }),
    }),
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
          }),
        }),
      };
    },
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>, _opts?: unknown) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 1);
  assert.equal(result, null);
});

test('spendCredits returns transactionId and decrements balance on qualifying row', async () => {
  let updatedId: string | null = null;
  let cacheUpdated = false;

  // select() call order:
  // 1. subscriptions FOR UPDATE lock
  // 2. net balance check → 10
  // 3. credit_transactions row FOR UPDATE lock → tx-abc
  // 4. syncSubscriptionCache total
  // 5. syncSubscriptionCache nextExpiry
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ total: 10 }],
    [{ id: 'tx-abc', remainingBalance: 10 }],
    [{ total: 9 }],
    [{ minExpiry: null }],
    [],
  ];
  let selectIdx = 0;

  const fakeTx = {
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
            orderBy: () => ({
              limit: () => ({ for: async () => rows }),
              for: async () => rows,
            }),
          }),
        }),
      };
    },
    update: () => ({
      set: (_vals: unknown) => ({
        where: async (_cond: unknown) => {
          updatedId = 'tx-abc';
          cacheUpdated = true;
        },
      }),
    }),
    insert: () => ({
      values: (_vals: unknown) => ({
        onConflictDoNothing: (_opts: unknown) => ({})
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>, _opts?: unknown) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 1);
  assert.equal(result, 'tx-abc');
  assert.equal(updatedId, 'tx-abc');
  assert.equal(cacheUpdated, true);
  assert.equal(selectIdx, 6);
});

test('spendCredits spends across multiple rows when balance is fragmented', async () => {
  let decrementCount = 0;

  // select() call order:
  // 1. subscriptions FOR UPDATE lock
  // 2. net balance check → 2 (>= amount)
  // 3. spend rows FOR UPDATE → two rows of 1 each (fragmented)
  // 4. syncSubscriptionCache total
  // 5. syncSubscriptionCache nextExpiry
  // 6. syncSubscriptionCache existing sub
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ total: 2 }],
    [{ id: 'tx-early', remainingBalance: 1 }, { id: 'tx-late', remainingBalance: 1 }],
    [{ total: 0 }],
    [{ minExpiry: null }],
    [],
  ];
  let selectIdx = 0;

  const fakeTx = {
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
            orderBy: () => ({ for: async () => rows }),
          }),
        }),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (vals && 'remainingBalance' in vals) decrementCount++;
        },
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: (_opts?: unknown) => ({}) }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>, _opts?: unknown) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 2);
  assert.equal(result, 'tx-early');       // earliest row id returned for refund
  assert.equal(decrementCount, 2);        // both fragmented rows decremented
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

  const iv = insertedValues as unknown as Record<string, unknown>;
  assert.equal(iv?.initialAmount, 100);
  assert.equal(iv?.remainingBalance, 100);
  assert.equal(iv?.transactionType, 'one_time');
  assert.equal(iv?.referenceId, 'ref-123');
});

// ---------------------------------------------------------------------------
// refundCredit — increments remaining_balance atomically (UPDATE+RETURNING)
// ---------------------------------------------------------------------------

test('refundCredit increments remaining_balance on the specified row', async () => {
  let returningCalled = false;

  // select() calls come from syncSubscriptionCache: (1) total, (2) nextExpiry.
  let selectCount = 0;
  const fakeTx = {
    update: () => ({
      set: () => ({
        where: () => Object.assign(Promise.resolve(undefined), {
          returning: async () => { returningCalled = true; return [{ id: 'tx-abc' }]; },
        }),
      }),
    }),
    insert: () => ({ values: async () => {} }),
    select: () => {
      selectCount++;
      return {
        from: () => ({
          where: () => {
            const rows = selectCount % 2 !== 0 ? [{ total: 100 }] : [{ minExpiry: null }];
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      };
    },
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await service.refundCredit('user-1', 'tx-abc', 1);
  assert.equal(returningCalled, true);
});

test('refundCredit inserts compensation row when original transaction is expired', async () => {
  let insertedValues: Record<string, unknown> | null = null;

  let selectCount = 0;
  const fakeTx = {
    update: () => ({
      set: () => ({
        where: () => Object.assign(Promise.resolve(undefined), {
          returning: async () => [],  // row expired → nothing matched
        }),
      }),
    }),
    insert: () => ({
      values: async (vals: Record<string, unknown>) => { insertedValues = vals; },
    }),
    select: () => {
      selectCount++;
      return {
        from: () => ({
          where: () => {
            const rows = selectCount % 2 !== 0 ? [{ total: 1 }] : [{ minExpiry: null }];
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      };
    },
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await service.refundCredit('user-1', 'tx-expired', 1);
  assert.ok(insertedValues, 'compensation row should be inserted');
  assert.equal((insertedValues as Record<string, unknown>).remainingBalance, 1);
  assert.equal((insertedValues as Record<string, unknown>).expiresAt, null);
  assert.equal((insertedValues as Record<string, unknown>).reason, 'refund_compensation');
});

// ---------------------------------------------------------------------------
// setCredits — atomic: lock + insert + expire old active rows + sync cache
// ---------------------------------------------------------------------------

test('setCredits inserts a non-expiring row, expires other active rows, and syncs the cache', async () => {
  let insertCount = 0;
  let insertedCtValues: Record<string, unknown> | null = null;
  let expiredOldRows = false;

  // select call order:
  // 1. subscriptions FOR UPDATE lock
  // 2. syncSubscriptionCache: total
  // 3. syncSubscriptionCache: nextExpiry (no .limit)
  // 4. syncSubscriptionCache: existing sub
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ total: 100 }],
    [{ minExpiry: null }],
    [{ currentCredits: 0, nextExpiryDate: null }],
  ];
  let selectIdx = 0;

  const fakeTx = {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertCount++;
        if (insertCount === 2) insertedCtValues = vals;
        return {
          onConflictDoNothing: (_opts?: unknown) => Object.assign(Promise.resolve({}), {
            returning: async () => insertCount >= 2 ? [{ id: 'tx-new' }] : [],
          }),
        };
      },
    }),
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), {
              for: async () => rows,
            }),
          }),
        }),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if ('expiresAt' in vals) expiredOldRows = true;
        },
      }),
    }),
  };

  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await service.setCredits('user-1', 100, 'admin_set', 'req-123');

  assert.ok(insertedCtValues, 'should insert a creditTransactions row');
  assert.equal((insertedCtValues as Record<string, unknown>).delta, 100);
  assert.equal((insertedCtValues as Record<string, unknown>).remainingBalance, 100);
  assert.equal((insertedCtValues as Record<string, unknown>).reason, 'admin_set');
  assert.equal((insertedCtValues as Record<string, unknown>).referenceId, 'req-123');
  assert.equal((insertedCtValues as Record<string, unknown>).expiresAt, null);
  assert.equal(expiredOldRows, true, 'should expire other active creditTransactions rows');
});

test('setCredits is idempotent: re-play with same referenceId and amount does not expire rows', async () => {
  let expiredOldRows = false;

  // select call order:
  // 1. FOR UPDATE lock
  // 2. existing tx row (idempotency check)
  // 3. syncSubscriptionCache: total
  // 4. syncSubscriptionCache: nextExpiry
  // 5. syncSubscriptionCache: existing sub (credits match → no update)
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ delta: 50 }],
    [{ total: 50 }],
    [{ minExpiry: null }],
    [{ currentCredits: 50, nextExpiryDate: null }],
  ];
  let selectIdx = 0;

  const fakeTx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: (_opts?: unknown) => Object.assign(Promise.resolve({}), {
          returning: async () => [],  // conflict — row already exists
        }),
      }),
    }),
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), {
              for: async () => rows,
            }),
          }),
        }),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if ('expiresAt' in vals) expiredOldRows = true;
        },
      }),
    }),
  };

  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => { await fn(fakeTx); },
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await assert.doesNotReject(() => service.setCredits('user-1', 50, 'admin_set', 'req-dup'));
  assert.equal(expiredOldRows, false, 'should not expire creditTransactions rows on idempotent re-run');
});

test('setCredits throws when same referenceId is replayed with a different amount', async () => {
  // select call order:
  // 1. FOR UPDATE lock
  // 2. existing tx row — delta was 100, new request is 50
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ delta: 100 }],
  ];
  let selectIdx = 0;

  const fakeTx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: (_opts?: unknown) => Object.assign(Promise.resolve({}), {
          returning: async () => [],  // conflict
        }),
      }),
    }),
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), {
              for: async () => rows,
            }),
          }),
        }),
      };
    },
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };

  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  await assert.rejects(
    () => service.setCredits('user-1', 50, 'admin_set', 'req-mismatch'),
    /idempotency.*delta/i
  );
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
