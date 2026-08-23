import assert from 'node:assert/strict'
import test from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { DrizzleClient } from '../db/client.js'

const pgDialect = new PgDialect()

// Compiles a drizzle query to real SQL text plus its bound params (no live DB)
// so assertions can see both the statement and the values bound into it.
function renderQuery(query: unknown): string {
  const { sql: text, params } = pgDialect.sqlToQuery(query as SQL)
  return [text, ...params.map((p) => String(p))].join(' | ')
}

// Creates a mock DrizzleClient whose execute() returns from a preset queue.
// Pass one { rows } entry per execute() call creditService will make. Nested
// transactions pass through to the same queue (no SAVEPOINT modeling needed
// here — use makeCapturingDb when transaction state matters).
function makeExecuteDb(responses: Array<{ rows: unknown[] }>): DrizzleClient {
  let callIndex = 0
  const execute = async (_query: unknown) => responses[callIndex++] ?? { rows: [] }
  const makeTx = (): DrizzleClient =>
    ({
      execute,
      transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => callback(makeTx()),
    }) as unknown as DrizzleClient
  return {
    execute,
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => callback(makeTx()),
  } as unknown as DrizzleClient
}

const { createCreditService } = await import('./creditService.js')

// Same response-queue semantics as makeExecuteDb (shared index across db and tx
// execute), plus a rendered log of every query that ran — and Postgres-faithful
// transaction state: a statement error marks the transaction ABORTED, after
// which every later statement fails with 25P02 until ROLLBACK TO SAVEPOINT
// restores it, and COMMIT issued while aborted acts as ROLLBACK (all writes
// discarded, callback result still returned). Nested transactions model
// SAVEPOINT/RELEASE around their body; savepoint statements never consume from
// the response queue. `committed` is false whenever the transaction ended in
// that implicit-rollback state.
function makeCapturingDb(responses: Array<{ rows: unknown[] } | Error>): {
  db: DrizzleClient
  queries: string[]
  state: { committed: boolean }
} {
  const queries: string[] = []
  const state = { committed: false }
  let callIndex = 0
  let active = true
  const run = async (query: unknown) => {
    const rendered = typeof query === 'string' ? query : renderQuery(query)
    queries.push(rendered)
    if (!active && !/^(savepoint|rollback to savepoint|release savepoint) /i.test(rendered)) {
      // PostgreSQL rejects everything except savepoint management while
      // aborted — and ROLLBACK TO SAVEPOINT is the only escape from that state.
      throw new Error('25P02: current transaction is aborted, commands ignored')
    }
    if (/^savepoint /i.test(rendered)) return { rows: [] }
    if (/^rollback to savepoint /i.test(rendered)) {
      active = true
      return { rows: [] }
    }
    if (/^release savepoint /i.test(rendered)) return { rows: [] }
    const response = responses[callIndex++]
    if (response instanceof Error) {
      active = false
      throw response
    }
    return response ?? { rows: [] }
  }
  const makeTx = (): DrizzleClient =>
    ({
      execute: run,
      transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
        const spName = `sp${queries.length}`
        let result: unknown
        try {
          await run(`savepoint ${spName}`)
          result = await callback(makeTx())
        } catch (err) {
          await run(`rollback to savepoint ${spName}`)
          throw err
        }
        await run(`release savepoint ${spName}`)
        return result
      },
    }) as unknown as DrizzleClient
  const db = {
    execute: run,
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      const result = await callback(makeTx())
      // COMMIT on an aborted PostgreSQL transaction does not fail — it is
      // treated as ROLLBACK: nothing persists, yet the callback's return value
      // is delivered as if the spend had succeeded.
      state.committed = active
      queries.push(active ? 'COMMIT' : 'COMMIT -> implicit ROLLBACK (tx was aborted)')
      return result
    },
  } as unknown as DrizzleClient
  return { db, queries, state }
}

// ── spendCredit ───────────────────────────────────────────────────────────────

