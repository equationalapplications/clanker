import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

// Creates a mock DrizzleClient whose execute() returns from a preset queue.
// Pass one { rows } entry per execute() call creditService will make.
function makeExecuteDb(responses: Array<{ rows: unknown[] }>): DrizzleClient {
  let callIndex = 0
  return {
    execute: async (_query: unknown) => responses[callIndex++] ?? { rows: [] },
  } as unknown as DrizzleClient
}

const { createCreditService } = await import('./creditService.js')

// ── spendCredit ───────────────────────────────────────────────────────────────

test('spendCredit returns txId when a qualifying row exists', async () => {
  // Call 1: INSERT subscriptions (ensure row exists)
  // Call 2: SELECT FOR UPDATE on subscriptions (lock ordering)
  // Call 3: UPDATE credit_transactions RETURNING id
  // Call 4: UPDATE subscriptions SET current_credits - 1
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [{ id: 'tx-abc' }] }, { rows: [] }])
  const cs = createCreditService(db)
  const txId = await cs.spendCredit('user-1')
  assert.equal(txId, 'tx-abc')
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
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await assert.rejects(() => cs.spendCredit('user-1'))
  // INSERT subscriptions + SELECT FOR UPDATE + UPDATE credit_transactions (fails)
  assert.equal(executeCalls, 3)
})

// ── refundCredit ──────────────────────────────────────────────────────────────

test('refundCredit resolves without throwing', async () => {
  // Call 1: INSERT subscriptions (ensure row exists)
  // Call 2: SELECT FOR UPDATE on subscriptions (lock ordering)
  // Call 3: UPDATE credit_transactions SET remaining_balance + 1
  // Call 4: UPDATE subscriptions SET current_credits + 1
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [] }, { rows: [] }])
  const cs = createCreditService(db)
  await assert.doesNotReject(() => cs.refundCredit('user-1', 'tx-abc'))
})

test('refundCredit makes exactly four execute calls', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => { executeCalls++; return { rows: [] } },
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', 'tx-abc')
  assert.equal(executeCalls, 4)
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