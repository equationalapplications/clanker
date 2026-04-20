import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCharacterUpdateValues } from './characterService.js';

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