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
  proactivePushReady: false,
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

test('capabilities.proactivePush must be a boolean when present (non-boolean rejected)', async () => {
  // String / number / null / array all rejected. parseCapabilities runs before
  // any DB write, so a non-boolean never reaches updateUser.
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async () => ({ ...mockUser, proactivePushReady: true }),
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  for (const bad of ['true', 1, null, [], {}]) {
    await assert.rejects(
      registerExpoPushTokenHandler(
        {
          auth: { uid: 'firebase-uid-1' },
          data: { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: bad } },
        } as never,
        deps,
      ),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'invalid-argument')
        return true
      },
      `expected non-boolean proactivePush=${JSON.stringify(bad)} to be rejected`,
    )
  }
})

test('capabilities must be an object when present (non-object rejected)', async () => {
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async () => ({ ...mockUser, proactivePushReady: true }),
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  for (const bad of ['proactivePush', 42, null, true]) {
    await assert.rejects(
      registerExpoPushTokenHandler(
        {
          auth: { uid: 'firebase-uid-1' },
          data: { expoPushToken: 'ExponentPushToken[abc]', capabilities: bad },
        } as never,
        deps,
      ),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'invalid-argument')
        return true
      },
      `expected non-object capabilities=${JSON.stringify(bad)} to be rejected`,
    )
  }
})

test('capabilities.proactivePush true sets the flag alongside the token', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, updates: Record<string, unknown>) => {
        savedUpdates = updates
        return { ...mockUser, ...(updates as object) } as typeof mockUser
      },
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  const result = await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: true } },
    } as never,
    deps,
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(savedUpdates!.expoPushToken, 'ExponentPushToken[abc]')
  assert.equal(savedUpdates!.proactivePushReady, true)
})

test('omitted capabilities actively sets the flag false (the downgrade path)', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, updates: Record<string, unknown>) => {
        savedUpdates = updates
        return { ...mockUser, ...(updates as object) } as typeof mockUser
      },
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  const result = await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: { expoPushToken: 'ExponentPushToken[abc]' },
    } as never,
    deps,
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(savedUpdates!.proactivePushReady, false)
})

test('capabilities.proactivePush false sets the flag false', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, updates: Record<string, unknown>) => {
        savedUpdates = updates
        return { ...mockUser, ...(updates as object) } as typeof mockUser
      },
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  const result = await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: false } },
    } as never,
    deps,
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(savedUpdates!.proactivePushReady, false)
})

test('the token and the flag are written in ONE updateUser call (atomic)', async () => {
  let callCount = 0
  const deps = {
    userRepository: {
      findUserByFirebaseUid: async () => mockUser,
      updateUser: async (_id: string, _updates: Record<string, unknown>) => {
        callCount += 1
        return mockUser
      },
    },
    fetchExpoPushTokenFromWebDevice: async () => 'ExponentPushToken[unused]',
  }

  await registerExpoPushTokenHandler(
    {
      auth: { uid: 'firebase-uid-1' },
      data: { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: true } },
    } as never,
    deps,
  )

  assert.equal(callCount, 1)
})
