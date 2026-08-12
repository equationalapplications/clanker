// cloud-agent/src/services/desktopBridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createDesktopBridge } = await import('./desktopBridge.js')

function fakeWs() {
  return {
    closed: false,
    close() {
      this.closed = true
    },
  }
}

test('register returns increasing generations and get returns latest', () => {
  const bridge = createDesktopBridge()
  const ws1 = fakeWs()
  const gen1 = bridge.register('u1', 'd1', ws1 as never, () => true)
  const ws2 = fakeWs()
  const gen2 = bridge.register('u1', 'd1', ws2 as never, () => true)
  assert.ok(gen2 > gen1)
  assert.equal(bridge.get('u1', 'd1')?.ws, ws2)
})

test('register closes the previous socket for the same uid:deviceId', () => {
  const bridge = createDesktopBridge()
  const ws1 = fakeWs()
  bridge.register('u1', 'd1', ws1 as never, () => true)
  bridge.register('u1', 'd1', fakeWs() as never, () => true)
  assert.equal(ws1.closed, true)
})

test('deregister with stale generation is a no-op and returns false', () => {
  const bridge = createDesktopBridge()
  const gen1 = bridge.register('u1', 'd1', fakeWs() as never, () => true)
  bridge.register('u1', 'd1', fakeWs() as never, () => true)
  assert.equal(bridge.deregister('u1', 'd1', gen1), false)
  assert.ok(bridge.get('u1', 'd1'))
})

test('deregister with current generation removes entry and returns true', () => {
  const bridge = createDesktopBridge()
  const gen = bridge.register('u1', 'd1', fakeWs() as never, () => true)
  assert.equal(bridge.deregister('u1', 'd1', gen), true)
  assert.equal(bridge.get('u1', 'd1'), undefined)
})

test('connections are isolated per uid:deviceId key', () => {
  const bridge = createDesktopBridge()
  bridge.register('u1', 'd1', fakeWs() as never, () => true)
  assert.equal(bridge.get('u1', 'd2'), undefined)
  assert.equal(bridge.get('u2', 'd1'), undefined)
})