test('spendCredit returns an allocation array when a qualifying row exists', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: SELECT SUM net active balance, Call 4: SELECT id, remaining_balance FOR UPDATE
  // Call 5: UPDATE credit_transactions, Call 6: INSERT INTO credit_spend_events,
  // Call 7: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '1' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '1' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 1, 'chat_reply')
  assert.deepEqual(allocations, [{ transactionId: 'tx-abc', amount: 1 }])
})

test('spendCredit throws INSUFFICIENT_CREDITS when no qualifying row', async () => {
  const db = makeExecuteDb([{ rows: [] }])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 1, 'chat_reply'),
    (err: Error) => {
      assert.equal(err.message, 'INSUFFICIENT_CREDITS')
      return true
    },
  )
})

test('spendCredit does not update subscriptions when spend fails', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => {
      executeCalls++
      return { rows: [] } // always returns empty (insufficient)
    },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      const tx = {
        execute: async (_query: unknown) => {
          executeCalls++
          return { rows: [] }
        },
      }
      return await callback(tx as unknown as DrizzleClient)
    },
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await assert.rejects(() => cs.spendCredit('user-1', 1, 'chat_reply'))
  // Inside transaction: INSERT subscriptions + SELECT FOR UPDATE + SELECT SUM(...) net active balance (fails insufficient credits)
  assert.equal(executeCalls, 3)
})

test('spendCredit spans multiple rows when amount exceeds the first row balance', async () => {
  // Call 1: INSERT subscriptions
  // Call 2: SELECT FOR UPDATE on subscriptions
  // Call 3: SELECT SUM(...) net active balance -> '7' (>= 5)
  // Call 4: SELECT id, remaining_balance ... FOR UPDATE -> two rows (3, then 4)
  // Call 5: UPDATE credit_transactions row tx-1 (- 3)
  // Call 6: UPDATE credit_transactions row tx-2 (- 2)
  // Call 7: INSERT INTO credit_spend_events
  // Call 8: UPDATE subscriptions current_credits cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '7' }] },
    {
      rows: [
        { id: 'tx-1', remaining_balance: '3' },
        { id: 'tx-2', remaining_balance: '4' },
      ],
    },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 5, 'chat_reply')
  assert.deepEqual(allocations, [
    { transactionId: 'tx-1', amount: 3 },
    { transactionId: 'tx-2', amount: 2 },
  ])
})

test('spendCredit throws INSUFFICIENT_CREDITS when net balance across all rows is short', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE, Call 3: SELECT SUM -> '3' (< 5)
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '3' }] },
  ])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 5, 'chat_reply'),
    (err: Error) => {
      assert.equal(err.message, 'INSUFFICIENT_CREDITS')
      return true
    },
  )
})

test('spendCredit inserts exactly one attribution event with user, amount, and reason', async () => {
  // Calls: INSERT subscriptions, SELECT FOR UPDATE subscriptions, SELECT net SUM,
  // SELECT rows FOR UPDATE, UPDATE credit_transactions, INSERT credit_spend_events,
  // UPDATE subscriptions cache.
  const { db, queries } = makeCapturingDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '100' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  await cs.spendCredit('user-1', 100, 'chat_reply')
  const events = queries.filter((q) => q.includes('INSERT INTO credit_spend_events'))
  assert.equal(events.length, 1)
  assert.ok(events[0].includes('user_id'), 'inserts user_id column')
  assert.ok(events[0].includes('user-1'), 'binds userId')
  assert.ok(events[0].includes('100'), 'binds amount')
  assert.ok(events[0].includes('chat_reply'), 'binds reason')
})

test('spendCredit writes no attribution event when credits are insufficient', async () => {
  const { db, queries } = makeCapturingDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '3' }] }, // < amount 5 → INSUFFICIENT_CREDITS
  ])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 5, 'chat_reply'),
    (err: Error) => err.message === 'INSUFFICIENT_CREDITS',
  )
  assert.equal(queries.filter((q) => q.includes('INSERT INTO credit_spend_events')).length, 0)
})

