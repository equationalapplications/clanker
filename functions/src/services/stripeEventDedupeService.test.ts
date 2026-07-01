import assert from 'node:assert/strict';
import test from 'node:test';
import { createStripeEventDedupeService } from './stripeEventDedupeService.js';

test('isEventProcessed returns true after markEventProcessed inserts the row', async () => {
  const inserted = new Set<string>();

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const eventId = 'evt_1';
            return inserted.has(eventId) ? [{ eventId }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: { eventId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (inserted.has(values.eventId)) {
              return [];
            }
            inserted.add(values.eventId);
            return [{ eventId: values.eventId }];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => {} }),
  };

  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.isEventProcessed('evt_1'), false);
  await service.markEventProcessed('evt_1');
  assert.equal(await service.isEventProcessed('evt_1'), true);
});

test('markEventProcessed returns true on first insert, false on duplicate', async () => {
  const inserted = new Set<string>();

  const fakeDb = {
    insert: () => ({
      values: (values: { eventId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (inserted.has(values.eventId)) {
              return [];
            }
            inserted.add(values.eventId);
            return [{ eventId: values.eventId }];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => {} }),
  };

  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_1'), false);
  assert.equal(await service.markEventProcessed('evt_2'), true);
});

test('unmarkEventProcessed deletes the row', async () => {
  let deletedEventId: string | null = null;

  const fakeDb = {
    delete: () => ({
      where: async () => {
        deletedEventId = 'evt_1';
      },
    }),
  };

  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });
  await service.unmarkEventProcessed('evt_1');

  assert.equal(deletedEventId, 'evt_1');
});
