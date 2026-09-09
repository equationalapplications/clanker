/**
 * buildSweepDeps integration suite.
 *
 * The unit tests in proactiveWakeupSweep.test.ts drive the handler with stubbed
 * deps, so they prove the decision logic but never execute a line of the SQL
 * that feeds it. Every guardrail input — the day's proactive spend, the day's
 * push count, the unread count, the last user message — is computed by a query
 * with non-obvious semantics (status exclusions, a jsonb marker, a staleness
 * window, a column that replaced a string match). Those are the queries here.
 *
 * Real Postgres 18 (`clanker_test`), real Drizzle, real schema via
 * migrate-dev.mjs. Only the db factory is injected: buildSweepDeps(testGetDb).
 */
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildSweepDeps, type DueWakeup } from '../proactiveWakeupSweep.js'
import { UNREAD_STALENESS_ESCAPE_MS } from '../services/proactiveWakeupGuardrails.js'
import {
  ensureIntegrationDatabase,
  testGetDb,
  seedUser,
  truncateAll,
  closeIntegrationPool,
  getPool,
} from './helpers/db.js'

const deps = buildSweepDeps(testGetDb)

const NOW = new Date('2026-09-09T14:00:00.000Z')
const DAY_START = new Date('2026-09-09T00:00:00.000Z')

let userId: string
let characterId: string
let otherCharacterId: string

before(async () => {
  await ensureIntegrationDatabase()
})

after(async () => {
  await closeIntegrationPool()
})

beforeEach(async () => {
  await truncateAll()
  const user = await seedUser('fb-sweep-1', 'sweep-1@example.test')
  userId = user.id
  characterId = await insertCharacter('Sweep Character')
  otherCharacterId = await insertCharacter('Other Character')
})

async function insertCharacter(name: string): Promise<string> {
  const { rows } = await getPool().query(
    'INSERT INTO characters (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, name],
  )
  return rows[0].id as string
}

let wakeupSeq = 0
async function insertWakeup(fields: Record<string, unknown> = {}): Promise<string> {
  wakeupSeq += 1
  const row = {
    id: `w-${wakeupSeq}`,
    character_id: characterId,
    user_id: userId,
    reason: 'follow up',
    due_at: new Date(Date.now() - 60_000),
    priority: 0,
    status: 'pending',
    run_key: `run-${wakeupSeq}`,
    ...fields,
  }
  const cols = Object.keys(row)
  const params = cols.map((_, i) => `$${i + 1}`)
  await getPool().query(
    `INSERT INTO scheduled_wakeups (${cols.join(', ')}) VALUES (${params.join(', ')})`,
    Object.values(row),
  )
  return row.id as string
}

let messageSeq = 0
async function insertMessage(fields: Record<string, unknown> = {}): Promise<void> {
  messageSeq += 1
  const row = {
    character_id: characterId,
    sender_user_id: userId,
    message_id: `m-${messageSeq}`,
    text: 'hello',
    message_data: '{}',
    created_at: NOW,
    ...fields,
  }
  const cols = Object.keys(row)
  const params = cols.map((_, i) => `$${i + 1}`)
  await getPool().query(
    `INSERT INTO messages (${cols.join(', ')}) VALUES (${params.join(', ')})`,
    Object.values(row),
  )
}

function dueRowFor(id: string): DueWakeup {
  return {
    id,
    characterId,
    userId,
    firebaseUid: 'fb-sweep-1',
    reason: 'follow up',
    runKey: 'run-x',
    priority: 0,
  }
}

// --- selectDue ---------------------------------------------------------------

// selectDue compares due_at against the database's own now(), not the injected
// clock, so due/not-due fixtures must be anchored to the real current time.
test('selectDue returns only pending rows that are actually due', async () => {
  await insertWakeup({ id: 'due-pending', due_at: new Date(Date.now() - 60_000) })
  await insertWakeup({ id: 'not-yet', due_at: new Date(Date.now() + 60 * 60_000) })
  await insertWakeup({ id: 'already-claimed', status: 'claimed' })
  await insertWakeup({ id: 'already-done', status: 'done', resolved_at: NOW })

  const rows = await deps.selectDue(50)

  assert.deepEqual(
    rows.map((r) => r.id),
    ['due-pending'],
  )
})

