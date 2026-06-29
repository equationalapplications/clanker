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
