import assert from 'node:assert/strict';
import test from 'node:test';

import { assertIdempotentDeltaMatch } from './creditService.js';

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