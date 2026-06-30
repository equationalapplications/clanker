// cloud-agent/src/handlers/schedulerTriggerHandler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import request from 'supertest'
import { createSchedulerTriggerHandler, createRequireSchedulerSecret } from './schedulerTriggerHandler.js'
import type { TaskDoc } from '../../../shared/dsl-types.js'

const SECRET = 'test-scheduler-secret-abc'

const schedulerBody = {
  uid: 'u1',
  runKey: 'job-1-exec-1',
  action: { type: 'extract', selector: '.p', label: 'price' },
  actionSummary: 'Extract',
  notificationBody: 'Done',
} as const

function buildApp(overrides: {
  getActiveDevice?: () => Promise<unknown>
  createSession?: () => Promise<void>
  watchTask?: (uid: string, sid: string, tid: string, cb: (t: TaskDoc) => void) => () => void
  sendProactive?: (token: string, sid: string, tid: string, body: string) => Promise<void>
  getExpoPushToken?: (uid: string) => Promise<string | null>
  resolveUserId?: (uid: string) => Promise<string | null>
  spendCredit?: () => Promise<string>
  refundCredit?: () => Promise<void>
  abortPendingTaskIfOffline?: () => Promise<boolean>
  writeTaskResult?: () => Promise<void>
  reserveSchedulerRun?: (uid: string, runKey: string, ids: { sessionId: string; taskId: string }) => Promise<'reserved' | 'duplicate'>
  getSchedulerRun?: (uid: string, runKey: string) => Promise<{ sessionId: string; taskId: string } | null>
} = {}) {
  const creditCalls = { spend: 0, refund: 0 }
  const schedulerRuns = new Map<string, { sessionId: string; taskId: string }>()
  const mockFs = {
    getActiveDevice: overrides.getActiveDevice ?? (async () => ({ deviceId: 'd1', fcmToken: 'fcm-tok', deviceName: 'Mac' })),
    createSession: overrides.createSession ?? (async () => {}),
    writeTask: async () => {},
    closeSession: async () => {},
    abortPendingTaskIfOffline: overrides.abortPendingTaskIfOffline ?? (async () => true),
    writeTaskResult: overrides.writeTaskResult ?? (async () => {}),
    reserveSchedulerRun: overrides.reserveSchedulerRun ?? (async (uid: string, runKey: string, ids: { sessionId: string; taskId: string }) => {
      const key = `${uid}:${runKey}`
      if (schedulerRuns.has(key)) return 'duplicate' as const
      schedulerRuns.set(key, ids)
      return 'reserved' as const
    }),
    getSchedulerRun: overrides.getSchedulerRun ?? (async (uid: string, runKey: string) => {
      return schedulerRuns.get(`${uid}:${runKey}`) ?? null
    }),
    watchTask: overrides.watchTask ?? ((_u: string, _s: string, _t: string, cb: (t: TaskDoc) => void) => {
      setTimeout(() => cb({ status: 'complete', result: { data: { price: '$340' }, activeUrl: 'https://x.com' }, error: null, intent: { action: { type: 'extract', selector: '.p' } } } as unknown as TaskDoc), 5)
      return () => {}
    }),
  }

  const proactiveCalls: Array<{ token: string; sid: string; tid: string; body: string }> = []
  const mockFcm = {
    wakeExtension: async () => {},
    sendProactive: overrides.sendProactive ?? (async (token: string, sid: string, tid: string, body: string) => {
      proactiveCalls.push({ token, sid, tid, body })
    }),
  }

  const mockCredit = {
    spendCredit: overrides.spendCredit ?? (async () => { creditCalls.spend++; return 'tx1' }),
    refundCredit: overrides.refundCredit ?? (async () => { creditCalls.refund++ }),
  }

  const handler = createSchedulerTriggerHandler(
    mockFs as never,
    mockFcm as never,
    overrides.getExpoPushToken ?? (async () => 'ExponentPushToken[sched]'),
    mockCredit as never,
    overrides.resolveUserId ?? (async () => 'user-db-id'),
    { schedulerTimeoutMs: 200 },
  )

  const app = express()
  app.use(express.json())
  const testLimiter = rateLimit({ windowMs: 60_000, limit: 1_000 })
  app.post(
    '/agent/browser/scheduler-trigger',
    testLimiter,
    createRequireSchedulerSecret(SECRET),
    handler,
  )

  return { app, proactiveCalls, creditCalls }
}

test('returns 401 with no Authorization header', async () => {
  const { app } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .send(schedulerBody)
  assert.equal(res.status, 401)
})

test('returns 401 with wrong secret', async () => {
  const { app } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', 'Bearer wrong-secret')
    .send(schedulerBody)
  assert.equal(res.status, 401)
})

test('returns 422 when no active device', async () => {
  const { app, creditCalls } = buildApp({ getActiveDevice: async () => null })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send(schedulerBody)
  assert.equal(res.status, 422)
  assert.match(res.body.error, /no active device/i)
  assert.equal(creditCalls.spend, 0)
})

