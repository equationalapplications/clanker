import test from 'node:test'
import assert from 'node:assert/strict'
import { startAuthApprovalObserver } from './authApprovalObserver.js'

function baseDeps(over: Record<string, unknown> = {}) {
  const results: unknown[] = []
  const pushes: unknown[] = []
  let watcher: ((auth: Record<string, unknown>) => void) | null = null
  let unsubbed = false

  const deps = {
    fs: {
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        watcher = cb
        return () => { unsubbed = true }
      },
      writeTaskResult: async (...a: unknown[]) => { results.push(a) },
    },
    fcmDispatcher: {
      wakeExtension: async (...a: unknown[]) => { pushes.push({ type: 'wake', args: a }) },
      sendTaskComplete: async (...a: unknown[]) => { pushes.push({ type: 'complete', args: a }) },
    },
    verifyToken: async () => ({ uid: 'uid1' }),
    getExpoPushToken: async () => 'ExponentPushToken[x]',
    firebaseUid: 'uid1',
    sessionId: 'sid1',
    taskId: 'tid1',
    intent: {
      version: '1', taskId: 'tid1', sessionId: 'sid1', requiresAuth: true,
      actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
    },
    deviceFcmToken: 'gcm-tok',
    authApprovalTtlMs: 50,
    ...over,
  }

  return { deps, getWatcher: () => watcher, results, pushes, getUnsubbed: () => unsubbed }
}

test('denied writes aborted + sendTaskComplete and unsubscribes', async () => {
  const { deps, getWatcher, results, pushes, getUnsubbed } = baseDeps()
  startAuthApprovalObserver(deps as never)

  getWatcher()!({ status: 'denied', approvalToken: null, approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(results.length, 1)
  const result = (results[0] as unknown[])[3] as { status: string; error: { code: string; message: string } }
  assert.equal(result.status, 'aborted')
  assert.equal(result.error.code, 'AUTH_TIMEOUT')
  assert.match(result.error.message, /denied/i)
  assert.equal(pushes.length, 1)
  assert.equal((pushes[0] as { type: string }).type, 'complete')
  assert.ok(getUnsubbed())
})

test('approved verifies token and sends FCM resume wake', async () => {
  const { deps, getWatcher, pushes } = baseDeps({
    verifyToken: async (t: string) => {
      assert.equal(t, 'approval-tok')
      return { uid: 'uid1' }
    },
  })
  startAuthApprovalObserver(deps as never)

  getWatcher()!({ status: 'approved', approvalToken: 'approval-tok', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(pushes.length, 1)
  assert.equal((pushes[0] as { type: string }).type, 'wake')
  const wakeArgs = (pushes[0] as { args: unknown[] }).args
  assert.equal(wakeArgs[3], true)
})

test('failed FCM wake aborts task instead of resolving', async () => {
  const { deps, getWatcher, results } = baseDeps({
    fcmDispatcher: {
      wakeExtension: async () => { throw new Error('FCM error') },
      sendTaskComplete: async () => {},
    },
  })
  startAuthApprovalObserver(deps as never)

  getWatcher()!({ status: 'approved', approvalToken: 'approval-tok', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  assert.ok(results.length >= 1)
  const result = (results[0] as unknown[])[3] as { status: string; error: { message: string } }
  assert.equal(result.status, 'aborted')
  assert.match(result.error.message, /wake/i)
})

test('5-minute TTL aborts with AUTH_TIMEOUT and sendTaskComplete', async () => {
  const { deps, results, pushes } = baseDeps({ authApprovalTtlMs: 30 })
  startAuthApprovalObserver(deps as never)

  await new Promise((r) => setTimeout(r, 50))

  assert.equal(results.length, 1)
  const result = (results[0] as unknown[])[3] as { error: { code: string; message: string } }
  assert.equal(result.error.code, 'AUTH_TIMEOUT')
  assert.match(result.error.message, /timed out/i)
  assert.equal(pushes.length, 1)
})

test('invalid approval token aborts and notifies mobile', async () => {
  const { deps, getWatcher, results, pushes } = baseDeps({
    verifyToken: async () => { throw new Error('bad token') },
  })
  startAuthApprovalObserver(deps as never)

  getWatcher()!({ status: 'approved', approvalToken: 'bad', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(results.length, 1)
  const result = (results[0] as unknown[])[3] as { error: { message: string } }
  assert.match(result.error.message, /invalid/i)
  assert.equal(pushes.length, 1)
})
