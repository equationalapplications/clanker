import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const subscriptionServiceSourcePath = path.resolve(__dirname, '../../src/services/subscriptionService.ts');

test('upsertSubscription preserves default credits on first insert when credits are omitted', async () => {
  const source = await readFile(subscriptionServiceSourcePath, 'utf8');
  const upsertStart = source.indexOf('async upsertSubscription');
  const upsertEnd = source.indexOf('async acceptTerms', upsertStart);

  assert.notEqual(upsertStart, -1);
  assert.notEqual(upsertEnd, -1);

  const upsertBlock = source.slice(upsertStart, upsertEnd);

  assert.match(upsertBlock, /currentCredits:\s*params\.currentCredits\s*\?\?\s*50/);
});
