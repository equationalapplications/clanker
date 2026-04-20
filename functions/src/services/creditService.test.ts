import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertIdempotentDeltaMatch } from './creditService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creditServiceSourcePath = path.resolve(__dirname, '../../src/services/creditService.ts');

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

test('spendCredits updates subscriptions.updatedAt when deducting credits', async () => {
  const source = await readFile(creditServiceSourcePath, 'utf8');
  const spendCreditsStart = source.indexOf('async spendCredits');
  const spendCreditsEnd = source.indexOf('if (result.length === 0)', spendCreditsStart);

  assert.notEqual(spendCreditsStart, -1);
  assert.notEqual(spendCreditsEnd, -1);

  const spendCreditsBlock = source.slice(spendCreditsStart, spendCreditsEnd);

  assert.match(
    spendCreditsBlock,
    /\.set\(\{[\s\S]*currentCredits:[\s\S]*updatedAt:\s*new Date\(\)/
  );
});