# Phase 3: Proactive Browser Bridge — Cloud Scheduler Triggers & Expo Push Async Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloud Scheduler–triggered proactive browser tasks that fire without a user session, and Expo Push fallback delivery when the voice session closes before a browser task result arrives.

**Architecture:** A new `POST /agent/browser/scheduler-trigger` endpoint accepts Bearer `SCHEDULER_SECRET` auth from Cloud Scheduler, creates a bridge session, wakes the extension via FCM, synchronously waits up to 60 s for the result, then sends an Expo Push notification via `sendProactive`. Separately, `pushToLive` in `wsLiveAgentHandler` gains a fallback path: when the Gemini session has already closed, the result is delivered via `sendTaskComplete` Expo Push instead of being silently dropped.

**Tech Stack:** Node.js 22, TypeScript, Express, Firebase Admin SDK, Expo Push REST API, `node:test` + `node:assert/strict`, `supertest`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `cloud-agent/src/services/fcmDispatcher.ts` | Add `sendProactive` method |
| Modify | `cloud-agent/src/services/fcmDispatcher.test.ts` | Test `sendProactive` payload |
| Modify | `cloud-agent/src/tools/browserAction.ts` | Pass `sessionId` to `pushToLive` (signature change) |
| Modify | `cloud-agent/src/tools/browserAction.test.ts` | Update `pushToLive` mock signature |
| Modify | `cloud-agent/src/handlers/wsLiveAgentHandler.ts` | Add `getExpoPushToken` option; Expo Push fallback in `pushToLive` |
| Modify | `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts` | Test Expo Push fallback when Gemini session closed |
| Create | `cloud-agent/src/handlers/schedulerTriggerHandler.ts` | HTTP handler for Cloud Scheduler trigger endpoint |
| Create | `cloud-agent/src/handlers/schedulerTriggerHandler.test.ts` | Unit + HTTP tests for scheduler handler |
| Modify | `cloud-agent/src/index.ts` | Register `POST /agent/browser/scheduler-trigger` |
| Modify | `cloud-agent/src/index.test.ts` | Test route 401 on bad secret, 503 when `SCHEDULER_SECRET` unset |

---

## Task 1: Add `sendProactive` to `fcmDispatcher.ts`

**Files:**
- Modify: `cloud-agent/src/services/fcmDispatcher.test.ts`
- Modify: `cloud-agent/src/services/fcmDispatcher.ts`

- [ ] **Step 1.1: Write failing test**

Append to `cloud-agent/src/services/fcmDispatcher.test.ts`:

```typescript
test('sendProactive POSTs PROACTIVE_TASK Expo Push payload', async () => {
  const fetched: Array<{ body: unknown }> = []
  const fakeFetch = async (_url: string, opts: RequestInit) => {
    fetched.push({ body: JSON.parse(opts.body as string) })
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }

  const dispatcher = createFcmDispatcher(
    { send: async () => 'msg-id' },
    fakeFetch as unknown as typeof fetch,
  )

  await dispatcher.sendProactive('ExponentPushToken[abc]', 'sid1', 'tid1', 'Price dropped to $340.')

  assert.equal(fetched.length, 1)
  const body = fetched[0].body as Record<string, unknown>
  assert.equal(body.to, 'ExponentPushToken[abc]')
  assert.equal(body.title, 'Clanker noticed something')
  assert.equal(body.body, 'Price dropped to $340.')
  assert.equal(body.categoryIdentifier, 'BROWSER_ACTION_APPROVAL')
  assert.equal(body.priority, 'high')
  const data = body.data as Record<string, string>
  assert.equal(data.type, 'PROACTIVE_TASK')
  assert.equal(data.sessionId, 'sid1')
  assert.equal(data.taskId, 'tid1')
  assert.equal(data.deepLink, '/talk')
})
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'sendProactive|FAIL|not a function|TypeError'
```

Expected: `TypeError: dispatcher.sendProactive is not a function` or similar.

- [ ] **Step 1.3: Implement `sendProactive` in fcmDispatcher**

In `cloud-agent/src/services/fcmDispatcher.ts`, add `sendProactive` inside the returned object (after `sendTaskComplete`):