test('selectDue orders by priority first, then by due time', async () => {
  const oldest = new Date(Date.now() - 60 * 60_000)
  await insertWakeup({ id: 'low-old', priority: 0, due_at: oldest })
  await insertWakeup({ id: 'high-new', priority: 5, due_at: new Date(Date.now() - 1_000) })
  await insertWakeup({ id: 'high-old', priority: 5, due_at: oldest })

  const rows = await deps.selectDue(50)

  assert.deepEqual(
    rows.map((r) => r.id),
    ['high-old', 'high-new', 'low-old'],
  )
})

test('selectDue joins the firebase uid the POST needs', async () => {
  await insertWakeup({ id: 'w-uid' })
  const [row] = await deps.selectDue(50)
  assert.equal(row.firebaseUid, 'fb-sweep-1')
})

// --- claim -------------------------------------------------------------------

test('claim is atomic: the second claimant loses', async () => {
  const id = await insertWakeup()

  const first = await deps.claim(id, NOW)
  const second = await deps.claim(id, NOW)

  assert.equal(first, true, 'first claim must win')
  assert.equal(second, false, 'a row already claimed must not be claimed twice')
})

// --- loadContext: todaysProactiveSpend ---------------------------------------

test('todaysProactiveSpend counts only terminal rows resolved today', async () => {
  const yesterday = new Date(DAY_START.getTime() - 60_000)
  await insertWakeup({ id: 's-done', status: 'done', resolved_at: NOW, spent_amount: 100 })
  await insertWakeup({ id: 's-skipped', status: 'skipped', resolved_at: NOW, spent_amount: 30 })
  // Yesterday's spend belongs to yesterday's ceiling.
  await insertWakeup({ id: 's-old', status: 'done', resolved_at: yesterday, spent_amount: 999 })
  // Non-terminal rows have not written spent_amount back yet.
  await insertWakeup({ id: 's-pending', status: 'pending', spent_amount: 999 })
  await insertWakeup({ id: 's-claimed', status: 'claimed', spent_amount: 999 })
  await insertWakeup({ id: 's-running', status: 'running', spent_amount: 999 })
  // Another character's spend is not this character's.
  await insertWakeup({
    id: 's-other',
    character_id: otherCharacterId,
    status: 'done',
    resolved_at: NOW,
    spent_amount: 999,
  })

  const ctx = await deps.loadContext(dueRowFor('s-pending'), NOW, DAY_START)

  assert.equal(ctx.todaysProactiveSpend, 130)
})

test('todaysProactiveSpend is 0, not null, when nothing has been spent', async () => {
  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)
  assert.equal(ctx.todaysProactiveSpend, 0)
})

// --- loadContext: todaysPushCount -------------------------------------------

test('todaysPushCount follows the delivery_mode column, not the outcome text', async () => {
  // The exact inversion migration 0028 exists to prevent: outcome prose and the
  // column disagree, and only the column may be believed.
  await insertWakeup({
    id: 'p-quiet-text-notify',
    status: 'done',
    resolved_at: NOW,
    outcome: 'mode=notify chosen=notify',
    delivery_mode: 'quiet',
  })
  await insertWakeup({
    id: 'p-notify-text-quiet',
    status: 'done',
    resolved_at: NOW,
    outcome: 'mode=quiet chosen=notify',
    delivery_mode: 'notify',
  })

  const ctx = await deps.loadContext(dueRowFor('p-notify-text-quiet'), NOW, DAY_START)

  assert.equal(ctx.todaysPushCount, 1)
})

test('todaysPushCount ignores notifies sent on an earlier day', async () => {
  await insertWakeup({
    id: 'p-yesterday',
    status: 'done',
    resolved_at: new Date(DAY_START.getTime() - 60_000),
    delivery_mode: 'notify',
  })
  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)
  assert.equal(ctx.todaysPushCount, 0)
})

// --- loadContext: unreadProactiveCount --------------------------------------

