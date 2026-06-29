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

test('sendApprovalCard POSTs correct Expo Push payload', async () => {
  const fetched: Array<{ url: string; body: unknown }> = []
  const fakeFetch = async (url: string, opts: RequestInit) => {
    fetched.push({ url, body: JSON.parse(opts.body as string) })
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }

  const dispatcher = createFcmDispatcher(
    { send: async () => 'msg-id' },
    fakeFetch as unknown as typeof fetch,
  )

  await dispatcher.sendApprovalCard('ExponentPushToken[abc]', 'sid1', 'tid1', 'Submit $42')

  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].url, 'https://exp.host/--/api/v2/push/send')
  const body = fetched[0].body as Record<string, unknown>
  assert.equal(body.to, 'ExponentPushToken[abc]')
  assert.equal(body.categoryIdentifier, 'BROWSER_ACTION_APPROVAL')
  assert.equal((body.data as Record<string, string>).sessionId, 'sid1')
  assert.equal((body.data as Record<string, string>).taskId, 'tid1')
  assert.equal(body.ttl, 300)
})

test('sendTaskComplete POSTs correct Expo Push payload', async () => {
  const fetched: Array<{ body: unknown }> = []
  const fakeFetch = async (_url: string, opts: RequestInit) => {
    fetched.push({ body: JSON.parse(opts.body as string) })
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }

  const dispatcher = createFcmDispatcher(
    { send: async () => 'msg-id' },
    fakeFetch as unknown as typeof fetch,
  )

  await dispatcher.sendTaskComplete('ExponentPushToken[xyz]', 'sid1', 'tid1', 'Article summary ready.')

  const body = fetched[0].body as Record<string, unknown>
  assert.equal(body.to, 'ExponentPushToken[xyz]')
  assert.equal(body.priority, 'normal')
  const data = body.data as Record<string, string>
  assert.equal(data.type, 'TASK_COMPLETE')
  assert.equal(data.sessionId, 'sid1')
  assert.equal(data.taskId, 'tid1')
  assert.equal(data.deepLink, '/talk')
})
