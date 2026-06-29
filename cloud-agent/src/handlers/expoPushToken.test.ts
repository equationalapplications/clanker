import test from 'node:test'
import assert from 'node:assert/strict'
import { upsertExpoPushToken } from './expoPushToken.js'

test('upsertExpoPushToken updates user row', async () => {
  const updates: Array<{ token: string }> = []
  const fakeDb = {
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          updates.push({ token: data.expoPushToken as string })
          return Promise.resolve()
        },
      }),
    }),
  }
  await upsertExpoPushToken(fakeDb as never, 'firebase-uid-1', 'ExponentPushToken[abc]')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].token, 'ExponentPushToken[abc]')
})
