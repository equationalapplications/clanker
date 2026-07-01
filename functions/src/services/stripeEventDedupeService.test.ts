import assert from 'node:assert/strict';
import test from 'node:test';
import { SQL } from 'drizzle-orm';
import {
  createStripeEventDedupeService,
  PROCESSING_LEASE_MS,
} from './stripeEventDedupeService.js';

type EventRow = { eventId: string; status: 'processing' | 'completed'; createdAt: Date };

function eventIdFromWhere(condition: unknown): string | undefined {
  if (!(condition instanceof SQL)) {
    return undefined;
  }
  for (const chunk of condition.queryChunks) {
    if (chunk instanceof SQL) {
      const nested = eventIdFromWhere(chunk);
      if (nested) {
        return nested;
      }
    }
    if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      const value = (chunk as { value: unknown }).value;
      if (typeof value === 'string') {
        return value;
      }
    }
  }
  return undefined;
}

function applyUpdate(
  rows: Map<string, EventRow>,
  values: Partial<EventRow>,
  condition: unknown,
): boolean {
  const eventId = eventIdFromWhere(condition);
  if (!eventId) {
    return false;
  }
  const row = rows.get(eventId);
  if (!row) {
    return false;
  }
  rows.set(eventId, { ...row, ...values });
  return true;
}

function makeFakeDb(now: () => Date = () => new Date()) {
  const rows = new Map<string, EventRow>();

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async () => {
            const eventId = eventIdFromWhere(condition);
            if (!eventId) {
              return [];
            }
            const row = rows.get(eventId);
            return row ? [{ status: row.status, createdAt: row.createdAt }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Omit<EventRow, 'createdAt'> & { createdAt?: Date }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (rows.has(values.eventId)) {
              return [];
            }
            rows.set(values.eventId, {
              eventId: values.eventId,
              status: values.status,
              createdAt: values.createdAt ?? now(),
            });
            return [{ eventId: values.eventId }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<EventRow>) => ({
        where: (condition: unknown) => {
          const run = async () => {
            applyUpdate(rows, values, condition);
          };
          return Object.assign(run(), {
            returning: async () => (applyUpdate(rows, values, condition) ? [{ eventId: eventIdFromWhere(condition)! }] : []),
          });
        },
      }),
    }),
    delete: () => ({
      where: async (condition: unknown) => {
        const eventId = eventIdFromWhere(condition);
        if (eventId) {
          rows.delete(eventId);
        }
      },
    }),
    rows,
  };

  return fakeDb;
}

test('isEventProcessed returns true only after completeEventProcessed', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.isEventProcessed('evt_1'), false);
  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.isEventProcessed('evt_1'), false);
  await service.completeEventProcessed('evt_1');
  assert.equal(await service.isEventProcessed('evt_1'), true);
});

test('markEventProcessed returns true on first insert, false on completed duplicate', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_1'), false);
  await service.completeEventProcessed('evt_1');
  assert.equal(await service.markEventProcessed('evt_1'), false);
});

test('markEventProcessed returns false for concurrent in-flight processing claims', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_1'), false);
});

test('markEventProcessed reacquires stale processing claims', async () => {
  const fixedNow = new Date('2026-07-01T12:00:00Z');
  const fakeDb = makeFakeDb(() => fixedNow);
  fakeDb.rows.set('evt_stale', {
    eventId: 'evt_stale',
    status: 'processing',
    createdAt: new Date(fixedNow.getTime() - PROCESSING_LEASE_MS - 1),
  });

  const service = createStripeEventDedupeService({
    getDb: async () => fakeDb as never,
    now: () => fixedNow,
  });

  assert.equal(await service.markEventProcessed('evt_stale'), true);
});

test('markEventProcessed threads distinct event ids through queries', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_2'), true);
  assert.equal(fakeDb.rows.has('evt_1'), true);
  assert.equal(fakeDb.rows.has('evt_2'), true);
  assert.equal(await service.markEventProcessed('evt_1'), false);
});

test('unmarkEventProcessed deletes the row', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  await service.markEventProcessed('evt_1');
  await service.unmarkEventProcessed('evt_1');
  assert.equal(fakeDb.rows.has('evt_1'), false);
});

test('expireProcessingClaim ages an in-flight row for retry', async () => {
  const fixedNow = new Date('2026-07-01T12:00:00Z');
  const fakeDb = makeFakeDb(() => fixedNow);
  fakeDb.rows.set('evt_retry', {
    eventId: 'evt_retry',
    status: 'processing',
    createdAt: fixedNow,
  });

  const service = createStripeEventDedupeService({
    getDb: async () => fakeDb as never,
    now: () => fixedNow,
  });

  await service.expireProcessingClaim('evt_retry');
  assert.equal(await service.markEventProcessed('evt_retry'), true);
});
