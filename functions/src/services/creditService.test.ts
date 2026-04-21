import assert from 'node:assert/strict';
import test from 'node:test';

import { assertIdempotentDeltaMatch, createCreditService } from './creditService.js';

test('assertIdempotentDeltaMatch allows duplicate request when delta matches', () => {
  assert.doesNotThrow(() => {
    assertIdempotentDeltaMatch({
      requestedDelta: -5,
      existingDelta: -5,
      reason: 'image generation',
      referenceId: 'ref-1',
    });
  });
});

test('assertIdempotentDeltaMatch throws when duplicate request uses a different delta', () => {
  assert.throws(
    () => {
      assertIdempotentDeltaMatch({
        requestedDelta: 8,
        existingDelta: 2,
        reason: 'webhook renewal',
        referenceId: 'ref-2',
      });
    },
    /idempotency.*delta/i
  );
});

test('assertIdempotentDeltaMatch throws when duplicate key exists but transaction row is missing', () => {
  assert.throws(
    () => {
      assertIdempotentDeltaMatch({
        requestedDelta: 8,
        existingDelta: null,
        reason: 'webhook renewal',
        referenceId: 'ref-2',
      });
    },
    /idempotency.*missing/i
  );
});

test('spendCredits writes updatedAt when deducting credits', async () => {
  let updateSetValues: Record<string, unknown> | null = null;

  const fakeTx = {
    insert: () => ({
      values: async () => [],
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetValues = values;
        return {
          where: () => ({
            returning: async () => [{ updatedCredits: 95 }],
          }),
        };
      },
    }),
  };

  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) => await fn(fakeTx),
  };

  const service = createCreditService({
    getDb: async () => fakeDb as never,
  });

  const spent = await service.spendCredits('user-1', 5, 'image generation');

  assert.equal(spent, true);
  const updatedAt = (updateSetValues as { updatedAt?: unknown } | null)?.updatedAt;
  assert.ok(updatedAt instanceof Date);
});