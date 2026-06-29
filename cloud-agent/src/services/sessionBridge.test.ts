// cloud-agent/src/services/sessionBridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createSessionBridge } = await import('./sessionBridge.js')

const fakeWs = () => ({ readyState: 1 }) as unknown as import('ws').WebSocket

test('registerBrowser then getSession returns the browserWs', () => {
  const b = createSessionBridge()
  const ws = fakeWs()
  b.registerBrowser('u1', 's1', ws)
  assert.equal(b.getSession('u1', 's1')?.browserWs, ws)
})

test('voice + browser co-registration on same key', () => {
  const b = createSessionBridge()
  const v = fakeWs(); const br = fakeWs()
  b.registerVoice('u1', 's1', v)
  b.registerBrowser('u1', 's1', br)
  const s = b.getSession('u1', 's1')
  assert.equal(s?.voiceWs, v)
  assert.equal(s?.browserWs, br)
})

test('deregisterBrowser clears browserWs but keeps voice side', () => {
  const b = createSessionBridge()
  const v = fakeWs(); const br = fakeWs()
  b.registerVoice('u1', 's1', v)
  b.registerBrowser('u1', 's1', br)
  b.deregisterBrowser('u1', 's1')
  const s = b.getSession('u1', 's1')
  assert.equal(s?.browserWs, null)
  assert.equal(s?.voiceWs, v)
})

test('deregister removes the entry', () => {
  const b = createSessionBridge()
  b.registerBrowser('u1', 's1', fakeWs())
  b.deregister('u1', 's1')
  assert.equal(b.getSession('u1', 's1'), undefined)
})

test('different uids/sessions are isolated', () => {
  const b = createSessionBridge()
  b.registerBrowser('u1', 's1', fakeWs())
  assert.equal(b.getSession('u2', 's1'), undefined)
  assert.equal(b.getSession('u1', 's2'), undefined)
})