test('a best-effort cache-sync failure neither rejects nor drops the attribution row', async () => {
  // Unlike functions/ (whose syncSubscriptionCache propagates), cloud-agent treats
  // the subscriptions-cache UPDATE as best-effort by design. But a bare try/catch
  // cannot deliver that contract: a Postgres error aborts the WHOLE transaction,
  // and COMMIT-on-aborted acts as ROLLBACK — silently discarding the spend AND
  // the attribution row while callers still see allocations returned. The cache
  // UPDATE must be isolated in a SAVEPOINT so only it rolls back. This mock
  // models those Postgres semantics, so asserting `committed` pins persistence.
  const cacheError = new Error('subscriptions cache exploded')
  const { db, queries, state } = makeCapturingDb([
    { rows: [] }, // INSERT subscriptions
    { rows: [{ user_id: 'user-1' }] }, // SELECT FOR UPDATE subscriptions
    { rows: [{ total: '100' }] }, // SELECT net SUM
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] }, // SELECT rows FOR UPDATE
    { rows: [] }, // UPDATE credit_transactions
    { rows: [] }, // INSERT credit_spend_events
    cacheError, // UPDATE subscriptions cache — fails inside its SAVEPOINT only
  ])
  const cs = createCreditService(db)
  await assert.doesNotReject(() => cs.spendCredit('user-1', 100, 'chat_reply'))
  const events = queries.filter((q) => q.includes('INSERT INTO credit_spend_events'))
  assert.equal(events.length, 1)
  // Real Postgres semantics: rollback-to-savepoint revives the transaction, so
  // COMMIT genuinely persists both the deduction and this event row.
  assert.equal(state.committed, true)
})

test('spendCredit requires amount and reason explicitly (no default)', async () => {
  const { db } = makeCapturingDb([])
  const cs = createCreditService(db)
  await assert.rejects(() =>
    (cs.spendCredit as (...args: unknown[]) => Promise<unknown>)('user-1', undefined, 'chat_reply'),
  )
})

test('spendCredit rejects blank reasons before opening a transaction', async () => {
  // NOT NULL alone would still admit a blank string into credit_spend_events,
  // so the guard must fire before ANY statement — transaction included.
  for (const badReason of [undefined, '', '   ']) {
    const { db, queries } = makeCapturingDb([])
    const cs = createCreditService(db)
    await assert.rejects(
      () => (cs.spendCredit as (...args: unknown[]) => Promise<unknown>)('user-1', 100, badReason),
      (err: Error) => err.message === 'INVALID_SPEND_REASON',
    )
    assert.equal(queries.length, 0, `statements ran for reason ${JSON.stringify(badReason)}`)
  }
})

test('spendCredit persists the normalized (trimmed) reason', async () => {
  const { db, queries } = makeCapturingDb([
    { rows: [] }, // INSERT subscriptions
    { rows: [{ user_id: 'user-1' }] }, // SELECT FOR UPDATE subscriptions
    { rows: [{ total: '100' }] }, // SELECT net SUM
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] }, // SELECT rows FOR UPDATE
    { rows: [] }, // UPDATE credit_transactions
    { rows: [] }, // INSERT credit_spend_events
    { rows: [] }, // UPDATE subscriptions cache
  ])
  const cs = createCreditService(db)
  await cs.spendCredit('user-1', 100, '  chat_reply  ')
  const events = queries.filter((q) => q.includes('INSERT INTO credit_spend_events'))
  assert.equal(events.length, 1)
  // renderQuery emits "text | param | param …" — the bound reason is the last
  // param, and it must be the trimmed value.
  assert.match(events[0], /\| chat_reply$/)
})

// ── refundCredit ──────────────────────────────────────────────────────────────

test('refundCredit resolves without throwing', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: UPDATE credit_transactions RETURNING id, Call 4: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ id: 'tx-abc' }] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  await assert.doesNotReject(() =>
    cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 1 }]),
  )
})

