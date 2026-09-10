process.env.NODE_ENV = 'test'

import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { scheduleWakeupHandler, buildWakeupInsert, WAKEUP_LIMIT_REFUSAL } from './scheduleWakeup.js'
import type { ScheduleWakeupDeps } from './scheduleWakeup.js'

let opSeq = 0
function nextOpId(): string {
  opSeq += 1
  return `op-${opSeq}`
}

function buildDeps(overrides: Partial<ScheduleWakeupDeps> = {}): ScheduleWakeupDeps {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({ id: 'user-1' }),
    } as unknown as ScheduleWakeupDeps['userRepository'],
    characterOwnedBy: async (characterId: string) => characterId === 'char-owned',
    todaysProactiveSpend: async () => 0,
    insertWakeup: async () => true,
    findWakeupDueAt: async () => null,
    ...overrides,
  }
}

function authedRequest(data: unknown) {
  return { auth: { uid: 'firebase-uid' }, data } as never
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    characterId: 'char-owned',
    reason: 'r',
    remindAt: futureIso(),
    opId: nextOpId(),
    ...overrides,
  }
}

test('rejects unauthenticated calls', async () => {
  await assert.rejects(
    scheduleWakeupHandler({ auth: undefined, data: {} } as never, buildDeps()),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('rejects a characterId the caller does not own', async () => {
  await assert.rejects(
    scheduleWakeupHandler(authedRequest(basePayload({ characterId: 'char-other' })), buildDeps()),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('rejects an unknown user', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest(basePayload()),
      buildDeps({
        userRepository: {
          findUserByFirebaseUid: async () => null,
        } as unknown as ScheduleWakeupDeps['userRepository'],
      }),
    ),
    (e: unknown) => e instanceof HttpsError && e.code === 'not-found',
  )
})

test('rejects an empty reason', async () => {
  const result = await scheduleWakeupHandler(
    authedRequest(basePayload({ reason: '   ' })),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: a reason is required.')
})

test('rejects remind_at in the past against the SERVER clock', async () => {
  // A client with a skewed clock must not be able to insert immediately-due rows.
  const skewedPast = new Date(Date.now() - 60_000).toISOString()
  const result = await scheduleWakeupHandler(
    authedRequest(basePayload({ remindAt: skewedPast })),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be in the future.')
})

test('rejects an unparseable remind_at', async () => {
  const result = await scheduleWakeupHandler(
    authedRequest(basePayload({ remindAt: 'not-a-date' })),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be an ISO 8601 datetime.')
})

test('rejects a missing opId', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
      buildDeps(),
    ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test('returns the vague-limit refusal at the ceiling and inserts nothing', async () => {
  const inserted: unknown[] = []
  const result = await scheduleWakeupHandler(
    authedRequest(basePayload()),
    buildDeps({
      todaysProactiveSpend: async () => 500,
      insertWakeup: async (row) => {
        inserted.push(row)
        return true
      },
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, WAKEUP_LIMIT_REFUSAL)
  // Deliberately vague: no number the model could repeat to the user.
  assert.doesNotMatch(result.message, /\d+\s*(power|credits?)/i)
  assert.equal(inserted.length, 0)
})

test('success inserts a pending row keyed by opId and returns the due time', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  const due = futureIso()
  const opId = nextOpId()
  const result = await scheduleWakeupHandler(
    authedRequest({
      characterId: 'char-owned',
      reason: '  follow up  ',
      remindAt: due,
      priority: 3,
      opId,
    }),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
        return true
      },
    }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.dueAt, new Date(due).toISOString())
  assert.ok(saved)
  assert.equal(saved!.characterId, 'char-owned')
  assert.equal(saved!.userId, 'user-1')
  assert.equal(saved!.reason, 'follow up') // trimmed
  assert.equal(saved!.priority, 3)
  assert.equal(saved!.status, 'pending')
  // opId is the row's primary key, used for both id and run_key so a retry
  // lands on the same row instead of minting a duplicate.
  assert.equal(saved!.id, opId)
  assert.equal(saved!.runKey, opId)
})

test('returns the existing row when insertWakeup signals a conflict (same opId retry)', async () => {
  const opId = nextOpId()
  const due = futureIso()
  const existing = new Date(Date.now() + 5 * 60_000)
  const result = await scheduleWakeupHandler(
    authedRequest(basePayload({ opId, remindAt: due })),
    buildDeps({
      insertWakeup: async () => false,
      findWakeupDueAt: async (id) => (id === opId ? existing : null),
    }),
  )
  assert.equal(result.ok, true)
  // The conflict path surfaces the existing row's dueAt, not the request's —
  // a retry sees a stable answer instead of a new (later) scheduling.
  assert.equal(result.dueAt, existing.toISOString())
})

test('priority defaults to 0 when omitted', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  await scheduleWakeupHandler(
    authedRequest(basePayload()),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
        return true
      },
    }),
  )
  assert.equal(saved!.priority, 0)
})

function futureIso(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString()
}
