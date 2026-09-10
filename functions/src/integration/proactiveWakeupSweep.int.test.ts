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
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { buildSweepDeps, type DueWakeup } from '../proactiveWakeupSweep.js'
import { UNREAD_STALENESS_ESCAPE_MS } from '../services/proactiveWakeupGuardrails.js'
import {
  ensureIntegrationDatabase,
  testGetDb,
  seedUser,
  truncateAll,
  closeIntegrationPool,
  getPool,
  resolveTestUrl,
} from './helpers/db.js'

/**
 * Block until `expected` backends are parked on a lock, so a test can know both
 * racers are inside the contended window before it releases them. Bounded, and
 * fails loudly rather than hanging: never reaching the count means the race was
 * not set up and any assertion after it would be vacuous.
 */
async function waitForBlockedBackends(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS blocked
         FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )
    if (rows[0].blocked >= expected) return
    await delay(50)
  }
  assert.fail(`timed out waiting for ${expected} lock-blocked backends; the race never formed`)
}

// drizzle may hand back the pg error as-is or wrapped in its own error type
// (cause chain); walk it either way.
function expectQueryCanceled(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 5 && cur; depth++) {
    const e = cur as { code?: string; cause?: unknown }
    if (e.code === '57014') return true
    cur = e.cause
  }
  assert.fail(`expected a 57014 query_canceled error, got ${String(err)}`)
}

/**
 * Runs fn inside a transaction on a dedicated pooled client, so the test can
 * take locks that park the sweep's statements. Always rolls back — the locks
 * exist only to block, never to leave state behind.
 */
