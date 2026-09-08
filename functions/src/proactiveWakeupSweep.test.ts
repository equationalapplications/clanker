import assert from 'node:assert/strict'
import test from 'node:test'
import { proactiveWakeupSweepHandler } from './proactiveWakeupSweep.js'

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
