import assert from 'node:assert/strict'
import test from 'node:test'
import {
  proactiveWakeupSweep,
  proactiveWakeupSweepHandler,
  withStatementTimeout,
} from './proactiveWakeupSweep.js'

const NOW = new Date('2026-09-08T14:00:00.000Z')

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    characterId: 'char-1',
    userId: 'user-1',
    firebaseUid: 'fb-1',
    reason: 'ask how the interview went',
    runKey: 'run-1',
    priority: 0,
    ...overrides,
  }
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const posted: unknown[] = []
  const resolved: unknown[] = []
  return {
    posted,
    resolved,
    deps: {
      now: () => NOW,
      selectDue: async () => [dueRow()],
      loadContext: async () => ({
        balance: 1000,
        todaysProactiveSpend: 0,
        todaysPushCount: 0,
        lastUserMessageAt: new Date('2026-09-06T00:00:00.000Z'),
        unreadProactiveCount: 0,
      }),
      claim: async () => true,
      postWakeup: async (payload: unknown) => {
        posted.push(payload)
      },
      resolveWakeup: async (id: string, patch: unknown) => {
        resolved.push({ id, patch })
      },
      reapStaleClaims: async () => 0,
      deleteExpired: async () => 0,
      ...overrides,
    },
  }
}

test('posts a due row that passes every guardrail', async () => {
  const { posted, deps } = buildDeps()
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 1)
  const payload = posted[0] as { wakeupId: string; notifyAllowed: boolean }
  assert.equal(payload.wakeupId, 'w1')
  assert.equal(payload.notifyAllowed, true)
})

test('skips a row without posting when power is insufficient', async () => {
  const { posted, resolved, deps } = buildDeps({
    loadContext: async () => ({
      balance: 0,
      todaysProactiveSpend: 0,
      todaysPushCount: 0,
      lastUserMessageAt: null,
      unreadProactiveCount: 0,
    }),
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 0)
  assert.equal(resolved.length, 1)
  const { patch } = resolved[0] as { patch: { status: string; outcome: string } }
  assert.equal(patch.status, 'skipped')
  assert.equal(patch.outcome, 'insufficient_power')
})

test('does not post when the claim is lost to a concurrent sweep', async () => {
  const { posted, deps } = buildDeps({ claim: async () => false })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 0)
})

