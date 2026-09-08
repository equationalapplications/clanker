import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideWakeup,
  utcDayStart,
  DAILY_PROACTIVE_POWER_CEILING,
  PROACTIVE_NOTIFY_COOLDOWN_MS,
} from './proactiveWakeupGuardrails.js'

const NOW = new Date('2026-09-08T14:00:00.000Z')

function input(overrides: Partial<Parameters<typeof decideWakeup>[0]> = {}) {
  return {
    now: NOW,
    balance: 1000,
    turnCost: 100,
    todaysProactiveSpend: 0,
    todaysPushCount: 0,
    lastUserMessageAt: new Date('2026-09-06T14:00:00.000Z'),
    unreadProactiveCount: 0,
    ...overrides,
  }
}

test('runs and permits notify in the ordinary case', () => {
  assert.deepEqual(decideWakeup(input()), { run: true, notifyAllowed: true })
})

test('skips when the balance cannot cover one turn', () => {
  const decision = decideWakeup(input({ balance: 99, turnCost: 100 }))
  assert.deepEqual(decision, { run: false, skipReason: 'insufficient_power' })
})

test('runs when the balance exactly covers one turn', () => {
  assert.equal(decideWakeup(input({ balance: 100, turnCost: 100 })).run, true)
})

test('skips when the daily ceiling is already reached', () => {
  const decision = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING }))
  assert.deepEqual(decision, { run: false, skipReason: 'daily_ceiling' })
})

test('allows the turn that crosses the ceiling, refusing only the next', () => {
  // Overshoot is bounded by one turn: a turn's true cost is unknown until it runs.
  const justUnder = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING - 1 }))
  assert.equal(justUnder.run, true)
  const atCeiling = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING }))
  assert.equal(atCeiling.run, false)
})

test('runs but forbids notify inside the cooldown window', () => {
  const recent = new Date(NOW.getTime() - PROACTIVE_NOTIFY_COOLDOWN_MS + 1000)
  assert.deepEqual(decideWakeup(input({ lastUserMessageAt: recent })), {
    run: true,
    notifyAllowed: false,
  })
})

test('permits notify exactly at the cooldown boundary', () => {
  const boundary = new Date(NOW.getTime() - PROACTIVE_NOTIFY_COOLDOWN_MS)
  const decision = decideWakeup(input({ lastUserMessageAt: boundary })) as {
    run: true
    notifyAllowed: boolean
  }
  assert.equal(decision.notifyAllowed, true)
})

test('forbids notify while an earlier proactive message is unread', () => {
  const decision = decideWakeup(input({ unreadProactiveCount: 1 }))
  assert.deepEqual(decision, { run: true, notifyAllowed: false })
})

test('forbids notify once the daily push ceiling is reached', () => {
  const decision = decideWakeup(input({ todaysPushCount: 2 })) as {
    run: true
    notifyAllowed: boolean
  }
  assert.equal(decision.notifyAllowed, false)
})

test('permits notify when the user has never sent a message', () => {
  const decision = decideWakeup(input({ lastUserMessageAt: null })) as {
    run: true
    notifyAllowed: boolean
  }
  assert.equal(decision.notifyAllowed, true)
})

test('utcDayStart truncates to UTC midnight regardless of host timezone', () => {
  assert.equal(utcDayStart(NOW).toISOString(), '2026-09-08T00:00:00.000Z')
  assert.equal(
    utcDayStart(new Date('2026-09-08T00:00:00.000Z')).toISOString(),
    '2026-09-08T00:00:00.000Z',
  )
  assert.equal(
    utcDayStart(new Date('2026-09-08T23:59:59.999Z')).toISOString(),
    '2026-09-08T00:00:00.000Z',
  )
})
