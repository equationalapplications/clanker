import test from 'node:test'
import assert from 'node:assert/strict'
import { upsertExpoPushToken } from './expoPushToken.js'

test('upsertExpoPushToken updates user row', async () => {
  const updates: Array<{ token: string }> = []
  const fakeDb = {
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updates.push({ token: data.expoPushToken as string })
            return Promise.resolve([{ id: 'user-uuid' }])
          },
        }),
      }),
    }),
  }
  await upsertExpoPushToken(fakeDb as never, 'firebase-uid-1', 'ExponentPushToken[abc]')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].token, 'ExponentPushToken[abc]')
})

test('upsertExpoPushToken throws when no matching user row', async () => {
  const fakeDb = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  }
  await assert.rejects(
    () => upsertExpoPushToken(fakeDb as never, 'unknown-uid', 'ExponentPushToken[xyz]'),
    /USER_NOT_FOUND/,
  )
})
