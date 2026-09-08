import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { fetchProactiveMessagesHandler } from './proactiveMessages.js'

const FIREBASE_UID = 'firebase-uid-1'
const USER_ID = 'user-1'

function msgRow(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'm1',
    characterId: 'char-1',
    text: 'hi',
    createdAt: new Date('2026-09-08T12:00:00.000Z'),
    readAt: null,
    ...overrides,
  }
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({ id: USER_ID, firebaseUid: FIREBASE_UID }),
    },
    selectProactiveMessages: async () => [],
    ...overrides,
  }
}

function authedRequest(data: Record<string, unknown> = {}) {
  return { auth: { uid: FIREBASE_UID }, data } as never
}

test('rejects unauthenticated calls', async () => {
  await assert.rejects(
    () => fetchProactiveMessagesHandler({ data: {} } as never, buildDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('returns only the caller own messages', async () => {
  const deps = buildDeps({
    selectProactiveMessages: async ({ userId }: { userId: string }) => {
      assert.equal(userId, USER_ID)
      return [msgRow({ messageId: 'm1' })]
    },
  })
  const result = await fetchProactiveMessagesHandler(authedRequest({}), deps as never)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].messageId, 'm1')
})

test('pagination does not skip rows sharing a created_at', async () => {
  // SWEEP_BATCH_LIMIT is 50, so the sweeper resolves batches together and
  // identical millisecond timestamps are expected, not hypothetical. A bare
  // timestamp cursor would drop the second row at a page boundary.
  const same = new Date('2026-09-08T12:00:00.000Z')
  const deps = buildDeps({
    selectProactiveMessages: async ({ cursor }: { cursor: unknown }) => {
      if (!cursor) return [msgRow({ messageId: 'a', createdAt: same })]
      assert.deepEqual(cursor, { createdAt: same, messageId: 'a' })
      return [msgRow({ messageId: 'b', createdAt: same })]
    },
  })

  const first = await fetchProactiveMessagesHandler(authedRequest({}), deps as never)
  assert.equal(first.nextCursor?.messageId, 'a')

  const second = await fetchProactiveMessagesHandler(
    authedRequest({
      sinceCreatedAt: first.nextCursor!.createdAt,
      sinceMessageId: first.nextCursor!.messageId,
    }),
    deps as never,
  )
  assert.equal(second.messages[0].messageId, 'b')
})

test('caps the page size', async () => {
  const deps = buildDeps({
    selectProactiveMessages: async ({ limit }: { limit: number }) => {
      assert.equal(limit, 100)
      return []
    },
  })
  await fetchProactiveMessagesHandler(authedRequest({ limit: 5000 }), deps as never)
})