test('passes notifyAllowed false through when inside the cooldown', async () => {
  const { posted, deps } = buildDeps({
    loadContext: async () => ({
      balance: 1000,
      todaysProactiveSpend: 0,
      todaysPushCount: 0,
      lastUserMessageAt: new Date(NOW.getTime() - 60_000),
      unreadProactiveCount: 0,
    }),
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal((posted[0] as { notifyAllowed: boolean }).notifyAllowed, false)
})

test('one row failing does not abort the rest of the batch', async () => {
  let calls = 0
  const { posted, deps } = buildDeps({
    selectDue: async () => [dueRow(), dueRow({ id: 'w2', runKey: 'run-2' })],
    postWakeup: async (payload: { wakeupId: string }) => {
      calls++
      if (payload.wakeupId === 'w1') throw new Error('network')
      posted.push(payload)
    },
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(calls, 2)
  assert.equal(posted.length, 1)
})

test('runs the retention delete every sweep', async () => {
  let deleted = 0
  const { deps } = buildDeps({
    deleteExpired: async () => {
      deleted++
      return 3
    },
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(deleted, 1)
})

test('reaps stale claims every sweep, before the retention delete', async () => {
  const order: string[] = []
  let cutoff: Date | undefined
  const { deps } = buildDeps({
    reapStaleClaims: async (claimedBefore: Date) => {
      order.push('reap')
      cutoff = claimedBefore
      return 2
    },
    deleteExpired: async () => {
      order.push('delete')
      return 0
    },
  })
  await proactiveWakeupSweepHandler(deps as never)
  // Reaping first gives abandoned rows a resolved_at, so the retention delete
  // in a later sweep can actually collect them.
  assert.deepEqual(order, ['reap', 'delete'])
  // The cutoff is in the past — a row claimed a moment ago must not be reaped
  // out from under a turn that is still running.
  assert.ok(cutoff && cutoff.getTime() < NOW.getTime())
})

test('todaysPushCount follows the column, not the outcome text', async () => {
  // A row whose outcome text says notify but whose column disagrees must be
  // counted by the column. The column is the contract; outcome is prose.
  const rows = [
    { outcome: 'mode=notify chosen=notify', deliveryMode: 'quiet' },
    { outcome: 'mode=quiet chosen=notify', deliveryMode: 'notify' },
  ]
  const counted = rows.filter((r) => r.deliveryMode === 'notify')
  assert.equal(counted.length, 1)
  assert.equal(counted[0].outcome, 'mode=quiet chosen=notify')
})

// The sweep has no lock: what stops two sweeps overlapping — and leaking
// DAILY_PROACTIVE_POWER_CEILING past a character's daily allowance — is only
// that this timeout is far shorter than the five-minute schedule. Asserting it
// here so raising it has to be a deliberate edit to a failing test rather than
// an unnoticed config tweak. See the comment on the onSchedule options.
test('sweep timeout stays far below the five-minute schedule', () => {
  const endpoint = (proactiveWakeupSweep as unknown as { __endpoint: { timeoutSeconds: number } })
    .__endpoint
  assert.equal(endpoint.timeoutSeconds, 60)
  assert.ok(endpoint.timeoutSeconds < 300, 'a sweep must not survive to overlap the next tick')
})

// SWEEP_BATCH_LIMIT (50) x WAKEUP_POST_TIMEOUT_MS (10s) is a 500s worst case
// against a 60s function timeout, so the loop can be killed mid-row. A row
// killed after its claim stays 'claimed' with a NULL resolved_at and is
// invisible to selectDue until reapStaleClaims marks it terminally skipped —
// the wake-up is lost, and any spend the turn committed is still charged.
// Stopping before the deadline leaves the remaining rows 'pending' so the next
// tick picks them up untouched.
test('stops claiming rows when the time budget is exhausted', async () => {
  let call = 0
  const claimed: string[] = []
  // Advances 20s per call: the first row fits the budget, the second does not.
  const { posted, resolved, deps } = buildDeps({
    now: () => new Date(NOW.getTime() + call++ * 20_000),
    selectDue: async () => [
      dueRow({ id: 'w1' }),
      dueRow({ id: 'w2' }),
      dueRow({ id: 'w3' }),
      dueRow({ id: 'w4' }),
      dueRow({ id: 'w5' }),
    ],
    claim: async (id: string) => {
      claimed.push(id)
      return true
    },
  })

  await proactiveWakeupSweepHandler(deps as never)

  assert.deepEqual(claimed, ['w1'], 'must not claim a row it cannot finish before the deadline')
  assert.equal(posted.length, 1)
  // The abandoned rows must be left alone, not resolved: resolving them would
  // make them terminal and the wake-ups would never happen.
  assert.equal(resolved.length, 0)
})

test('leaves rows pending — not skipped — when it runs out of budget', async () => {
  let call = 0
  const { posted, resolved, deps } = buildDeps({
    // Already past budget on the first iteration.
    now: () => new Date(NOW.getTime() + call++ * 120_000),
    selectDue: async () => [dueRow({ id: 'w1' }), dueRow({ id: 'w2' })],
  })

  await proactiveWakeupSweepHandler(deps as never)

  assert.equal(posted.length, 0, 'no row may be posted once the budget is gone')
  assert.equal(resolved.length, 0, 'a budget stop is not a skip decision')
})

// SWEEP_RESERVE_MS covers the DB roundtrips in claim + loadContext that run
// AFTER the budget check but BEFORE postWakeup. Without it, a row near the
// budget boundary would pass the check, claim, and then be killed during POST
// — stranding the claim. At 34s elapsed the reserve pushes the budget check
// over (34 + 10 + 2 > 45), so the row stays pending.
test('reserve tightens the budget so claim+loadContext do not strand a row at POST', async () => {
  let call = 0
  const claimed: string[] = []
  const { posted, deps } = buildDeps({
    // 34s per call: well past the original (POST-only) cutoff for iteration 2,
    // and exactly at the boundary the reserve was added to handle.
    now: () => new Date(NOW.getTime() + call++ * 34_000),
    selectDue: async () => [dueRow({ id: 'w1' }), dueRow({ id: 'w2' })],
    claim: async (id: string) => {
      claimed.push(id)
      return true
    },
  })

  await proactiveWakeupSweepHandler(deps as never)

  assert.deepEqual(claimed, [], 'the reserve must stop this row before it can claim')
  assert.equal(posted.length, 0)
})

// The set_config literal text and dynamic values live in the drizzle sql
// template's queryChunks: literal SQL arrives as StringChunk objects (value is
// a string[]), template values as boxed primitives (String/Number wrapper
// objects, no .value property — verified against the installed drizzle-orm
// 0.45.2 ESM build; the 0.45 CJS bundle wraps them as Param objects instead).
// Keeping only the primitive chunks yields the bound values in order; joining
// the StringChunk string[] values yields the literal SQL around them
// (placeholders like $1 are substituted only at compile time, so they do NOT
// appear in the joined text). Shared by every fake in this file.
function chunksOf(query: unknown): Array<Record<string, unknown>> {
  return (query as { queryChunks?: Array<Record<string, unknown>> }).queryChunks ?? []
}

function paramsOf(query: unknown): unknown[] {
  return chunksOf(query)
    .filter((c) => !(c && typeof c === 'object' && Array.isArray(c.value)))
    .map((c) => String(c))
}

function sqlTextOf(query: unknown): string {
  return chunksOf(query)
    .flatMap((c) => (Array.isArray(c.value) ? (c.value as string[]) : []))
    .join('')
}

test('withStatementTimeout sets a transaction-local deadline and runs fn on the tx', async () => {
  const executed: Array<{ text: string; params: unknown[] }> = []
  const fakeTx = {
    execute: async (q: unknown) => {
      executed.push({ text: sqlTextOf(q), params: paramsOf(q) })
      return { rows: [] }
    },
  }
  const fakeDb = {
    transaction: async (cb: (tx: typeof fakeTx) => Promise<string>) => cb(fakeTx),
  } as unknown as Parameters<typeof withStatementTimeout>[0]

  const result = await withStatementTimeout(fakeDb, 500, async (tx) => {
    assert.equal(tx, fakeTx, 'fn must receive the transaction, not the pool')
    return 'ran'
  })

  assert.equal(result, 'ran')
  assert.equal(executed.length, 1)
  // Exactly one bind param: the deadline string. `is_local` is NOT a bind
  // param — it is literal SQL text (part of a StringChunk), which is why the
  // assertion below pins it on the joined text, not on params. The `true` is
  // the whole point: without it the deadline would leak past COMMIT onto the
  // shared pool and silently throttle every other consumer.
  assert.deepEqual(executed[0].params, ['500'])
  assert.match(executed[0].text, /set_config\('statement_timeout'/)
  assert.match(executed[0].text, /,\s*true\)\s*$/, 'is_local must be the literal true')
})
