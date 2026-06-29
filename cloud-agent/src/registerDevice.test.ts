// cloud-agent/src/registerDevice.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

const { createApp } = await import('./index.js')

function startApp(overrides: Record<string, unknown> = {}) {
  const writes: unknown[] = []
  const app = createApp({
    verifyToken: async () => ({ uid: 'fb-uid-1' }),
    db: {} as never,
    runAgentFn: async () => ({ reply: 'x', toolCalls: [] }),
    upsertDevice: async (uid: string, body: unknown) => { writes.push({ uid, body }) },
    ...overrides,
  } as never)
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, port, writes }
}

test('register-device rejects unauthenticated requests', async () => {
  const { server, port } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fcmToken: 't', deviceId: 'd', deviceName: 'Mac' }),
  })
  assert.equal(res.status, 401)
  server.close()
})

test('register-device upserts on valid body', async () => {
  const { server, port, writes } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
    body: JSON.stringify({ fcmToken: 'tok', deviceId: 'dev-1', deviceName: 'Home Mac — Chrome', isPaused: false }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal((writes[0] as { uid: string }).uid, 'fb-uid-1')
  server.close()
})

test('register-device 400 on missing fields', async () => {
  const { server, port } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
    body: JSON.stringify({ deviceId: 'd' }),
  })
  assert.equal(res.status, 400)
  server.close()
})
