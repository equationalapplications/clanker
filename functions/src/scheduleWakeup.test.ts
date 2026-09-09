process.env.NODE_ENV = 'test'

import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { scheduleWakeupHandler, buildWakeupInsert, WAKEUP_LIMIT_REFUSAL } from './scheduleWakeup.js'
import type { ScheduleWakeupDeps } from './scheduleWakeup.js'

function buildDeps(overrides: Partial<ScheduleWakeupDeps> = {}): ScheduleWakeupDeps {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({ id: 'user-1' }),
    } as unknown as ScheduleWakeupDeps['userRepository'],
    characterOwnedBy: async (characterId: string) => characterId === 'char-owned',
    todaysProactiveSpend: async () => 0,
    insertWakeup: async () => {},
    ...overrides,
  }
}

function authedRequest(data: unknown) {
  return { auth: { uid: 'firebase-uid' }, data } as never
}

test('rejects unauthenticated calls', async () => {
  await assert.rejects(
    scheduleWakeupHandler({ auth: undefined, data: {} } as never, buildDeps()),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('rejects a characterId the caller does not own', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest({ characterId: 'char-other', reason: 'r', remindAt: futureIso() }),
      buildDeps(),
    ),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('rejects an unknown user', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
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
    authedRequest({ characterId: 'char-owned', reason: '   ', remindAt: futureIso() }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: a reason is required.')
})

test('rejects remind_at in the past against the SERVER clock', async () => {
  // A client with a skewed clock must not be able to insert immediately-due rows.
  const skewedPast = new Date(Date.now() - 60_000).toISOString()
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: skewedPast }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be in the future.')
})

test('rejects an unparseable remind_at', async () => {
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: 'not-a-date' }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be an ISO 8601 datetime.')
})

test('returns the vague-limit refusal at the ceiling and inserts nothing', async () => {
  const inserted: unknown[] = []
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
    buildDeps({
      todaysProactiveSpend: async () => 500,
      insertWakeup: async (row) => {
        inserted.push(row)
      },
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, WAKEUP_LIMIT_REFUSAL)
  // Deliberately vague: no number the model could repeat to the user.
  assert.doesNotMatch(result.message, /\d+\s*(power|credits?)/i)
  assert.equal(inserted.length, 0)
})

test('success inserts a pending row with minted id/runKey and returns the due time', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  const due = futureIso()
  const result = await scheduleWakeupHandler(
    authedRequest({
      characterId: 'char-owned',
      reason: '  follow up  ',
      remindAt: due,
      priority: 3,
    }),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
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
  assert.notEqual(saved!.id, saved!.runKey)
  assert.notEqual(saved!.id, undefined)
})

test('priority defaults to 0 when omitted', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
      },
    }),
  )
  assert.equal(saved!.priority, 0)
})

function futureIso(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString()
}