```typescript
async sendProactive(expoPushToken: string, sessionId: string, taskId: string, body: string): Promise<void> {
  await expoPush({
    to: expoPushToken,
    title: 'Clanker noticed something',
    body,
    data: { type: 'PROACTIVE_TASK', sessionId, taskId, deepLink: '/talk' },
    categoryIdentifier: 'BROWSER_ACTION_APPROVAL',
    priority: 'high',
  })
},
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'sendProactive|pass|fail' | head -10
```

Expected: `sendProactive POSTs PROACTIVE_TASK Expo Push payload` → pass.

- [ ] **Step 1.5: Commit**

```bash
git add cloud-agent/src/services/fcmDispatcher.ts cloud-agent/src/services/fcmDispatcher.test.ts
git commit -m "feat(bridge): add sendProactive to fcmDispatcher for phase 3 scheduler notifications"
```

---

## Task 2: Extend `pushToLive` Signature

The voice-side `pushToLive` callback currently takes `(taskId, text)`. To support the Expo Push fallback in Task 3, it needs `sessionId` too so `sendTaskComplete` can correlate the push payload.

**Files:**
- Modify: `cloud-agent/src/tools/browserAction.ts` (call site only)
- Modify: `cloud-agent/src/tools/browserAction.test.ts` (mock signature only)

- [ ] **Step 2.1: Update `BrowserActionDeps.pushToLive` signature in `browserAction.ts`**

In `cloud-agent/src/tools/browserAction.ts`, change line:

```typescript
  // Voice-only: push the final result into the live Gemini session.
  pushToLive?: (taskId: string, text: string) => void
```

to:

```typescript
  // Voice-only: push the final result into the live Gemini session.
  pushToLive?: (taskId: string, sessionId: string, text: string) => void
```

- [ ] **Step 2.2: Update the `pushToLive` call in the voice path**

In the same file, find:

```typescript
      void waitForTerminalTask().then((task) => {
        deps.resumeBilling?.()
        deps.pushToLive?.(taskId, formatResult(task))
      })
```

Change to:

```typescript
      void waitForTerminalTask().then((task) => {
        deps.resumeBilling?.()
        deps.pushToLive?.(taskId, sessionId, formatResult(task))
      })
```

- [ ] **Step 2.3: Update `pushToLive` mock in `browserAction.test.ts`**

Search `browserAction.test.ts` for any test that passes a `pushToLive` mock. Update each mock from `(taskId, text)` to `(taskId, sessionId, text)`. Example:

```typescript
// Before
pushToLive: (taskId: string, text: string) => { pushResults.push({ taskId, text }) },

// After
pushToLive: (taskId: string, _sessionId: string, text: string) => { pushResults.push({ taskId, text }) },
```

If no existing tests use `pushToLive`, no change needed here — the interface change is sufficient.

- [ ] **Step 2.4: Run tests to confirm no regressions**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'FAIL|pass|fail|Error' | tail -20
```

Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add cloud-agent/src/tools/browserAction.ts cloud-agent/src/tools/browserAction.test.ts
git commit -m "feat(bridge): add sessionId param to pushToLive for Expo Push fallback path"
```

---

## Task 3: Expo Push Fallback in `wsLiveAgentHandler`

When the Gemini/voice session closes before a browser task result arrives, the `pushToLive` callback should deliver the result via `sendTaskComplete` Expo Push instead of silently dropping it.

**Files:**
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts`
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`

- [ ] **Step 3.1: Write failing test**

Append to `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`. Find the end of existing tests and add:

```typescript
test('pushToLive falls back to Expo Push when voice WS is closed', { timeout: 5000 }, async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])

  const expoPushCalls: Array<{ token: string; sessionId: string; taskId: string; text: string }> = []
  const mockFcmDispatcher = {
    wakeExtension: async () => {},
    sendApprovalCard: async () => {},
    sendTaskComplete: async (token: string, sessionId: string, taskId: string, text: string) => {
      expoPushCalls.push({ token, sessionId, taskId, text })
    },
    sendProactive: async () => {},
  }

  let watchTaskCallback: ((task: unknown) => void) | null = null
  const mockFirestoreSession = {
    getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'fcm-tok', deviceName: 'Mac' }),
    createSession: async () => {},
    writeTask: async () => {},
    closeSession: async () => {},
    writeTaskResult: async () => {},
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    abortPendingTaskIfOffline: async () => false,
    watchTask: (_uid: string, _sid: string, _tid: string, cb: (task: unknown) => void) => {
      watchTaskCallback = cb
      return () => {}
    },
  }

  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'fb-uid-1' }),
    liveConnect: mock.connect,
    getExpoPushToken: async () => 'ExponentPushToken[test]',
    browserBridge: {
      firebaseUid: 'fb-uid-1',
      userId: 'user-uuid-1',
      firestoreSession: mockFirestoreSession as never,
      fcmDispatcher: mockFcmDispatcher as never,
      creditService: mockCreditService,
      instanceId: 'inst-1',
      wakeTimeoutMs: 50,
      textTimeoutMs: 500,
    },
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 4500)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { type: string }
      if (msg.type !== 'session_ready') return

      // Simulate Gemini invoking browser_action
      mock.triggerMessage({
        toolCall: {
          functionCalls: [{ id: 'call-1', name: 'browser_action', args: {
            actionSummary: 'Extract price',
            intent: { action: { type: 'extract', selector: '.price', label: 'price' } },
          }}],
        },
      })

      // Close the WS before the task result arrives
      setTimeout(() => ws.close(), 20)
    })

    ws.on('close', async () => {
      // Task result arrives after WS is closed
      await new Promise((r) => setTimeout(r, 100))
      watchTaskCallback?.({ status: 'complete', result: { data: { price: '$340' }, activeUrl: 'https://example.com' }, error: null })

      await new Promise((r) => setTimeout(r, 100))

      clearTimeout(timeout)
      try {
        assert.equal(expoPushCalls.length, 1, 'sendTaskComplete should be called once')
        assert.equal(expoPushCalls[0].token, 'ExponentPushToken[test]')
        assert.match(expoPushCalls[0].text, /\$340|complete/i)
        resolve()
      } catch (e) {
        reject(e)
      }
    })

    ws.on('error', reject)
  })

  await close()
})
```

- [ ] **Step 3.2: Run to confirm test fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'pushToLive falls back|FAIL|AssertionError' | head -5
```

Expected: `AssertionError [ERR_ASSERTION]: 0 == 1` — `sendTaskComplete` not called yet.

- [ ] **Step 3.3: Add `getExpoPushToken` to `WsLiveHandlerOptions`**

In `cloud-agent/src/handlers/wsLiveAgentHandler.ts`, add to the `WsLiveHandlerOptions` interface (after `browserBridge`):

```typescript
  /** Injectable for testing; defaults to DB lookup. */
  getExpoPushToken?: (firebaseUid: string) => Promise<string | null>
```

- [ ] **Step 3.4: Import `getExpoPushToken` in the handler**

At the top of `cloud-agent/src/handlers/wsLiveAgentHandler.ts`, add:

```typescript
import { getExpoPushToken as dbGetExpoPushToken } from './expoPushToken.js'
```

- [ ] **Step 3.5: Add Expo Push fallback in `pushToLive`**

In `wsLiveAgentHandler.ts`, find the `pushToLive` callback definition (inside `handleAuthMessage`):

```typescript
          pushToLive: (taskId: string, text: string) => {
            const callId = browserCallByTaskId.get(taskId)
            if (!callId) return
            browserCallByTaskId.delete(taskId)
            try {
              geminiSession?.sendToolResponse({
                functionResponses: [{ id: callId, name: 'browser_action', response: { output: text } }],
              })
            } catch { /* ignore */ }
          },
```

Replace with:

```typescript
          pushToLive: (taskId: string, bridgeSessionId: string, text: string) => {
            const callId = browserCallByTaskId.get(taskId)
            if (!callId) return
            browserCallByTaskId.delete(taskId)
            const sessionOpen = geminiSession !== null && ws.readyState === WebSocket.OPEN
            if (sessionOpen) {
              try {
                geminiSession!.sendToolResponse({
                  functionResponses: [{ id: callId, name: 'browser_action', response: { output: text } }],
                })
              } catch { /* ignore */ }
              return
            }
            // Voice session already closed — deliver result via Expo Push fallback.
            if (bridgeBase?.fcmDispatcher && bridgeBase.firebaseUid) {
              const fwd = bridgeBase.fcmDispatcher
              const fbUid = bridgeBase.firebaseUid
              const getToken = options.getExpoPushToken ?? ((uid: string) => dbGetExpoPushToken(options.db, uid))
              void getToken(fbUid).then((token) => {
                if (token) return fwd.sendTaskComplete(token, bridgeSessionId, taskId, text)
              }).catch((err) => console.error('[pushToLive Expo fallback]', err))
            }
          },
