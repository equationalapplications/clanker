// cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const { handleBrowserWsUpgrade } = await import('./wsBrowserAgentHandler.js')

class FakeWs extends EventEmitter {
  static OPEN = 1
  OPEN = 1
  readyState = 1
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  send(s: string) { this.sent.push(s) }
  close(code?: number, reason?: string) { this.readyState = 3; this.closed = { code, reason } }
  emitJson(obj: unknown) { this.emit('message', Buffer.from(JSON.stringify(obj))) }
}

const SESSION_ID = '00000000-0000-4000-8000-000000000001'

function deps(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = { mark: [], result: [] }
  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: false,
    actionSummary: 'x', action: { type: 'read_dom', selector: 'body' },
  }
  return {
    calls,
    options: {
      verifyToken: async () => ({ uid: 'fb-uid' }),
      resolveUserId: async () => 'fb-uid',
      firestoreSession: {
        getSession: async () => ({ status: 'pending' }),
        getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
        getTask: async () => ({ status: 'pending', intent: pendingIntent }),
        markBrowserConnected: async (...a: unknown[]) => { calls.mark.push(a) },
        writeTaskResult: async (...a: unknown[]) => { calls.result.push(a) },
        closeSession: async () => {},
      },
      validateDevice: async () => true,
      instanceId: 'i-test',
      authTimeoutMs: 50,
      authApprovalTtlMs: 60_000,
      ...over,
    },
  }
}

test('closes 4001 when no auth frame within timeout', async () => {
  const ws = new FakeWs()
  const { options } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(ws.closed?.code, 4001)
})

test('auth → markBrowserConnected → session_ready → dispatch task', async () => {
  const ws = new FakeWs()
  const { options, calls } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.mark.length, 1)
  const types = ws.sent.map((s) => JSON.parse(s).type)
  assert.ok(types.includes('session_ready'))
  assert.ok(types.includes('task'))
})

test('task_result frame is persisted via writeTaskResult', async () => {
  const ws = new FakeWs()
  const { options, calls } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'task_result', taskId: 't1', data: { k: 'v' }, activeUrl: 'https://x' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.result.length, 1)
  const result = (calls.result[0] as unknown[])[3] as { status: string; data: Record<string, string> }
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.data, { k: 'v' })
})

test('rejects auth when deviceId invalid', async () => {
  const ws = new FakeWs()
  const { options } = deps({ validateDevice: async () => false })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'bad' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ws.closed?.code, 4001)
})

test('awaiting_auth frame calls haltForAuth and sendApprovalCard', async () => {
  const ws = new FakeWs()
  const calls: Record<string, unknown[]> = { halt: [], approval: [] }
  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit payment', action: { type: 'sequence', steps: [
      { type: 'open_tab', url: 'https://shop.com' },
      { type: 'click', selector: '#buy', label: 'Buy Now', tier: 'stateful' },
    ] },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
      haltForAuth: async (...a: unknown[]) => { calls.halt.push(a) },
      watchAuth: () => () => {},
    },
    fcmDispatcher: {
      wakeExtension: async () => {},
      sendApprovalCard: async (...a: unknown[]) => { calls.approval.push(a) },
      sendTaskComplete: async () => {},
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
    getDeviceFcmToken: async () => 'gcm-tok-123',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 1 })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.halt.length, 1)
  assert.equal(calls.approval.length, 1)
  const [, , , haltIdx, summary] = calls.halt[0] as [string, string, string, number, string]
  assert.equal(haltIdx, 1)
  assert.equal(summary, 'Submit payment')
})