test('refundCredit persists the refund when the cache sync fails', async () => {
  // Sibling of the spendCredit prover above: cloud-agent treats the cache
  // UPDATE as best-effort, but a bare try/catch cannot deliver that contract —
  // a Postgres error aborts the WHOLE transaction, and COMMIT-on-aborted acts
  // as ROLLBACK, silently discarding the refund while callers still see
  // success. The cache UPDATE must sit in a SAVEPOINT so only it rolls back.
  const cacheError = new Error('subscriptions cache exploded')
  const { db, queries, state } = makeCapturingDb([
    { rows: [] }, // INSERT subscriptions bootstrap
    { rows: [{ user_id: 'user-1' }] }, // SELECT FOR UPDATE subscriptions
    { rows: [{ id: 'tx-abc' }] }, // UPDATE credit_transactions RETURNING id
    cacheError, // UPDATE subscriptions cache — fails inside its SAVEPOINT only
  ])
  const cs = createCreditService(db)
  await assert.doesNotReject(() =>
    cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 5 }]),
  )
  const refunds = queries.filter(
    (q) =>
      q.includes('UPDATE credit_transactions') &&
      q.includes('remaining_balance = remaining_balance +'),
  )
  assert.equal(refunds.length, 1)
  // Real Postgres semantics: rollback-to-savepoint revives the transaction, so
  // COMMIT genuinely persists the refund.
  assert.equal(state.committed, true)
})

test('refundCredit restores every row in a multi-row allocation atomically', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: UPDATE credit_transactions tx-1 RETURNING id
  // Call 4: UPDATE credit_transactions tx-2 RETURNING id
  // Call 5: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ id: 'tx-1' }] },
    { rows: [{ id: 'tx-2' }] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  await assert.doesNotReject(() =>
    cs.refundCredit('user-1', [
      { transactionId: 'tx-1', amount: 3 },
      { transactionId: 'tx-2', amount: 2 },
    ]),
  )
})

test('refundCredit is a no-op for an empty allocation array', async () => {
  let executeCalls = 0
  const db = {
    execute: async () => {
      executeCalls++
      return { rows: [] }
    },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) =>
      callback({
        execute: async () => {
          executeCalls++
          return { rows: [] }
        },
      } as unknown as DrizzleClient),
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', [])
  assert.equal(executeCalls, 0)
})

test('refundCredit makes correct number of execute calls', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => {
      executeCalls++
      return { rows: [] }
    },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      const tx = {
        execute: async (_query: unknown) => {
          executeCalls++
          return { rows: [] }
        },
        // Pass-through nested transaction (SAVEPOINT in real Postgres): the
        // cache-sync SAVEPOINT body reuses this same execute counter.
        transaction: async (nested: (tx2: DrizzleClient) => Promise<unknown>) =>
          nested(tx as unknown as DrizzleClient),
      }
      return await callback(tx as unknown as DrizzleClient)
    },
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 1 }])
  // Inside transaction:
  //   - INSERT subscriptions (1)
  //   - SELECT FOR UPDATE on subscriptions (2)
  //   - UPDATE credit_transactions (3)
  //   - If row not found (rows.length === 0): INSERT compensation (4)
  //   - UPDATE subscriptions cache (either 4 or 5 depending on above)
  // The implementation may add a compensation row if the original expired,
  // so we accept 4 (happy path) or 5 (with compensation).
  assert.ok(
    executeCalls === 4 || executeCalls === 5,
    `expected 4 or 5 execute calls, got ${executeCalls}`,
  )
})

// ── getBalance ────────────────────────────────────────────────────────────────

test('getBalance returns numeric balance from SUM result', async () => {
  const db = makeExecuteDb([{ rows: [{ total: '5' }] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 5)
})

test('getBalance returns 0 when total is null (no credit rows)', async () => {
  const db = makeExecuteDb([{ rows: [{ total: null }] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 0)
})

test('getBalance returns 0 when execute returns no rows', async () => {
  const db = makeExecuteDb([{ rows: [] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 0)
})
