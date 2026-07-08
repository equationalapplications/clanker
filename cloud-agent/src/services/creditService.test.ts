import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

// Creates a mock DrizzleClient whose execute() returns from a preset queue.
// Pass one { rows } entry per execute() call creditService will make.
function makeExecuteDb(responses: Array<{ rows: unknown[] }>): DrizzleClient {
  let callIndex = 0
  return {
    execute: async (_query: unknown) => responses[callIndex++] ?? { rows: [] },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      // Create a transaction mock that uses the same execute mock
      const tx = {
        execute: async (_query: unknown) => responses[callIndex++] ?? { rows: [] },
      }
      return await callback(tx as unknown as DrizzleClient)
    },
  } as unknown as DrizzleClient
}

const { createCreditService } = await import('./creditService.js')

// ── spendCredit ───────────────────────────────────────────────────────────────

test('spendCredit returns an allocation array when a qualifying row exists', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: SELECT SUM net active balance, Call 4: SELECT id, remaining_balance FOR UPDATE
  // Call 5: UPDATE credit_transactions, Call 6: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '1' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '1' }] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 1)
  assert.deepEqual(allocations, [{ transactionId: 'tx-abc', amount: 1 }])
})

test('spendCredit throws INSUFFICIENT_CREDITS when no qualifying row', async () => {
  const db = makeExecuteDb([{ rows: [] }])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1'),
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
      return { rows: [] }  // always returns empty (insufficient)
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
  await assert.rejects(() => cs.spendCredit('user-1'))
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
  // Call 7: UPDATE subscriptions current_credits cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '7' }] },
    { rows: [{ id: 'tx-1', remaining_balance: '3' }, { id: 'tx-2', remaining_balance: '4' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 5)
  assert.deepEqual(allocations, [
    { transactionId: 'tx-1', amount: 3 },
    { transactionId: 'tx-2', amount: 2 },
  ])
})

test('spendCredit throws INSUFFICIENT_CREDITS when net balance across all rows is short', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE, Call 3: SELECT SUM -> '3' (< 5)
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [{ total: '3' }] }])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 5),
    (err: Error) => {
      assert.equal(err.message, 'INSUFFICIENT_CREDITS')
      return true
    },
  )
})

test('spendCredit defaults amount to 100 when not passed', async () => {
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '100' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1')
  assert.deepEqual(allocations, [{ transactionId: 'tx-abc', amount: 100 }])
})

// ── refundCredit ──────────────────────────────────────────────────────────────

test('refundCredit resolves without throwing', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: UPDATE credit_transactions RETURNING id, Call 4: UPDATE subscriptions cache
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [{ id: 'tx-abc' }] }, { rows: [] }])
  const cs = createCreditService(db)
  await assert.doesNotReject(() => cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 1 }]))
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
    execute: async () => { executeCalls++; return { rows: [] } },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) =>
      callback({ execute: async () => { executeCalls++; return { rows: [] } } } as unknown as DrizzleClient),
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', [])
  assert.equal(executeCalls, 0)
})

test('refundCredit makes correct number of execute calls', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => { executeCalls++; return { rows: [] } },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      const tx = {
        execute: async (_query: unknown) => { executeCalls++; return { rows: [] } },
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
  assert.ok(executeCalls === 4 || executeCalls === 5,
    `expected 4 or 5 execute calls, got ${executeCalls}`)
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