test('unreadProactiveCount counts only unread proactive messages', async () => {
  await insertMessage({ message_data: JSON.stringify({ proactive: true }) })
  // Read: no longer nagging the user about it.
  await insertMessage({ message_data: JSON.stringify({ proactive: true }), read_at: NOW })
  // A user-authored message is not a proactive one.
  await insertMessage({ message_data: '{}' })
  // Another character's unread message must not mute this one.
  await insertMessage({
    character_id: otherCharacterId,
    message_data: JSON.stringify({ proactive: true }),
  })

  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)

  assert.equal(ctx.unreadProactiveCount, 1)
})

test('unreadProactiveCount ages out via the staleness escape', async () => {
  // Without this window a single lost mark-read would mute the character
  // permanently, since unreadProactiveCount > 0 blocks every future notify.
  await insertMessage({
    message_data: JSON.stringify({ proactive: true }),
    created_at: new Date(NOW.getTime() - UNREAD_STALENESS_ESCAPE_MS - 60_000),
  })

  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)

  assert.equal(ctx.unreadProactiveCount, 0, 'a stale unread must not mute the character forever')
})

// --- loadContext: lastUserMessageAt -----------------------------------------

test('lastUserMessageAt ignores the character own proactive messages', async () => {
  // Regression guard for the cooldown arming itself. Proactive rows carry the
  // owner's userId as sender, exactly like user-authored rows, so only the
  // jsonb marker separates them. If they counted, a wake-up posted at T would
  // read its own message back as "the user just spoke" and suppress notify for
  // the whole cooldown window.
  const userSpokeAt = new Date(NOW.getTime() - 6 * 60 * 60_000)
  await insertMessage({ message_data: '{}', created_at: userSpokeAt })
  await insertMessage({
    message_data: JSON.stringify({ proactive: true }),
    created_at: new Date(NOW.getTime() - 60_000),
  })

  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)

  assert.equal(
    ctx.lastUserMessageAt?.toISOString(),
    userSpokeAt.toISOString(),
    'the proactive message must not count as the user speaking',
  )
})

test('lastUserMessageAt is null when the user has never spoken', async () => {
  const id = await insertWakeup()
  const ctx = await deps.loadContext(dueRowFor(id), NOW, DAY_START)
  assert.equal(ctx.lastUserMessageAt, null)
})

// --- reapStaleClaims / deleteExpired ----------------------------------------

test('reapStaleClaims resolves abandoned claims and leaves fresh ones alone', async () => {
  const cutoff = new Date(NOW.getTime() - 5 * 60_000)
  await insertWakeup({
    id: 'r-stale',
    status: 'claimed',
    claimed_at: new Date(cutoff.getTime() - 60_000),
  })
  await insertWakeup({
    id: 'r-stale-running',
    status: 'running',
    claimed_at: new Date(cutoff.getTime() - 60_000),
  })
  await insertWakeup({ id: 'r-fresh', status: 'claimed', claimed_at: NOW })

  const reaped = await deps.reapStaleClaims(cutoff)

  assert.equal(reaped, 2)
  const { rows } = await getPool().query(
    'SELECT id, status, outcome, resolved_at FROM scheduled_wakeups ORDER BY id',
  )
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.equal(byId['r-stale'].outcome, 'stale_claim')
  // A resolved_at is what lets ordinary retention collect the row later; a
  // reaped row with a NULL resolved_at would leak forever.
  assert.ok(byId['r-stale'].resolved_at, 'reaped rows must get a resolved_at')
  assert.equal(byId['r-fresh'].status, 'claimed', 'a live turn must not be reaped out from under')
})

test('deleteExpired removes resolved rows past the cutoff and keeps unresolved ones', async () => {
  const cutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000)
  await insertWakeup({
    id: 'd-old',
    status: 'done',
    resolved_at: new Date(cutoff.getTime() - 60_000),
  })
  await insertWakeup({ id: 'd-recent', status: 'done', resolved_at: NOW })
  await insertWakeup({ id: 'd-pending', status: 'pending' })

  const deleted = await deps.deleteExpired(cutoff)

  assert.equal(deleted, 1)
  const { rows } = await getPool().query('SELECT id FROM scheduled_wakeups ORDER BY id')
  assert.deepEqual(
    rows.map((r) => r.id),
    ['d-pending', 'd-recent'],
  )
})
