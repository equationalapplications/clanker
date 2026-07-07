// cloud-agent/src/handlers/wsDesktopAgentHandler.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const { handleDesktopWsUpgrade } = await import('./wsDesktopAgentHandler.js')
const { createDesktopBridge } = await import('../services/desktopBridge.js')

class FakeWs extends EventEmitter {
  OPEN = 1
  readyState = 1
  sent: string[] = []
  closeCode: number | null = null
  send(data: string) { this.sent.push(data) }
  close(code?: number) { this.closeCode = code ?? 1000; this.readyState = 3; this.emit('close') }
  frames() { return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>) }
}

function fakeSession(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[][]> = {
    markDesktopDeviceOnline: [], markDesktopDeviceOffline: [], touchDesktopDeviceLastSeen: [],
    markDesktopTaskExecuting: [], writeDesktopTaskResult: [], failDesktopTaskIfUnresolved: [],
  }
  let pendingCb: ((tasks: Array<Record<string, unknown>>) => void) | null = null
  let deviceCb: ((doc: { exists: boolean; isPaused: boolean }) => void) | null = null
  const fs = {
    calls,
    emitPending(tasks: Array<Record<string, unknown>>) { pendingCb?.(tasks) },
    emitDevice(doc: { exists: boolean; isPaused: boolean }) { deviceCb?.(doc) },
    markDesktopDeviceOnline: async (...a: unknown[]) => { calls.markDesktopDeviceOnline.push(a) },
    markDesktopDeviceOffline: async (...a: unknown[]) => { calls.markDesktopDeviceOffline.push(a) },
    touchDesktopDeviceLastSeen: async (...a: unknown[]) => { calls.touchDesktopDeviceLastSeen.push(a) },
    markDesktopTaskExecuting: async (...a: unknown[]) => { calls.markDesktopTaskExecuting.push(a) },
    writeDesktopTaskResult: async (...a: unknown[]) => { calls.writeDesktopTaskResult.push(a) },
    failDesktopTaskIfUnresolved: async (...a: unknown[]) => { calls.failDesktopTaskIfUnresolved.push(a); return true },
    watchPendingDesktopTasks: (_u: string, _d: string, cb: (t: Array<Record<string, unknown>>) => void) => {
      pendingCb = cb; return () => { pendingCb = null }
    },
    watchDesktopDeviceDoc: (_u: string, _d: string, cb: (doc: { exists: boolean; isPaused: boolean }) => void) => {
      deviceCb = cb; return () => { deviceCb = null }
    },
    getDesktopDeviceDoc: async () => ({ exists: true, isPaused: false }),
    ...over,
  }
  return fs
}

function options(fs: ReturnType<typeof fakeSession>, bridge = createDesktopBridge(), over: Record<string, unknown> = {}) {
  return {
    firestoreSession: fs as never,
    desktopBridge: bridge,
    resolvePairingToken: async (raw: string) => (raw === 'good-token' ? { uid: 'u1', deviceId: 'desk1' } : null),
    instanceId: 'instance-A',
    authTimeoutMs: 50,
    lastSeenRefreshMs: 0,
    ...over,
  }
}

function authFrame() { return JSON.stringify({ type: 'auth', pairingToken: 'good-token' }) }
async function tick() { await new Promise((r) => setTimeout(r, 0)) }

test('valid pairing token: marks online, subscribes, sends ready', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  assert.deepEqual(fs.calls.markDesktopDeviceOnline[0], ['u1', 'desk1', 'instance-A'])
  assert.ok(ws.frames().some((f) => f.type === 'ready'))
})

test('bad pairing token closes 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', pairingToken: 'wrong' }))); await tick()
  assert.equal(ws.closeCode, 4001)
})

test('no auth frame within timeout closes 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(ws.closeCode, 4001)
})

test('paused device is rejected at auth', async () => {
  const ws = new FakeWs()
  const fs = fakeSession({ getDesktopDeviceDoc: async () => ({ exists: true, isPaused: true }) })
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  assert.equal(ws.closeCode, 4001)
})