```

- [ ] **Step 3.6: Run tests to confirm passing**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'pushToLive falls back|pass|FAIL' | head -10
```

Expected: `pushToLive falls back to Expo Push when voice WS is closed` → pass, no FAIL lines.

- [ ] **Step 3.7: Commit**

```bash
git add cloud-agent/src/handlers/wsLiveAgentHandler.ts cloud-agent/src/handlers/wsLiveAgentHandler.test.ts
git commit -m "feat(bridge): send Expo Push when voice session closes before browser task result"
```

---

## Task 4: Create `schedulerTriggerHandler.ts`

**Files:**
- Create: `cloud-agent/src/handlers/schedulerTriggerHandler.ts`
- Create: `cloud-agent/src/handlers/schedulerTriggerHandler.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `cloud-agent/src/handlers/schedulerTriggerHandler.test.ts`:

```typescript
// cloud-agent/src/handlers/schedulerTriggerHandler.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import request from 'supertest'
import { createSchedulerTriggerHandler } from './schedulerTriggerHandler.js'
import type { TaskDoc } from '../../../shared/dsl-types.js'

const SECRET = 'test-scheduler-secret-abc'

function buildApp(overrides: {
  getActiveDevice?: () => Promise<unknown>
  watchTask?: (uid: string, sid: string, tid: string, cb: (t: TaskDoc) => void) => () => void
  sendProactive?: (token: string, sid: string, tid: string, body: string) => Promise<void>
  getExpoPushToken?: (uid: string) => Promise<string | null>
} = {}) {
  const mockFs = {
    getActiveDevice: overrides.getActiveDevice ?? (async () => ({ deviceId: 'd1', fcmToken: 'fcm-tok', deviceName: 'Mac' })),
    createSession: async () => {},
    writeTask: async () => {},
    closeSession: async () => {},
    abortPendingTaskIfOffline: async () => false,
    watchTask: overrides.watchTask ?? ((_u: string, _s: string, _t: string, cb: (t: TaskDoc) => void) => {
      // Resolve immediately with complete
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

  const handler = createSchedulerTriggerHandler(
    mockFs as never,
    mockFcm as never,
    overrides.getExpoPushToken ?? (async () => 'ExponentPushToken[sched]'),
    mockCredit as never,
    overrides.resolveUserId ?? (async () => 'user-db-id'),
    { secret: SECRET, schedulerTimeoutMs: 200 },
  )

  const app = express()
  app.use(express.json())
  app.post('/agent/browser/scheduler-trigger', handler)

  return { app, proactiveCalls }
}

test('returns 401 with no Authorization header', async () => {
  const { app } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .send({ uid: 'u1', action: { type: 'extract', selector: '.p', label: 'price' }, actionSummary: 'Extract', notificationBody: 'Done' })
  assert.equal(res.status, 401)
})

test('returns 401 with wrong secret', async () => {
  const { app } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', 'Bearer wrong-secret')
    .send({ uid: 'u1', action: { type: 'extract', selector: '.p', label: 'price' }, actionSummary: 'Extract', notificationBody: 'Done' })
  assert.equal(res.status, 401)
})

test('returns 422 when no active device', async () => {
  const { app } = buildApp({ getActiveDevice: async () => null })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'extract', selector: '.p', label: 'price' }, actionSummary: 'Extract', notificationBody: 'Done' })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /no active device/i)
})

test('returns 422 for blocked host', async () => {
  const { app } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'open_tab', url: 'chrome://settings' }, actionSummary: 'Open', notificationBody: 'Done' })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /HOST_NOT_ALLOWED/i)
})

test('returns 200 and sends Expo Push on successful task', async () => {
  const { app, proactiveCalls } = buildApp()
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.sessionId)
  assert.ok(res.body.taskId)
  assert.equal(proactiveCalls.length, 1)
  assert.equal(proactiveCalls[0].token, 'ExponentPushToken[sched]')
  assert.equal(proactiveCalls[0].body, 'Price check done.')
})

