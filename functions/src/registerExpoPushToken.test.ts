import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NODE_ENV = 'test'

import { HttpsError } from 'firebase-functions/v2/https'
import { registerExpoPushTokenHandler } from './registerExpoPushToken.js'

const mockUser = {
  id: 'user-1',
  firebaseUid: 'firebase-uid-1',
  email: 'a@example.com',
  displayName: null,
  expoPushToken: null,
  avatarUrl: null,
  isProfilePublic: false,
  defaultCharacterId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

test('registerExpoPushTokenHandler rejects unauthenticated requests', async () => {
  await assert.rejects(
    async () => registerExpoPushTokenHandler({ auth: null } as never),
    (err: unknown) => err instanceof HttpsError && err.code === 'unauthenticated',
  )
})

test('registerExpoPushTokenHandler stores native expoPushToken', async () => {
  let savedToken: string | undefined
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, updates: { expoPushToken?: string }) => {
        savedToken = updates.expoPushToken
        return { ...mockUser, expoPushToken: updates.expoPushToken ?? null }
      },
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  const result = await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: { expoPushToken: 'ExponentPushToken[native]' },
    } as never,
    deps,
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(savedToken, 'ExponentPushToken[native]')
})

test('registerExpoPushTokenHandler exchanges web subscription and stores Expo token', async () => {
  let savedToken: string | undefined
  let exchangeInput: unknown
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, updates: { expoPushToken?: string }) => {
        savedToken = updates.expoPushToken
        return { ...mockUser, expoPushToken: updates.expoPushToken ?? null }
      },
    },
    fetchExpoPushTokenFromWebDevice: async (input: unknown) => {
      exchangeInput = input
      return 'ExponentPushToken[from-web]'
    },
  }

  const result = await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: {
        webDevicePushToken: {
          type: 'web',
          data: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            keys: { p256dh: 'p', auth: 'a' },
          },
        },
        projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
        applicationId: 'com.equationalapplications.clanker',
        deviceId: 'install-1',
      },
    } as never,
    deps,
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(savedToken, 'ExponentPushToken[from-web]')
  assert.deepEqual(exchangeInput, {
    deviceToken: JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    }),
    projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
    applicationId: 'com.equationalapplications.clanker',
    deviceId: 'install-1',
  })
})
