import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildWakeupInsert,
  deriveOpId,
  formatReminderResult,
  reminderOpIdCanonical,
} from './reminders.js'

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

// --- opId derivation ---------------------------------------------------------
// SHA-256 (256-bit) over a canonical string format that the edge executor
// (`src/services/edgeToolExecutors.ts`) reproduces byte-for-byte. The hash is
// what lets ON CONFLICT DO NOTHING collapse retries from either entry point
// onto the same row; an invariant break here would silently double-fire.

test('reminderOpIdCanonical formats args with the trimmed reason, raw remindAt, and priority defaulting to 0', () => {
  const canonical = reminderOpIdCanonical({
    characterId: 'char-1',
    reason: '  follow up  ',
    remindAt: '2026-09-10T09:00:00.000Z',
  })
  assert.equal(canonical, 'char-1|follow up|2026-09-10T09:00:00.000Z|0')

  // Priority surfaces when supplied.
  assert.equal(
    reminderOpIdCanonical({
      characterId: 'c',
      reason: 'r',
      remindAt: 't',
      priority: 5,
    }),
    'c|r|t|5',
  )
})

test('deriveOpId returns `op-` followed by 64 lowercase hex chars', async () => {
  const opId = await deriveOpId({
    characterId: 'char-1',
    reason: 'follow up',
    remindAt: '2026-09-10T09:00:00.000Z',
    priority: 2,
  })
  assert.match(opId, /^op-[0-9a-f]{64}$/)
})

test('deriveOpId is deterministic for identical inputs', async () => {
  const args = {
    characterId: 'char-1',
    reason: 'follow up on the interview',
    remindAt: '2026-09-10T09:00:00.000Z',
    priority: 3,
  }
  const a = await deriveOpId(args)
  const b = await deriveOpId(args)
  assert.equal(a, b)
})

test('deriveOpId produces distinct ids for distinct inputs', async () => {
  const base = {
    characterId: 'char-1',
    reason: 'follow up',
    remindAt: '2026-09-10T09:00:00.000Z',
    priority: 0,
  }
  const baseOpId = await deriveOpId(base)

  // A different reason must change the hash.
  assert.notEqual(
    await deriveOpId({ ...base, reason: 'check in' }),
    baseOpId,
  )
  // A different remindAt must change the hash. Critical: a different offset
  // (e.g. "+02:00" instead of "Z") at the same wall-clock moment MUST hash
  // differently too — that is why the canonical string uses the raw ISO.
  assert.notEqual(
    await deriveOpId({ ...base, remindAt: '2026-09-10T11:00:00.000+02:00' }),
    baseOpId,
  )
  // A different priority must change the hash.
  assert.notEqual(
    await deriveOpId({ ...base, priority: 1 }),
    baseOpId,
  )
  // A different character must change the hash.
  assert.notEqual(
    await deriveOpId({ ...base, characterId: 'char-2' }),
    baseOpId,
  )
})

test('deriveOpId hashes the canonical string with SHA-256 and matches the edge contract', async () => {
  // The hash over the canonical string must match what `expo-crypto`'s
  // `digestStringAsync(SHA256, ...)` would produce on the client, because
  // both sides hash the same canonical bytes via SHA-256 with lowercase hex
  // output. If this assertion drifts, ON CONFLICT DO NOTHING stops deduping
  // across the edge↔escalation boundary.
  const args = {
    characterId: 'char-1',
    reason: 'follow up',
    remindAt: '2026-09-10T09:00:00.000Z',
    priority: 2,
  }
  const expectedHex = createHash('sha256')
    .update(reminderOpIdCanonical(args), 'utf8')
    .digest('hex')
  assert.equal(await deriveOpId(args), `op-${expectedHex}`)
})

test('deriveOpId trims reason whitespace before hashing (matches edge side)', async () => {
  const trimmed = await deriveOpId({
    characterId: 'c',
    reason: 'follow up',
    remindAt: '2026-09-10T09:00:00.000Z',
  })
  const padded = await deriveOpId({
    characterId: 'c',
    reason: '   follow up   ',
    remindAt: '2026-09-10T09:00:00.000Z',
  })
  assert.equal(trimmed, padded)
})

test('deriveOpId uses an explicit 0 priority when omitted (matches edge side)', async () => {
  const explicit = await deriveOpId({
    characterId: 'c',
    reason: 'r',
    remindAt: 't',
    priority: 0,
  })
  const omitted = await deriveOpId({
    characterId: 'c',
    reason: 'r',
    remindAt: 't',
  })
  assert.equal(explicit, omitted)
})
