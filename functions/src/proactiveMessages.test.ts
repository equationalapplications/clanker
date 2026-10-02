import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { fetchProactiveMessagesHandler, markProactiveReadHandler } from './proactiveMessages.js'

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
    markRead: async () => 0,
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

test('markProactiveRead sets read_at only for the caller messages', async () => {
  const deps = buildDeps({
    markRead: async ({ userId, messageIds }: { userId: string; messageIds: string[] }) => {
      assert.equal(userId, USER_ID)
      assert.deepEqual(messageIds, ['m1', 'm2'])
      return 2
    },
  })
  const result = await markProactiveReadHandler(
    authedRequest({ messageIds: ['m1', 'm2'] }),
    deps as never,
  )
  assert.equal(result.updated, 2)
})

test('markProactiveRead is idempotent', async () => {
  // Only ever NULL -> timestamp. A second call updates nothing and must not
  // error: the client retries, so a repeat is the expected case.
  const deps = buildDeps({ markRead: async () => 0 })
  const result = await markProactiveReadHandler(
    authedRequest({ messageIds: ['m1'] }),
    deps as never,
  )
  assert.equal(result.updated, 0)
})

test('markProactiveRead rejects unauthenticated calls', async () => {
  await assert.rejects(
    () => markProactiveReadHandler({ data: { messageIds: ['m1'] } } as never, buildDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('rejects a cursor timestamp that carries no timezone', async () => {
  // Date.parse accepts a date-time with no offset and resolves it against the
  // runtime's local zone, so the NaN guard alone lets it through. The value
  // then round-trips through toISOString() into PG as a different absolute
  // instant than the caller meant, and the cursor silently walks past rows.
  // The callable is public, so the malformed value need not come from our own
  // client. Requiring an explicit Z or ±HH:MM makes the instant unambiguous.
  const deps = buildDeps({
    selectProactiveMessages: async () => {
      assert.fail('must not query with an ambiguous cursor')
    },
  })
  await assert.rejects(
    () =>
      fetchProactiveMessagesHandler(
        authedRequest({ sinceCreatedAt: '2026-09-08T12:00:00', sinceMessageId: 'a' }),
        deps as never,
      ),
    /ISO timestamp/,
  )
})

test('rejects a cursor timestamp that is a loose date string', async () => {
  const deps = buildDeps({
    selectProactiveMessages: async () => {
      assert.fail('must not query with an ambiguous cursor')
    },
  })
  for (const bad of ['2026', 'Sep 8 2026', '2026-09-08']) {
    await assert.rejects(
      () =>
        fetchProactiveMessagesHandler(
          authedRequest({ sinceCreatedAt: bad, sinceMessageId: 'a' }),
          deps as never,
        ),
      /ISO timestamp/,
      `expected ${bad} to be rejected`,
    )
  }
})

test('accepts a cursor timestamp with an explicit offset', async () => {
  // The client always sends toISOString() output (always Z), but a non-UTC
  // offset is still unambiguous, so it must not be rejected.
  let seen: { createdAt: Date; messageId: string } | null = null
  const deps = buildDeps({
    selectProactiveMessages: async ({ cursor }: { cursor: never }) => {
      seen = cursor
      return []
    },
  })
  await fetchProactiveMessagesHandler(
    authedRequest({ sinceCreatedAt: '2026-09-08T14:00:00+02:00', sinceMessageId: 'a' }),
    deps as never,
  )
  assert.equal(seen!.createdAt.toISOString(), '2026-09-08T12:00:00.000Z')
})
