// cloud-agent/src/handlers/proactiveWakeupHandler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import request from 'supertest'
import { createProactiveWakeupHandler, resolveDeliveryMode } from './proactiveWakeupHandler.js'

const body = {
  wakeupId: 'w1',
  characterId: '00000000-0000-4000-8000-000000000001',
  uid: 'firebase-uid-1',
  runKey: 'run-1',
  reason: 'ask how the interview went',
  notifyAllowed: true,
}

function buildApp(overrides: Partial<Parameters<typeof createProactiveWakeupHandler>[0]> = {}) {
  const calls = { spend: 0, refund: 0, resolved: [] as unknown[] }
  const deps = {
    resolveUserId: async () => 'user-db-id',
    loadCharacter: async () => ({
      id: 'char-1',
      name: 'Ada',
      appearance: null,
      traits: null,
      emotions: null,
      context: null,
    }),
    runAgent: async () => ({
      reply: 'Hi',
      toolCalls: ['deliver_wakeup'],
      deliveryMode: 'notify' as const,
    }),
    creditService: {
      spendCredit: async () => {
        calls.spend++
        return [{ transactionId: 'tx1', amount: 100 }]
      },
      refundCredit: async () => {
        calls.refund++
      },
      getBalance: async () => 1000,
    },
    resolveWakeup: async (id: string, patch: Record<string, unknown>) => {
      calls.resolved.push({ id, ...patch })
    },
    claimRunKey: async () => 'reserved' as const,
    ...overrides,
  }
  const app = express()
  app.use(express.json())
  app.post('/agent/proactive-wakeup', createProactiveWakeupHandler(deps as never))
  return { app, calls, deps }
}

test('rejects a malformed body', async () => {
  const { app } = buildApp()
  const res = await request(app).post('/agent/proactive-wakeup').send({ wakeupId: 'w1' })
  assert.equal(res.status, 400)
})

test('runs the turn, spends once and records the outcome', async () => {
  const { app, calls } = buildApp()
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(calls.spend, 1)
  assert.equal(calls.refund, 0)
  assert.equal(calls.resolved.length, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number; outcome: string }
  assert.equal(resolved.status, 'done')
  assert.equal(resolved.spentAmount, 100)
  assert.match(resolved.outcome, /notify/)
})

test('is idempotent on a duplicate run key: no second spend', async () => {
  const { app, calls } = buildApp({ claimRunKey: async () => 'duplicate' as const })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(calls.spend, 0)
})

test('returns 402 and does not run the turn when credits are exhausted', async () => {
  let ran = false
  const { app, calls } = buildApp({
    creditService: {
      spendCredit: async () => {
        throw new Error('INSUFFICIENT_CREDITS')
      },
      refundCredit: async () => {
        calls.refund++
      },
      getBalance: async () => 0,
    } as never,
    runAgent: (async () => {
      ran = true
      return { reply: '', toolCalls: [], deliveryMode: 'silent' as const }
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 402)
  assert.equal(ran, false)
})

test('refunds and records zero spend when the turn throws', async () => {
  const { app, calls } = buildApp({
    runAgent: (async () => {
      throw new Error('ADK exploded')
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 500)
  assert.equal(calls.refund, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number }
  assert.equal(resolved.status, 'skipped')
  assert.equal(resolved.spentAmount, 0)
})

test('downgrades notify to quiet when the sweeper forbade notifying', () => {
  assert.equal(resolveDeliveryMode('notify', false), 'quiet')
  assert.equal(resolveDeliveryMode('notify', true), 'notify')
  assert.equal(resolveDeliveryMode('quiet', true), 'quiet')
  assert.equal(resolveDeliveryMode('silent', true), 'silent')
})