test('returns 200 with failure body when task fails', async () => {
  const { app, proactiveCalls } = buildApp({
    watchTask: (_u: string, _s: string, _t: string, cb: (t: TaskDoc) => void) => {
      setTimeout(() => cb({ status: 'failed', result: null, error: { code: 'SELECTOR_NOT_FOUND', message: 'not found', failedAction: { type: 'extract', selector: '.p' } as never }, intent: { action: { type: 'extract', selector: '.p' } } } as unknown as TaskDoc), 5)
      return () => {}
    },
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'failed')
  assert.equal(proactiveCalls.length, 1)
  assert.match(proactiveCalls[0].body, /SELECTOR_NOT_FOUND|failed/i)
})

test('returns 504 and no Expo Push on timeout', async () => {
  const { app, proactiveCalls } = buildApp({
    watchTask: () => () => {},  // never resolves
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 504)
  assert.equal(proactiveCalls.length, 0)
})

test('returns 200 without Expo Push when no token registered', async () => {
  const { app, proactiveCalls } = buildApp({
    getExpoPushToken: async () => null,
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ uid: 'u1', action: { type: 'extract', selector: '.price', label: 'price' }, actionSummary: 'Extract price', notificationBody: 'Price check done.' })
  assert.equal(res.status, 200)
  assert.equal(proactiveCalls.length, 0)
})
```

- [ ] **Step 4.2: Run to confirm all tests fail (module not found)**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'schedulerTrigger|Cannot find|FAIL' | head -5
```

Expected: `Cannot find module './schedulerTriggerHandler.js'` or compilation error.

- [ ] **Step 4.3: Implement `schedulerTriggerHandler.ts`**

Create `cloud-agent/src/handlers/schedulerTriggerHandler.ts`:

```typescript
import { z } from 'zod'
import type { Request, Response } from 'express'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import type { TaskDoc, SingleAction, SequenceAction } from '../../../shared/dsl-types.js'
import { intentRequiresAuth } from '../../../shared/constants.js'
import { findBlockedNavigation } from '../../../shared/hostPolicy.js'
import { INSTANCE_ID } from '../services/instanceId.js'

export interface SchedulerTriggerOptions {
  /** SCHEDULER_SECRET env var value — requests must Bearer-match this */
  secret: string
  schedulerTimeoutMs?: number
}

const schedulerBodySchema = z.object({
  uid: z.string().min(1),
  action: z.record(z.string(), z.unknown()),
  actionSummary: z.string().min(1),
  notificationBody: z.string().min(1),
})

function watchTaskPromise(
  fs: FirestoreSession,
  uid: string,
  sessionId: string,
  taskId: string,
): Promise<TaskDoc> {
  return new Promise((resolve) => {
    const unsub = fs.watchTask(uid, sessionId, taskId, (task) => {
      if (task.status === 'complete' || task.status === 'failed' || task.status === 'aborted') {
        unsub()
        resolve(task)
      }
    })
  })
}

export function createSchedulerTriggerHandler(
  fs: FirestoreSession,
  fcm: Pick<FcmDispatcher, 'wakeExtension' | 'sendProactive'>,
  getExpoPushToken: (firebaseUid: string) => Promise<string | null>,
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
  resolveUserId: (firebaseUid: string) => Promise<string | null>,
  opts: SchedulerTriggerOptions,
) {
  const timeoutMs = opts.schedulerTimeoutMs ?? 60_000

  return async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    if (!token || token !== opts.secret) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const parsed = schedulerBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }

    const { uid, action, actionSummary, notificationBody } = parsed.data
    const typedAction = action as SingleAction | SequenceAction

    const blocked = findBlockedNavigation(typedAction)
    if (blocked) {
      res.status(422).json({ error: `HOST_NOT_ALLOWED: ${blocked.message}` })
      return
    }

    let device: { deviceId: string; fcmToken: string; deviceName: string } | null
    try {
      device = await fs.getActiveDevice(uid)
    } catch (err) {
      console.error('[scheduler-trigger] getActiveDevice error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    if (!device) {
      res.status(422).json({ error: 'No active device for this user' })
      return
    }

    const sessionId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    const requiresAuth = intentRequiresAuth(actionSummary, typedAction)
    const taskIntent = { version: '1' as const, taskId, sessionId, requiresAuth, actionSummary, action: typedAction }

    try {
      await fs.createSession(uid, sessionId, { status: 'pending', trigger: 'scheduler', voiceInstanceId: INSTANCE_ID })
      await fs.writeTask(uid, sessionId, taskId, taskIntent)
      await fcm.wakeExtension(device.fcmToken, sessionId, taskId)
    } catch (err) {
      console.error('[scheduler-trigger] setup error:', err)
      try { await fs.closeSession(uid, sessionId, 'aborted') } catch { /* ignore */ }
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    let task: TaskDoc | null = null
    try {
      task = await Promise.race([
        watchTaskPromise(fs, uid, sessionId, taskId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)),
      ])
    } catch {
      // Timeout — task did not complete
      try { await fs.abortPendingTaskIfOffline(uid, sessionId, taskId, {
        taskId, status: 'failed', data: {}, activeUrl: '',
        error: { code: 'EXECUTION_TIMEOUT', message: 'Scheduler task timed out', failedAction: typedAction as never },
      }) } catch { /* ignore */ }
      try { await fs.closeSession(uid, sessionId, 'aborted') } catch { /* ignore */ }
      res.status(504).json({ error: 'Task timed out', sessionId, taskId })
      return
    }

    try { await fs.closeSession(uid, sessionId, 'closed') } catch { /* ignore */ }

    const pushBody = task.status === 'complete'
      ? notificationBody
      : `Browser task failed (${task.error?.code ?? 'unknown'}). Tap to check.`

    try {
      const expoPushToken = await getExpoPushToken(uid)
      if (expoPushToken) {
        await fcm.sendProactive(expoPushToken, sessionId, taskId, pushBody)
      }
    } catch (err) {
      console.error('[scheduler-trigger] sendProactive error:', err)
    }

    res.json({ ok: true, sessionId, taskId, status: task.status })
  }
}
```

- [ ] **Step 4.4: Run tests to confirm all pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'scheduler|FAIL' | head -20
```

Expected: all 7 scheduler tests pass, no FAIL lines.

- [ ] **Step 4.5: Commit**

```bash
git add cloud-agent/src/handlers/schedulerTriggerHandler.ts cloud-agent/src/handlers/schedulerTriggerHandler.test.ts
git commit -m "feat(bridge): add schedulerTriggerHandler for Cloud Scheduler proactive browser tasks"
```

---

## Task 5: Wire `POST /agent/browser/scheduler-trigger` into `index.ts`

**Files:**
- Modify: `cloud-agent/src/index.ts`
- Modify: `cloud-agent/src/index.test.ts`

- [ ] **Step 5.1: Write failing test**

In `cloud-agent/src/index.test.ts`, locate the existing test helper section and add a test after existing route tests:

```typescript
test('POST /agent/browser/scheduler-trigger returns 401 with no secret', async () => {
  const db = makeMockDb()
  const app = createApp({
    verifyToken: async () => ({ uid: 'uid' }),
    db,
    runAgentFn: async () => ({ reply: 'ok', toolCalls: [] }),
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .send({ uid: 'u1', action: { type: 'extract', selector: '.p', label: 'p' }, actionSummary: 'Extract', notificationBody: 'Done' })
  assert.equal(res.status, 401)
})

test('POST /agent/browser/scheduler-trigger returns 503 when SCHEDULER_SECRET not set', async () => {
  const saved = process.env.SCHEDULER_SECRET
  delete process.env.SCHEDULER_SECRET
  const db = makeMockDb()
  const app = createApp({
    verifyToken: async () => ({ uid: 'uid' }),
    db,
    runAgentFn: async () => ({ reply: 'ok', toolCalls: [] }),
  })
  const res = await request(app)
    .post('/agent/browser/scheduler-trigger')
    .set('Authorization', 'Bearer anything')
    .send({ uid: 'u1', action: { type: 'extract', selector: '.p', label: 'p' }, actionSummary: 'Extract', notificationBody: 'Done' })
  assert.equal(res.status, 503)
  process.env.SCHEDULER_SECRET = saved
})
```

- [ ] **Step 5.2: Run to confirm tests fail**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'scheduler-trigger.*401|scheduler-trigger.*503|FAIL' | head -5
```

Expected: tests fail because route doesn't exist yet (`404`).

- [ ] **Step 5.3: Add imports to `index.ts`**

In `cloud-agent/src/index.ts`, add after existing imports:

```typescript
import { createSchedulerTriggerHandler } from './handlers/schedulerTriggerHandler.js'
import { getExpoPushToken } from './handlers/expoPushToken.js'
```

- [ ] **Step 5.4: Add route to `createApp` in `index.ts`**

In `createApp`, after the `POST /agent/browser/approve-action` route block (before `return app`), add:

```typescript
  app.post('/agent/browser/scheduler-trigger', async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.SCHEDULER_SECRET
    if (!secret) {
      res.status(503).json({ error: 'Scheduler trigger not configured' })
      return
    }
    if (!browserBridgeAvailable) {
      res.status(503).json({ error: 'Browser bridge unavailable' })
      return
    }
    const handler = createSchedulerTriggerHandler(
      defaultFirestoreSession(),
      defaultFcmDispatcher(),
      (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
      cs,
      async (firebaseUid: string) => {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
        return u?.id ?? null
      },
      { secret },
    )
    return handler(req, res)
  })
```

- [ ] **Step 5.5: Run tests to confirm passing**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'scheduler-trigger|FAIL' | head -10
```

Expected: both new scheduler-trigger index tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "feat(bridge): wire POST /agent/browser/scheduler-trigger route"
```

---

## Task 6: Update `wsLiveAgentHandler.ts` `getExpoPushToken` in production wiring

The production wiring in `index.ts` needs to pass `getExpoPushToken` to `handleLiveWsUpgrade`. Currently it uses the default DB lookup internally, but with Task 3's injectable option, the test can override it. For production, no change is needed since the handler falls back to `dbGetExpoPushToken(options.db, fbUid)` when `options.getExpoPushToken` is not provided. Verify the fallback works.

**Files:**
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts` (one more integration test)

- [ ] **Step 6.1: Write test for production path (no `getExpoPushToken` override, handler uses DB lookup)**

Append to `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`:

```typescript
test('pushToLive uses DB lookup for expoPushToken when getExpoPushToken not injected', { timeout: 5000 }, async () => {
  // Build a mock DB that returns an expoPushToken row for expoPushToken queries.
  // The mock DB in wsLiveAgentHandler test calls `select().from().where().limit()`
  // The `getExpoPushToken` helper does: db.select({ expoPushToken }).from(users).where(eq(users.firebaseUid, uid)).limit(1)
  const expoPushRow = [{ expoPushToken: 'ExponentPushToken[db]' }]
  const db = makeMockDb([[mockUser], [mockCharacter], expoPushRow])

  const proactiveCalls: Array<{ token: string }> = []
  const mockFcmDispatcher = {
    wakeExtension: async () => {},
    sendTaskComplete: async (token: string) => { proactiveCalls.push({ token }) },
    sendProactive: async () => {},
  }

  let watchTaskCallback: ((task: unknown) => void) | null = null
  const mockFirestoreSession = {
    getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
    createSession: async () => {},
    writeTask: async () => {},
    closeSession: async () => {},
    writeTaskResult: async () => {},
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    abortPendingTaskIfOffline: async () => false,
    watchTask: (_u: string, _s: string, _t: string, cb: (task: unknown) => void) => {
      watchTaskCallback = cb
      return () => {}
    },
  }

  const mock = makeMockLiveConnect()
  // No getExpoPushToken override — handler must fall back to DB lookup
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'fb-uid-2' }),
    liveConnect: mock.connect,
    browserBridge: {
      firebaseUid: 'fb-uid-2',
      userId: 'user-uuid-1',
      firestoreSession: mockFirestoreSession as never,
      fcmDispatcher: mockFcmDispatcher as never,
      creditService: mockCreditService,
      instanceId: 'inst-2',
      wakeTimeoutMs: 50,
      textTimeoutMs: 500,
    },
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 4500)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'v', characterId: CHAR_UUID })))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { type: string }
      if (msg.type !== 'session_ready') return
      mock.triggerMessage({
        toolCall: { functionCalls: [{ id: 'c2', name: 'browser_action', args: {
          actionSummary: 'Extract', intent: { action: { type: 'extract', selector: '.p', label: 'p' } },
        }}] },
      })
      setTimeout(() => ws.close(), 20)
    })
    ws.on('close', async () => {
      await new Promise((r) => setTimeout(r, 100))
      watchTaskCallback?.({ status: 'complete', result: { data: { p: 'x' }, activeUrl: 'https://a.com' }, error: null, intent: { action: { type: 'extract', selector: '.p' } } })
      await new Promise((r) => setTimeout(r, 100))
      clearTimeout(timeout)
      try {
        assert.equal(proactiveCalls.length, 1)
        assert.equal(proactiveCalls[0].token, 'ExponentPushToken[db]')
        resolve()
      } catch (e) { reject(e) }
    })
    ws.on('error', reject)
  })

  await close()
})
```

- [ ] **Step 6.2: Run to confirm passing**

```bash
cd cloud-agent && npm test 2>&1 | grep -E 'DB lookup|FAIL' | head -5
```

Expected: `pushToLive uses DB lookup...` → pass.

- [ ] **Step 6.3: Run full test suite**

```bash
cd cloud-agent && npm test 2>&1 | tail -15
```

Expected: all tests pass, `0 failures`.

- [ ] **Step 6.4: Commit**

```bash
git add cloud-agent/src/handlers/wsLiveAgentHandler.test.ts
git commit -m "test(bridge): verify pushToLive Expo Push fallback uses DB lookup when not injected"
```

---

## Task 7: Cloud Scheduler Setup (Infrastructure — No Code)

This task configures the GCP-side infrastructure. It is manual and not automated by tests.

- [ ] **Step 7.1: Set `SCHEDULER_SECRET` environment variable on Cloud Run**

In GCP Console → Cloud Run → `cloud-agent` service → Edit & Deploy New Revision → Variables & Secrets:

Add environment variable:

```bash
SCHEDULER_SECRET = <generate a long random secret, e.g. openssl rand -hex 32>
```

Store the secret in 1Password as `cloud-agent/SCHEDULER_SECRET`.

- [ ] **Step 7.2: Create Cloud Scheduler job**

In GCP Console → Cloud Scheduler → Create Job:

```text
Name:        browser-bridge-price-monitor
Region:      us-central1
Frequency:   0 * * * *   (hourly, adjust per use case)
Target:      HTTP
URL:         https://<cloud-agent-url>/agent/browser/scheduler-trigger
HTTP method: POST
Body:        {
               "uid": "<firebase_uid_of_target_user>",
               "runKey": "<cloud-scheduler-job-name>-<execution-id>",
               "action": {
                 "type": "extract",
                 "selector": ".price",
                 "label": "price"
               },
               "actionSummary": "Extract current price from open tab",
               "notificationBody": "Price check complete. Tap to review."
             }
