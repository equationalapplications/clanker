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

type InsertedMessage = {
  messageId: string
  characterId: string
  senderUserId: string
  text: string
  createdAt: Date
}

function buildApp(overrides: Partial<Parameters<typeof createProactiveWakeupHandler>[0]> = {}) {
  const calls = {
    spend: 0,
    refund: 0,
    resolved: [] as unknown[],
    insertedMessages: [] as InsertedMessage[],
  }
  const deps = {
    resolveUserId: async () => 'user-1',
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
    insertProactiveMessage: async (input: InsertedMessage) => {
      calls.insertedMessages.push(input)
    },
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

test('character_missing refund failure does not double-refund', async () => {
  // refundCredit is not idempotent — each call increases remaining_balance or
  // inserts another refund_compensation row. If the initial refund in the
  // character_missing branch threw and propagated to the outer catch, the
  // outer catch would call refundCredit again — a real money bug, masked by
  // the response still being 422. The fix catches the refund failure locally
  // so the outer catch can never retry it.
  const { app, calls } = buildApp({
    loadCharacter: (async () => null) as never,
    creditService: {
      spendCredit: async () => [{ transactionId: 'tx1', amount: 100 }],
      refundCredit: async () => {
        calls.refund++
        throw new Error('refund blew up')
      },
      getBalance: async () => 1000,
    } as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  // 422 because the row was claimed, the character turned out to be missing,
  // the spend was attempted to be refunded (and failed), and we returned the
  // user-visible error.
  assert.equal(res.status, 422)
  // Crucial invariant: refundCredit must have been called exactly once, even
  // though it threw. The outer catch would call it again if the inner catch
  // had not absorbed the throw.
  assert.equal(calls.refund, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number; outcome: string }
  assert.equal(resolved.status, 'skipped')
  assert.equal(resolved.spentAmount, 0)
  assert.equal(resolved.outcome, 'character_missing')
})

test('downgrades notify to quiet when the sweeper forbade notifying', () => {
  assert.equal(resolveDeliveryMode('notify', false), 'quiet')
  assert.equal(resolveDeliveryMode('quiet', true), 'quiet')
  assert.equal(resolveDeliveryMode('silent', true), 'silent')
})

// TEMPORARY, paired with PROACTIVE_PUSH_ENABLED = false. Until the lifecycle
// sync is wired, a push would deeplink into an empty local chat, so notify is
// gated off even when the sweeper permits it. When the fast-follow un-gates
// push, this assertion flips back to 'notify' — and the line above in the
// sweeper-forbade test stays 'quiet' either way.
test('gates notify off while the client sync is unwired', () => {
  assert.equal(resolveDeliveryMode('notify', true), 'quiet')
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

test('a non-silent wake-up persists a proactive message row', async () => {
  const { app, calls } = buildApp({
    runAgent: (async () => ({
      reply: 'How did the interview go?',
      toolCalls: [],
      deliveryMode: 'notify' as const,
    })) as never,
  })
  const res = await request(app)
    .post('/agent/proactive-wakeup')
    .send({ ...body, notifyAllowed: true })
  assert.equal(res.status, 200)
  assert.equal(calls.insertedMessages.length, 1)
  const row = calls.insertedMessages[0]
  assert.equal(row.text, 'How did the interview go?')
  // sender_user_id means "whose conversation", not "who authored" — matching
  // generateReply. Account deletion sweeps by this column.
  assert.equal(row.senderUserId, 'user-1')
  assert.ok(row.messageId.length > 0)
})

test('a silent wake-up persists nothing', async () => {
  const { app, calls } = buildApp({
    runAgent: (async () => ({
      reply: '',
      toolCalls: [],
      deliveryMode: 'silent' as const,
    })) as never,
  })
  const res = await request(app)
    .post('/agent/proactive-wakeup')
    .send({ ...body, notifyAllowed: true })
  assert.equal(res.status, 200)
  assert.equal(calls.insertedMessages.length, 0)
})

// TEMPORARY inversion, paired with PROACTIVE_PUSH_ENABLED = false. This test
// asserted that a push fires; while the client sync is unwired a push would
// deeplink into an empty local chat, so the gate must suppress it even on the
// happy path — notify allowed AND a real token present. The setup is left
// intact so the production loadCharacter shape stays exercised (the token lives
// on users, not characters; a plain characters select would leave it undefined
// and every push would silently no-op).
//
// To un-gate: flip PROACTIVE_PUSH_ENABLED, restore the name to 'fires a push
// when notify is allowed and the character carries an expoPushToken', and swap
// the assertion block back to:
//   assert.ok(pushed, 'expected sendCharacterProactive to be called')
//   assert.equal(pushed.token, 'ExponentPushToken[abc]')
//   assert.equal(pushed.charId, body.characterId)
//   assert.equal(pushed.name, 'Ada')
//   assert.equal(pushed.body, 'Hi')
test('does not push while the gate is closed, even on the happy path', async () => {
  let pushed: { token: string; charId: string; name: string; body: string } | undefined
  const { app } = buildApp({
    loadCharacter: (async () => ({
      id: 'char-1',
      name: 'Ada',
      appearance: null,
      traits: null,
      emotions: null,
      context: null,
      expoPushToken: 'ExponentPushToken[abc]',
    })) as never,
    fcmDispatcher: {
      sendCharacterProactive: async (
        token: string,
        charId: string,
        _msgId: string,
        name: string,
        body: string,
      ): Promise<void> => {
        pushed = { token, charId, name, body }
      },
    } as never,
  })
  const res = await request(app)
    .post('/agent/proactive-wakeup')
    .send({ ...body, notifyAllowed: true })
  assert.equal(res.status, 200)
  assert.equal(pushed, undefined, 'gate must suppress the push while sync is unwired')
  // The turn itself still runs and is recorded — only delivery is withheld.
  assert.equal(res.body.mode, 'quiet')
})

test('skips the push when the character has no expoPushToken', async () => {
  let pushed = false
  const { app } = buildApp({
    fcmDispatcher: {
      sendCharacterProactive: async (): Promise<void> => {
        pushed = true
      },
    } as never,
  })
  const res = await request(app)
    .post('/agent/proactive-wakeup')
    .send({ ...body, notifyAllowed: true })
  assert.equal(res.status, 200)
  assert.equal(pushed, false, 'push must not fire when expoPushToken is undefined')
})
