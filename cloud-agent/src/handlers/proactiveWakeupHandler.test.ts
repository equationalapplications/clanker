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
    claimRunKey: async () => ({ status: 'reserved' as const, id: body.wakeupId }),
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
  const { app, calls } = buildApp({
    claimRunKey: async () => ({ status: 'duplicate' as const, id: null }),
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(calls.spend, 0)
})

test('rejects and releases the row when runKey claims a different wakeup', async () => {
  const { app, calls } = buildApp({
    claimRunKey: async () => ({ status: 'reserved' as const, id: 'some-other-row' }),
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 400)
  // The crucial invariant: no credit is committed against a row we did not lock.
  assert.equal(calls.spend, 0)
  // ...and the row we DID lock is released, not left claimed forever.
  assert.equal(calls.resolved.length, 1)
  const resolved = calls.resolved[0] as { id: string; status: string; outcome: string }
  assert.equal(resolved.id, 'some-other-row')
  assert.equal(resolved.status, 'skipped')
  assert.equal(resolved.outcome, 'identifier_mismatch')
})

test('passes the validated character to runAgent instead of re-fetching it', async () => {
  let seen: { id: string; name: string } | undefined
  const { app } = buildApp({
    runAgent: (async (args: { character: { id: string; name: string } }) => {
      seen = args.character
      return { reply: 'Hi', toolCalls: [], deliveryMode: 'silent' as const }
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(seen?.id, 'char-1')
  assert.equal(seen?.name, 'Ada')
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

test('releases the claimed row when spendCredit fails with a non-IC error', async () => {
  let ran = false
  const { app, calls } = buildApp({
    creditService: {
      spendCredit: async () => {
        throw new Error('connection refused')
      },
      refundCredit: async () => {
        calls.refund++
      },
      getBalance: async () => 1000,
    } as never,
    runAgent: (async () => {
      ran = true
      return { reply: '', toolCalls: [], deliveryMode: 'silent' as const }
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 500)
  assert.equal(ran, false)
  // No allocations were returned, so there is nothing to refund. The crucial
  // invariant: the row leaves 'claimed' status, otherwise the sweeper would
  // never retry / skip it on a later pass.
  assert.equal(calls.refund, 0)
  assert.equal(calls.resolved.length, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number; outcome: string }
  assert.equal(resolved.status, 'skipped')
  assert.equal(resolved.spentAmount, 0)
  assert.equal(resolved.outcome, 'spend_failed')
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

test('resolve records effective and chosen delivery modes as columns', async () => {
  const { app, calls } = buildApp({
    runAgent: (async () => ({
      reply: 'hi',
      toolCalls: [],
      deliveryMode: 'notify' as const,
    })) as never,
  })
  const res = await request(app)
    .post('/agent/proactive-wakeup')
    .send({ ...body, notifyAllowed: false })
  assert.equal(res.status, 200)
  const resolved = calls.resolved[0] as {
    deliveryMode: string
    chosenDeliveryMode: string
    outcome: string
  }
  // notifyAllowed false clamps the effective mode down, but what the character
  // wanted must survive — it is the signal the rollout gate tunes against.
  assert.equal(resolved.deliveryMode, 'quiet')
  assert.equal(resolved.chosenDeliveryMode, 'notify')
  assert.equal(resolved.outcome, 'mode=quiet chosen=notify')
})
