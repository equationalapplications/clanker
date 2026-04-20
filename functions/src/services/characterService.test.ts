import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildCharacterUpdateValues } from './characterService.js';

const characterServiceSourcePath = path.resolve(process.cwd(), 'src/services/characterService.ts');

test('buildCharacterUpdateValues omits isPublic when field is undefined', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    isPublic: undefined,
    updatedAt: undefined,
  });

  assert.equal('isPublic' in result, false);
});

test('buildCharacterUpdateValues includes isPublic when field is provided', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    isPublic: true,
    updatedAt: undefined,
  });

  assert.equal('isPublic' in result, true);
  assert.equal((result as { isPublic?: boolean }).isPublic, true);
});

test('upsertCharacter uses atomic conflict handling for provided IDs', async () => {
  const source = await readFile(characterServiceSourcePath, 'utf8');
  const upsertStart = source.indexOf('async upsertCharacter');
  const upsertEnd = source.indexOf('async deleteCharacter', upsertStart);

  assert.notEqual(upsertStart, -1);
  assert.notEqual(upsertEnd, -1);

  const upsertBlock = source.slice(upsertStart, upsertEnd);

  assert.match(upsertBlock, /onConflictDoUpdate\(\{/);
  assert.match(upsertBlock, /target:\s*characters\.id/);
  assert.match(upsertBlock, /where:\s*eq\(characters\.userId,\s*userId\)/);
  assert.match(upsertBlock, /if\s*\(!upserted\)/);
});