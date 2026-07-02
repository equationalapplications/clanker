import assert from 'node:assert/strict'
import test from 'node:test'
import type { Event as AdkEvent } from '@google/adk'
import type { CreditSpendAllocation } from './creditService.js'

const { consumeAgentEvents, assertAgentTurnCredits, AgentInsufficientCreditsError, DEGRADED_FALLBACK_REPLY } = await import('./agentEventLoop.js')

function fakeEvent(overrides: Partial<AdkEvent> = {}): AdkEvent {
  return {
    id: `evt-${Math.random()}`,
    invocationId: 'inv-1',
    actions: {},
    ...overrides,
  } as AdkEvent
}

function textEvent(text: string): AdkEvent {
  return fakeEvent({ content: { role: 'model', parts: [{ text }] } })
}

function functionCallEvent(name: string): AdkEvent {
  return fakeEvent({ content: { role: 'model', parts: [{ functionCall: { name, args: {} } }] } })
}

async function* toAsyncIterable(events: AdkEvent[]): AsyncGenerator<AdkEvent> {
  for (const e of events) yield e
}

const FALLBACK_REPLY = DEGRADED_FALLBACK_REPLY

test('assertAgentTurnCredits throws when balance is zero', async () => {
  await assert.rejects(
    () => assertAgentTurnCredits('user-1', { getBalance: async () => 0 }),
    (err: Error) => err instanceof AgentInsufficientCreditsError,
  )
})

test('assertAgentTurnCredits passes when balance is positive', async () => {
  await assert.doesNotReject(() => assertAgentTurnCredits('user-1', { getBalance: async () => 3 }))
})

test('assertAgentTurnCredits passes when getBalance throws (graceful degrade)', async () => {
  await assert.doesNotReject(() =>
    assertAgentTurnCredits('user-1', { getBalance: async () => { throw new Error('db down') } }),
  )
})

test('consumeAgentEvents spends 1 credit per functionCall-bearing event and returns the final reply', async () => {
  const spendCalls: string[] = []
  const cs = {
    spendCredit: async (userId: string) => {
      spendCalls.push(userId)
      return [{ transactionId: `tx-${spendCalls.length}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([functionCallEvent('get_current_time'), textEvent('It is 3pm.')])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(spendCalls.length, 1)
  assert.deepEqual(spendCalls, ['user-1'])
  assert.equal(result.reply, 'It is 3pm.')
  assert.deepEqual(result.toolCalls, ['get_current_time'])
})

test('consumeAgentEvents hard-stops at 5 loop iterations and returns a fallback reply', async () => {
  const cs = {
    spendCredit: async () => [{ transactionId: 'tx', amount: 1 }] as CreditSpendAllocation[],
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'),
    functionCallEvent('tool_c'),
    functionCallEvent('tool_d'),
    functionCallEvent('tool_e'),
    functionCallEvent('tool_f'), // never consumed — loop stops after the 5th
  ])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(result.toolCalls.length, 5)
  assert.equal(result.reply, FALLBACK_REPLY)
})

test('consumeAgentEvents degrades gracefully when credits run out mid-loop (no throw, no refund)', async () => {
  let calls = 0
  const cs = {
    spendCredit: async () => {
      calls += 1
      if (calls === 2) throw new Error('INSUFFICIENT_CREDITS')
      return [{ transactionId: `tx-${calls}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async () => {
      throw new Error('refundCredit should not be called on a graceful mid-loop degrade')
    },
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'), // this spend throws INSUFFICIENT_CREDITS
    functionCallEvent('tool_c'), // never reached
  ])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(result.toolCalls.length, 2)
  assert.equal(result.reply, FALLBACK_REPLY)
})

test('consumeAgentEvents refunds only the credits spent this turn on a genuine ADK error', async () => {
  let calls = 0
  const refunded: unknown[] = []
  const cs = {
    spendCredit: async () => {
      calls += 1
      return [{ transactionId: `tx-${calls}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async (_userId: string, allocations: CreditSpendAllocation[]) => {
      refunded.push(allocations)
    },
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'),
    fakeEvent({ errorCode: 'SAFETY', errorMessage: 'blocked' }),
  ])
  await assert.rejects(
    () => consumeAgentEvents(events, 'user-1', cs),
    (err: Error) => {
      assert.match(err.message, /ADK error \(SAFETY\)/)
      return true
    },
  )
  assert.deepEqual(refunded, [[
    { transactionId: 'tx-1', amount: 1 },
    { transactionId: 'tx-2', amount: 1 },
  ]])
})

test('consumeAgentEvents throws when the loop completes normally with an empty final reply', async () => {
  const cs = {
    spendCredit: async () => [{ transactionId: 'tx', amount: 1 }] as CreditSpendAllocation[],
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([fakeEvent({ content: { role: 'model', parts: [{ text: '' }] } })])
  await assert.rejects(
    () => consumeAgentEvents(events, 'user-1', cs),
    (err: Error) => {
      assert.equal(err.message, 'ADK returned an empty final reply')
      return true
    },
  )
})