test('returns 422 for blocked host', async () => {
  const { app, creditCalls } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, action: { type: 'open_tab', url: 'chrome://settings' }, actionSummary: 'Open' })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /HOST_NOT_ALLOWED/i)
  assert.equal(creditCalls.spend, 0)
})

test('returns 422 for actions that require approval', async () => {
  const { app, creditCalls } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({
      ...schedulerBody,
      runKey: 'job-approval-1',
      action: { type: 'click', selector: '#submit-order-btn', label: 'Submit Payment', tier: 'stateful' },
      actionSummary: 'Submit payment of $42.99 on amazon.com',
    })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /REQUIRES_AUTH/i)
  assert.equal(creditCalls.spend, 0)
})

test('returns 402 when user has insufficient credits', async () => {
  const { app, creditCalls } = buildApp({
    spendCredit: async () => { throw new Error('INSUFFICIENT_CREDITS') },
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 402)
  assert.match(res.body.error, /insufficient credits/i)
  assert.equal(creditCalls.spend, 0)
})

test('returns 422 when user not found', async () => {
  const { app, creditCalls } = buildApp({ resolveUserId: async () => null })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send(schedulerBody)
  assert.equal(res.status, 422)
  assert.match(res.body.error, /user not found/i)
  assert.equal(creditCalls.spend, 0)
})

test('returns 200 and sends Expo Push on successful task', async () => {
  const { app, proactiveCalls, creditCalls } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.sessionId)
  assert.ok(res.body.taskId)
  assert.equal(proactiveCalls.length, 1)
  assert.equal(proactiveCalls[0].token, 'ExponentPushToken[sched]')
  assert.equal(proactiveCalls[0].body, 'Price check done.')
  assert.equal(creditCalls.spend, 1)
  assert.equal(creditCalls.refund, 0)
})

test('returns 200 with failure body when task fails', async () => {
  const { app, proactiveCalls, creditCalls } = buildApp({
    watchTask: (_u: string, _s: string, _t: string, cb: (t: TaskDoc) => void) => {
      setTimeout(() => cb({ status: 'failed', result: null, error: { code: 'SELECTOR_NOT_FOUND', message: 'not found', failedAction: { type: 'extract', selector: '.p' } as never }, intent: { action: { type: 'extract', selector: '.p' } } } as unknown as TaskDoc), 5)
      return () => {}
    },
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'failed')
  assert.equal(proactiveCalls.length, 1)
  assert.match(proactiveCalls[0].body, /SELECTOR_NOT_FOUND|failed/i)
  assert.equal(creditCalls.spend, 1)
  assert.equal(creditCalls.refund, 0)
})

test('returns 504 and no Expo Push on timeout', async () => {
  const { app, proactiveCalls, creditCalls } = buildApp({
    watchTask: () => () => {},
    abortPendingTaskIfOffline: async () => false,
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 504)
  assert.equal(proactiveCalls.length, 0)
  assert.equal(creditCalls.spend, 1)
  assert.equal(creditCalls.refund, 0)
})

test('refunds credit on timeout when extension never connected', async () => {
  const { app, creditCalls } = buildApp({
    watchTask: () => () => {},
    abortPendingTaskIfOffline: async () => true,
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 504)
  assert.equal(creditCalls.spend, 1)
  assert.equal(creditCalls.refund, 1)
})

test('returns 200 without Expo Push when no token registered', async () => {
  const { app, proactiveCalls } = buildApp({
    getExpoPushToken: async () => null,
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ ...schedulerBody, runKey: 'job-insufficient-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(proactiveCalls.length, 0)
})

test('duplicate runKey does not spend credit or create a second task', async () => {
  let createSessionCalls = 0
  const { app, creditCalls } = buildApp({
    createSession: async () => { createSessionCalls++ },
    watchTask: (_u: string, _s: string, _t: string, cb: (t: TaskDoc) => void) => {
      setTimeout(() => cb({ status: 'complete', result: { data: { price: '$340' }, activeUrl: 'https://x.com' }, error: null, intent: { action: { type: 'extract', selector: '.p' } } } as unknown as TaskDoc), 5)
      return () => {}
    },
  })

  const body = { ...schedulerBody, runKey: 'job-dup-1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' }

  const first = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send(body)
  assert.equal(first.status, 200)

  const second = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send(body)
  assert.equal(second.status, 200)
  assert.equal(second.body.sessionId, first.body.sessionId)
  assert.equal(second.body.taskId, first.body.taskId)
  assert.equal(creditCalls.spend, 1)
  assert.equal(createSessionCalls, 1)
})

test('refunds credit when setup fails after spend', async () => {
  const { app, creditCalls } = buildApp({
    createSession: async () => { throw new Error('firestore write failed') },
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send(schedulerBody)
  assert.equal(res.status, 500)
  assert.equal(creditCalls.spend, 1)
  assert.equal(creditCalls.refund, 1)
})
