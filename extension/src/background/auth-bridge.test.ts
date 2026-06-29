import test from 'node:test'
import assert from 'node:assert/strict'
import { installChromeStub } from '../../test/chrome-stub.js'

test('requestIdToken messages the offscreen doc and returns the token', async () => {
  installChromeStub({
    offscreen: { hasDocument: async () => true, createDocument: async () => {}, closeDocument: async () => {} },
    runtime: { sendMessage: async (msg: { type: string }) => (msg.type === 'GET_ID_TOKEN' ? { idToken: 'id-123' } : undefined) },
  })
  const { requestIdToken } = await import('./auth-bridge.js')
  assert.equal(await requestIdToken(), 'id-123')
})

test('ensureOffscreen creates a document only when absent', async () => {
  let created = 0
  installChromeStub({
    offscreen: { hasDocument: async () => false, createDocument: async () => { created++ }, closeDocument: async () => {} },
  })
  const { ensureOffscreen } = await import('./auth-bridge.js')
  await ensureOffscreen()
  assert.equal(created, 1)
})
