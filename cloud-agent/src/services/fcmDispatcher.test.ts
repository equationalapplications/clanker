// cloud-agent/src/services/fcmDispatcher.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createFcmDispatcher } = await import('./fcmDispatcher.js')

test('wakeExtension sends WAKE_AND_CONNECT data payload to the token', async () => {
  const sent: unknown[] = []
  const messaging = { send: async (msg: unknown) => { sent.push(msg); return 'msg-id' } }
  const fcm = createFcmDispatcher(messaging as never)
  await fcm.wakeExtension('tok-123', 's1', 't1')
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    token: 'tok-123',
    data: { type: 'WAKE_AND_CONNECT', sessionId: 's1', taskId: 't1', resume: 'false' },
  })
})

test('wakeExtension marks resume=true when requested', async () => {
  const sent: Array<{ data: { resume: string } }> = []
  const messaging = { send: async (msg: never) => { sent.push(msg); return 'm' } }
  const fcm = createFcmDispatcher(messaging as never)
  await fcm.wakeExtension('tok', 's', 't', true)
  assert.equal(sent[0].data.resume, 'true')
})