test('watchAuth approved → sends FCM wake with resume', async () => {
  const ws = new FakeWs()
  let authWatcher: ((auth: Record<string, unknown>) => void) | null = null
  const fcmWakes: unknown[] = []

  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit payment', action: { type: 'sequence', steps: [
      { type: 'click', selector: '#buy', tier: 'stateful' },
    ] },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
      haltForAuth: async () => {},
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        authWatcher = cb; return () => {}
      },
    },
    fcmDispatcher: {
      wakeExtension: async (...a: unknown[]) => { fcmWakes.push(a) },
      sendApprovalCard: async () => {},
      sendTaskComplete: async () => {},
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
    getDeviceFcmToken: async () => 'gcm-tok-123',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  authWatcher!({ status: 'approved', approvalToken: 'valid-approval-token', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(fcmWakes.length, 1)
  const [, , , resume] = fcmWakes[0] as [string, string, string, boolean]
  assert.equal(resume, true)
})

test('watchAuth denied → aborts task and sends session_end', async () => {
  const ws = new FakeWs()
  let authWatcher: ((auth: Record<string, unknown>) => void) | null = null
  const results: unknown[] = []
  const taskCompletes: unknown[] = []

  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async (...a: unknown[]) => { results.push(a) },
      closeSession: async () => {},
      haltForAuth: async () => {},
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        authWatcher = cb; return () => {}
      },
    },
    fcmDispatcher: {
      wakeExtension: async () => {},
      sendApprovalCard: async () => {},
      sendTaskComplete: async (...a: unknown[]) => { taskCompletes.push(a) },
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
    getDeviceFcmToken: async () => 'gcm-tok-123',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  authWatcher!({ status: 'denied', approvalToken: null, approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  const sent = ws.sent.map((s: string) => JSON.parse(s) as { type: string })
  assert.ok(sent.some((s) => s.type === 'session_end'))
  const writeResult = (results[0] as unknown[])[3] as { status: string; error: { code: string; message: string } }
  assert.equal(writeResult.status, 'aborted')
  assert.equal(writeResult.error.code, 'AUTH_DENIED')
  assert.match(writeResult.error.message, /denied/i)
  assert.equal(taskCompletes.length, 1)
})

test('null deviceFcmToken aborts task immediately on awaiting_auth', async () => {
  const ws = new FakeWs()
  const results: unknown[] = []
  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async (...a: unknown[]) => { results.push(a) },
      closeSession: async () => {},
      haltForAuth: async () => {},
    },
    fcmDispatcher: { wakeExtension: async () => {}, sendApprovalCard: async () => {}, sendTaskComplete: async () => {} },
    getExpoPushToken: async () => null,
    getDeviceFcmToken: async () => null,
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  const sent = ws.sent.map((s: string) => JSON.parse(s) as { type: string })
  assert.ok(sent.some((s) => s.type === 'session_end'))
  const writeResult = (results[0] as unknown[])[3] as { status: string }
  assert.equal(writeResult.status, 'aborted')
})

test('awaiting_auth with mismatched taskId closes WS 4001', async () => {
  const ws = new FakeWs()
  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
    },
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 'wrong-task', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(ws.closed?.code, 4001)
})

test('auth observer survives WS close after awaiting_auth', async () => {
  const ws = new FakeWs()
  let authWatcher: ((auth: Record<string, unknown>) => void) | null = null
  const fcmWakes: unknown[] = []

  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    verifyToken: async () => ({ uid: 'fb-uid' }),
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
      haltForAuth: async () => {},
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        authWatcher = cb; return () => {}
      },
    },
    fcmDispatcher: {
      wakeExtension: async (...a: unknown[]) => { fcmWakes.push(a) },
      sendApprovalCard: async () => {},
      sendTaskComplete: async () => {},
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
    getDeviceFcmToken: async () => 'gcm-tok-123',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  ws.close()
  await new Promise((r) => setTimeout(r, 10))

  authWatcher!({ status: 'approved', approvalToken: 'approval-id-token', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(fcmWakes.length, 1)
  const [, , , resume] = fcmWakes[0] as [string, string, string, boolean]
  assert.equal(resume, true)
})

test('resume from awaiting_auth sets authApproved true for single stateful action', async () => {
  const ws = new FakeWs()
  const singleClickIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending_auth' }),
      getFirstTask: async () => ({
        status: 'awaiting_auth', haltedStepIndex: 0, intent: singleClickIntent,
      }),
      getTask: async () => ({ status: 'awaiting_auth', intent: singleClickIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
    },
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))

  const taskFrame = ws.sent.map((s) => JSON.parse(s)).find((f) => f.type === 'task') as { intent: { requiresAuth: boolean; authApproved?: boolean } }
  assert.equal(taskFrame.intent.authApproved, true)
  assert.equal(taskFrame.intent.requiresAuth, true)
})
