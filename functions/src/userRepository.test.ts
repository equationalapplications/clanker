import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeEmailOrNull,
  normalizeRequiredEmail,
  userRepository,
} from './services/userRepository.js';

test('normalizeEmailOrNull trims and lowercases email values', () => {
  assert.equal(normalizeEmailOrNull('  USER@Example.COM  '), 'user@example.com');
});

test('normalizeEmailOrNull returns null for empty or whitespace-only input', () => {
  assert.equal(normalizeEmailOrNull(''), null);
  assert.equal(normalizeEmailOrNull('   '), null);
});

test('normalizeRequiredEmail throws on empty or whitespace-only input', () => {
  assert.throws(() => normalizeRequiredEmail(''), /Email must not be empty/);
  assert.throws(() => normalizeRequiredEmail('   '), /Email must not be empty/);
});

test('findUserByEmail returns null for empty or whitespace-only input without querying db', async () => {
  let called = false;

  const result = await userRepository.findUserByEmail('   ', {
    getDb: async () => {
      called = true;
      throw new Error('getDb should not be called for empty normalized email');
    },
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test('getOrCreateUserByFirebaseIdentity rejects email match with different firebase uid', async (t) => {
  const fakeDb = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [],
        }),
      }),
    }),
  };

  t.mock.method(userRepository, 'findUserByFirebaseUid', async () => null);
  t.mock.method(userRepository, 'findUserByEmail', async () => ({
    id: 'existing-user-id',
    firebaseUid: 'old-firebase-uid',
    email: 'same-email@example.com',
    displayName: 'Existing User',
    avatarUrl: null,
    isProfilePublic: false,
    defaultCharacterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await assert.rejects(
    () =>
      userRepository.getOrCreateUserByFirebaseIdentity(
        {
          firebaseUid: 'new-firebase-uid',
          email: 'same-email@example.com',
        },
        {
          getDb: async () => fakeDb as never,
        }
      ),
    /different Firebase UID/
  );
});
