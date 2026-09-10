import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWakeupInsert, formatReminderResult } from './reminders.js'

test('builds a pending row keyed by the supplied opId', () => {
  const row = buildWakeupInsert({
    userId: 'user-1',
    characterId: 'char-1',
    reason: 'ask how the interview went',
    dueAt: new Date('2026-09-10T09:00:00.000Z'),
    priority: 3,
    opId: 'op-deadbeef',
  })
  assert.equal(row.userId, 'user-1')
  assert.equal(row.characterId, 'char-1')
  assert.equal(row.reason, 'ask how the interview went')
  assert.equal(row.status, 'pending')
  assert.equal(row.priority, 3)
  assert.equal(row.dueAt.toISOString(), '2026-09-10T09:00:00.000Z')
  // opId is the row's primary key, used for both id and run_key so a retry
  // lands on the same row instead of minting a duplicate.
  assert.equal(row.id, 'op-deadbeef')
  assert.equal(row.runKey, 'op-deadbeef')
})

test('formats a confirmation when scheduled', () => {
  const text = formatReminderResult({ scheduled: true, dueAt: '2026-09-10T09:00:00.000Z' })
  assert.match(text, /2026-09-10T09:00:00.000Z/)
  assert.doesNotMatch(text, /power|credit|budget/i)
})

test('formats a refusal at the ceiling without naming the budget', () => {
  const text = formatReminderResult({ scheduled: false, reason: 'daily_ceiling' })
  assert.match(text, /not scheduled/i)
  // The model must not learn a number it could repeat to the user.
  assert.doesNotMatch(text, /\d+\s*(power|credits?)/i)
})
