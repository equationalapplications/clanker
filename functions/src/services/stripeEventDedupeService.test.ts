import assert from 'node:assert/strict';
import test from 'node:test';
import { createStripeEventDedupeService } from './stripeEventDedupeService.js';

type EventRow = { eventId: string; status: 'processing' | 'completed' };

function makeFakeDb() {
  const rows = new Map<string, EventRow>();

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const eventId = 'evt_1';
            const row = rows.get(eventId);
            return row ? [{ status: row.status }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: EventRow) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (rows.has(values.eventId)) {
              return [];
            }
            rows.set(values.eventId, values);
            return [{ eventId: values.eventId }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<EventRow>) => ({
        where: async () => {
          const row = rows.get('evt_1');
          if (row) {
            rows.set('evt_1', { ...row, ...values });
          }
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        rows.delete('evt_1');
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

test('markEventProcessed returns true on first insert, false on completed duplicate, true on processing retry', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_1'), true);
  await service.completeEventProcessed('evt_1');
  assert.equal(await service.markEventProcessed('evt_1'), false);
});

test('unmarkEventProcessed deletes the row', async () => {
  const fakeDb = makeFakeDb();
  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  await service.markEventProcessed('evt_1');
  await service.unmarkEventProcessed('evt_1');
  assert.equal(fakeDb.rows.has('evt_1'), false);
});
