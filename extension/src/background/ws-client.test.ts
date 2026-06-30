import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createWsClient } from './ws-client.js'

class FakeSocket extends EventEmitter {
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  fireOpen() { this.onopen?.() }
  fireMessage(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }) }
}

test('sends auth frame on open', () => {
  let sock!: FakeSocket
  const WebSocketImpl = class extends FakeSocket {
    constructor(_url: string) { super(); sock = this }
  }
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: WebSocketImpl as never,
    onTask: () => {}, onSessionEnd: () => {},
  })
  client.connect()
  sock.fireOpen()
  assert.equal(JSON.parse(sock.sent[0]).type, 'auth')
  assert.equal(JSON.parse(sock.sent[0]).sessionId, 's1')
  client.close()
})

test('routes task and session_end frames', () => {
  let sock!: FakeSocket
  const WebSocketImpl = class extends FakeSocket {
    constructor(_url: string) { super(); sock = this }
  }
  const tasks: unknown[] = []; let ended = false
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: WebSocketImpl as never,
    onTask: (t) => tasks.push(t), onSessionEnd: () => { ended = true },
  })
  client.connect(); sock.fireOpen()
  sock.fireMessage({ type: 'session_ready', sessionId: 's1' })
  sock.fireMessage({ type: 'task', intent: { taskId: 't1' } })
  sock.fireMessage({ type: 'session_end' })
  assert.equal(tasks.length, 1)
  assert.equal(ended, true)
  client.close()
})

test('session_ready invokes onSessionReady', () => {
  let sock!: FakeSocket
  const WebSocketImpl = class extends FakeSocket {
    constructor(_url: string) { super(); sock = this }
  }
  let ready = false
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: WebSocketImpl as never,
    onTask: () => {}, onSessionEnd: () => {}, onSessionReady: () => { ready = true },
  })
  client.connect(); sock.fireOpen()
  sock.fireMessage({ type: 'session_ready', sessionId: 's1' })
  assert.equal(ready, true)
  client.close()
})

test('sendResult emits task_result frame', () => {
  let sock!: FakeSocket
  const WebSocketImpl = class extends FakeSocket {
    constructor(_url: string) { super(); sock = this }
  }
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: WebSocketImpl as never,
    onTask: () => {}, onSessionEnd: () => {},
  })
  client.connect(); sock.fireOpen()
  client.sendResult({ taskId: 't1', status: 'complete', data: { a: 'b' }, activeUrl: 'https://x' })
  const frame = JSON.parse(sock.sent.find((s) => JSON.parse(s).type === 'task_result')!)
  assert.deepEqual(frame.data, { a: 'b' })
  client.close()
})

test('sendAwaitingAuth sends correct frame', () => {
  let sock!: FakeSocket
  const WebSocketImpl = class extends FakeSocket {
    constructor(_url: string) { super(); sock = this }
  }
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: WebSocketImpl as never,
    onTask: () => {}, onSessionEnd: () => {},
  })
  client.connect(); sock.fireOpen()
  client.sendAwaitingAuth('t1', 2, {}, '')
  const frame = JSON.parse(sock.sent.find((s) => JSON.parse(s).type === 'awaiting_auth') ?? '{}') as { type: string; taskId: string; haltedStepIndex: number }
  assert.equal(frame.type, 'awaiting_auth')
  assert.equal(frame.taskId, 't1')
  assert.equal(frame.haltedStepIndex, 2)
  client.close()
})