Auth header: Add header
             Authorization: Bearer <SCHEDULER_SECRET from Step 7.1>
             Content-Type: application/json
```

- [ ] **Step 7.3: Trigger the job manually and verify end-to-end**

GCP Console → Cloud Scheduler → Force Run the job. Verify:
1. Cloud Run logs show `[scheduler-trigger]` entries
2. Extension wakes and executes the extract action
3. Mobile device receives `PROACTIVE_TASK` Expo Push notification
4. Tap notification → opens `/talk` deep link

This is the Phase 3 gate: **1 working scheduled monitoring task**.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Cloud Scheduler triggers | Task 4 + Task 5 + Task 7 |
| `sendProactive` Expo Push | Task 1 |
| Expo Push async completion (voice session closed) | Task 3 |
| `trigger: 'scheduler'` in SessionDoc | Already in `dsl-types.ts` — no change |
| Proactive FCM payload shape (`PROACTIVE_TASK`, high priority, `categoryIdentifier`) | Task 1 |
| Phase 3 gate: 1 working scheduled monitoring task | Task 7 |

**`open question` from spec resolved:** Cloud Scheduler uses same `TaskIntent` DSL envelope — no new envelope needed.

**Placeholder scan:** None — all steps include concrete code.

**Type consistency:**
- `sendProactive(expoPushToken, sessionId, taskId, body)` — consistent between Task 1 (definition) and Task 4 (usage)
- `pushToLive(taskId, sessionId, text)` — consistent between Task 2 (definition change) and Task 3 (usage)
- `createSchedulerTriggerHandler(fs, fcm, getExpoPushToken, creditService, resolveUserId, opts)` — consistent between Task 4 (definition) and Task 5 (wiring)
- `FcmDispatcher` type is `ReturnType<typeof createFcmDispatcher>` — adding `sendProactive` to the factory auto-updates the type