test('pending task is marked executing and dispatched once over WS', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: { query: 'x' }, status: 'pending', deviceId: 'desk1' }])
  await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: { query: 'x' }, status: 'pending', deviceId: 'desk1' }])
  await tick()
  const taskFrames = ws.frames().filter((f) => f.type === 'task')
  assert.equal(taskFrames.length, 1)
  assert.equal(taskFrames[0].taskId, 't1')
  assert.equal(fs.calls.markDesktopTaskExecuting.length, 1)
})

test('task_result writes complete result; task_error writes failure', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'task_result', taskId: 't1', result: { hits: 2 } }))); await tick()
  assert.deepEqual(fs.calls.writeDesktopTaskResult[0], ['u1', 't1', { status: 'complete', result: { hits: 2 } }])

  fs.emitPending([{ taskId: 't2', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'task_error', taskId: 't2', error: { code: 'E', message: 'boom' } }))); await tick()
  assert.deepEqual(fs.calls.writeDesktopTaskResult[1], ['u1', 't2', { status: 'failed', error: { code: 'TOOL_ERROR', message: 'boom' } }])
})

test('ping gets pong and refreshes lastSeenAt (throttle disabled in test)', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping' }))); await tick()
  assert.ok(ws.frames().some((f) => f.type === 'pong'))
  assert.equal(fs.calls.touchDesktopDeviceLastSeen.length, 1)
})

test('close marks device offline and fails in-flight dispatched tasks', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('close'); await tick()
  assert.equal(fs.calls.markDesktopDeviceOffline.length, 1)
  assert.equal(fs.calls.failDesktopTaskIfUnresolved.length, 1)
  assert.equal((fs.calls.failDesktopTaskIfUnresolved[0][2] as { code: string }).code, 'DESKTOP_DISCONNECTED')
})

test('replacement race: stale close after new registration must NOT mark device offline', async () => {
  const bridge = createDesktopBridge()
  const fs = fakeSession()
  const ws1 = new FakeWs()
  handleDesktopWsUpgrade(ws1 as never, {} as never, options(fs, bridge) as never)
  ws1.emit('message', Buffer.from(authFrame())); await tick()

  const ws2 = new FakeWs()
  handleDesktopWsUpgrade(ws2 as never, {} as never, options(fs, bridge) as never)
  ws2.emit('message', Buffer.from(authFrame())); await tick()
  const offlineCalls = fs.calls.markDesktopDeviceOffline.length
  assert.equal(offlineCalls, 0, 'stale close must not mark the replaced device offline')
  assert.equal(bridge.get('u1', 'desk1')?.ws, ws2 as never)
})

test('device-doc listener: revoke (doc delete) closes socket 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitDevice({ exists: false, isPaused: false })
  await tick()
  assert.equal(ws.closeCode, 4001)
  assert.equal(fs.calls.markDesktopDeviceOffline.length, 0, 'revoked doc should skip offline write')
})

test('device-doc listener: pause closes socket 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitDevice({ exists: true, isPaused: true })
  await tick()
  assert.equal(ws.closeCode, 4001)
})

test('duplicate auth frames: second frame is ignored, no self-close', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  const bridge = createDesktopBridge()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs, bridge) as never)
  ws.emit('message', Buffer.from(authFrame()))
  ws.emit('message', Buffer.from(authFrame())); await tick()
  assert.equal(ws.closeCode, null, 'no close due to duplicate auth')
  assert.ok(ws.frames().some((f) => f.type === 'ready'))
  assert.equal(bridge.get('u1', 'desk1')?.ws, ws as never)
})

test('close during auth: does not register, does not call markDesktopDeviceOnline', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  const bridge = createDesktopBridge()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs, bridge) as never)
  ws.emit('message', Buffer.from(authFrame()))
  ws.readyState = 3
  ws.emit('close'); await tick()
  assert.equal(fs.calls.markDesktopDeviceOnline.length, 0, 'auth did not complete before close')
  assert.equal(bridge.get('u1', 'desk1'), undefined, 'connection not registered after close')
})
