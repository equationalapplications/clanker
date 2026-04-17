import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import { userRepository } from './services/userRepository.js';

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