async function withBlockingSession(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

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

/**
 * One dynamic INSERT builder for all the local seeders, so the cols/placeholders
 * construction lives in exactly one place (it was previously copied verbatim
 * into each seeder, free to drift independently). Column names stay raw strings
 * because these fixtures deliberately write pre-Drizzle SQL shapes (snake_case
 * defaults overridden per test); the helpers/db.ts seedUser convention covers
 * the typed path.
 */
async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row)
  const params = cols.map((_, i) => `$${i + 1}`)
  await getPool().query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${params.join(', ')})`,
    Object.values(row),
  )
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
  await insertRow('scheduled_wakeups', row)
  return row.id as string
}

let messageSeq = 0
async function insertMessage(fields: Record<string, unknown> = {}): Promise<void> {
  messageSeq += 1
  await insertRow('messages', {
    character_id: characterId,
    sender_user_id: userId,
    message_id: `m-${messageSeq}`,
    text: 'hello',
    message_data: '{}',
    created_at: NOW,
    ...fields,
  })
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

// A genuine race, forced rather than hoped for. Simply issuing two claims via
// Promise.all does NOT test atomicity: pg.Pool creates its second connection
// lazily, so the first claim completes during the second's TCP+auth handshake
// and the two never overlap — verified by mutation, where a non-atomic
// SELECT-then-UPDATE claim still passed that version of this test.
//
// So the interleave is constructed: a separate session takes a row lock, both
// claims are started and observed to block on it, and only then is the lock
// released. Both claimants are now inside the window at once.
//   - the real guarded UPDATE: one matches a 'pending' row, the other
//     re-evaluates the predicate under READ COMMITTED and matches nothing.
//   - a non-atomic SELECT-then-UPDATE: both SELECTs already read 'pending'
//     (an MVCC read takes no lock), so both would claim — and this test fails,
//     which is the whole point of it.
// Order between the two is not asserted, only that exactly one wins.
test('claim is atomic: concurrent claimants produce exactly one winner', async () => {
  const id = await insertWakeup()

  // Warm both pool connections before the race so connection setup cannot be
  // what separates the two claims in time.
  await Promise.all([getPool().query('SELECT 1'), getPool().query('SELECT 1')])

  const blocker = new pg.Client({ connectionString: resolveTestUrl() })
  await blocker.connect()
  let results: boolean[]
  try {
    await blocker.query('BEGIN')
    await blocker.query('SELECT id FROM scheduled_wakeups WHERE id = $1 FOR UPDATE', [id])

    const pending = Promise.all([deps.claim(id, NOW), deps.claim(id, NOW)])
    await waitForBlockedBackends(2)

    await blocker.query('COMMIT')
    results = await pending
  } finally {
    await blocker.end()
  }

  assert.equal(
    results.filter(Boolean).length,
    1,
    `exactly one concurrent claim must win, got ${JSON.stringify(results)}`,
  )

  const { rows } = await getPool().query('SELECT status FROM scheduled_wakeups WHERE id = $1', [id])
  assert.equal(rows[0].status, 'claimed')
})

test('claim refuses a row that is no longer pending', async () => {
  const done = await insertWakeup({ id: 'w-done', status: 'done', resolved_at: NOW })
  assert.equal(await deps.claim(done, NOW), false)
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

// --- resolveWakeup -----------------------------------------------------------

// The skip path's terminal write, and the second most powerful statement in the
// deps after claim: it sets status, outcome and resolved_at with an id
// predicate. The unit suite stubs it, so without this the `where(eq(id))` is
// never executed against a real table — a dropped or wrong predicate would
// rewrite unrelated characters' pending wake-ups to 'skipped' in production
// with both suites still green.
test('resolveWakeup marks exactly the named row terminal and stamps resolved_at', async () => {
  const target = await insertWakeup({ id: 'r-target' })
  const bystander = await insertWakeup({ id: 'r-bystander' })
  const otherCharacter = await insertWakeup({
    id: 'r-other-character',
    character_id: otherCharacterId,
  })

  await deps.resolveWakeup(target, { status: 'skipped', outcome: 'insufficient_power' })

  const { rows } = await getPool().query(
    'SELECT id, status, outcome, resolved_at FROM scheduled_wakeups ORDER BY id',
  )
  const byId = new Map(rows.map((r) => [r.id, r]))

  assert.equal(byId.get(target).status, 'skipped')
  assert.equal(byId.get(target).outcome, 'insufficient_power')
  assert.ok(byId.get(target).resolved_at instanceof Date, 'resolved_at must be stamped')

  for (const untouched of [bystander, otherCharacter]) {
    assert.equal(byId.get(untouched).status, 'pending', `${untouched} must be untouched`)
    assert.equal(byId.get(untouched).outcome, null)
    assert.equal(byId.get(untouched).resolved_at, null)
  }
})

// resolved_at is what makes a row collectable by deleteExpired; a claimed row
// that is resolved must stop being invisible to retention.
test('resolveWakeup gives a claimed row the resolved_at retention needs', async () => {
  const id = await insertWakeup({ id: 'r-claimed', status: 'claimed', claimed_at: NOW })

  await deps.resolveWakeup(id, { status: 'done', outcome: 'mode=quiet chosen=notify' })

  const { rows } = await getPool().query(
    'SELECT status, resolved_at FROM scheduled_wakeups WHERE id = $1',
    [id],
  )
  assert.equal(rows[0].status, 'done')
  assert.ok(rows[0].resolved_at instanceof Date)
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

// --- per-op statement deadlines (AC3) -----------------------------------------

// The claim UPDATE parks on a row lock held by another session.
// statement_timeout counts lock-wait time, so the parked UPDATE is canceled
// at CLAIM_DEADLINE_MS (500ms) — far below the pool's 10s backstop, proving
// the per-op deadline is what fired.
test('claim aborts with 57014 when its UPDATE exceeds CLAIM_DEADLINE_MS', async () => {
  const id = await insertWakeup()
  await withBlockingSession(async (lockHolder) => {
    await lockHolder.query('SELECT id FROM scheduled_wakeups WHERE id = $1 FOR UPDATE', [id])
    const deps = buildSweepDeps(testGetDb)
    const claimPromise = deps.claim(id, new Date())
    // Both sides are now inside the contended window; the deadline fires
    // mid-wait without any release, because statement_timeout covers it.
    await waitForBlockedBackends(1)
    await assert.rejects(claimPromise, expectQueryCanceled)
  })
  // Canceled mid-UPDATE and rolled back: the row is untouched, still pending
  // for the next tick — not claimed, not skipped.
  const { rows } = await getPool().query(
    'SELECT status, resolved_at FROM scheduled_wakeups WHERE id = $1',
    [id],
  )
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].resolved_at, null)
})

// loadContext's fourth read (the unread count over `messages`) parks on an
// ACCESS EXCLUSIVE table lock — MVCC reads do not block on row locks, so a
// table lock is what parks a SELECT. The row is claimed first the ordinary
// way: exactly the state the sweep is in when loadContext hangs.
test('loadContext aborts with 57014 when a read exceeds LOAD_CONTEXT_DEADLINE_MS', async () => {
  const id = await insertWakeup()
  await getPool().query(
    "UPDATE scheduled_wakeups SET status = 'claimed', claimed_at = now() WHERE id = $1",
    [id],
  )
  await withBlockingSession(async (lockHolder) => {
    await lockHolder.query('LOCK TABLE messages IN ACCESS EXCLUSIVE MODE')
    const deps = buildSweepDeps(testGetDb)
    const ctxPromise = deps.loadContext(dueRowFor(id), NOW, DAY_START)
    await waitForBlockedBackends(1)
    await assert.rejects(ctxPromise, expectQueryCanceled)
  })
  // Not resolved as skipped by anything: still claimed with a NULL
  // resolved_at, recovering via reapStaleClaims per the spec's stranding
  // semantics. The deadlines shrink how often the reaper is needed; they do
  // not replace it.
  const { rows } = await getPool().query(
    'SELECT status, resolved_at FROM scheduled_wakeups WHERE id = $1',
    [id],
  )
  assert.equal(rows[0].status, 'claimed')
  assert.equal(rows[0].resolved_at, null)
})
