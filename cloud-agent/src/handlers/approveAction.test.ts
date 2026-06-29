import test from 'node:test'
import assert from 'node:assert/strict'
import { handleApproveAction } from './approveAction.js'

test('handleApproveAction writes approved to auth doc', async () => {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = []
  const fakeDb = {
    doc: (path: string) => ({
      update: async (data: Record<string, unknown>) => { updates.push({ path, data }) },
    }),
  }

  await handleApproveAction(fakeDb as never, 'uid1', {
    sessionId: 'sid1', taskId: 'tid1', approve: true, idToken: 'raw-token',
  })

  assert.equal(updates.length, 1)
  assert.equal(updates[0].path, 'users/uid1/sessions/sid1/auth/tid1')
  assert.equal(updates[0].data.status, 'approved')
  assert.equal(updates[0].data.approvalToken, 'raw-token')
})

test('handleApproveAction writes denied to auth doc', async () => {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = []
  const fakeDb = {
    doc: (path: string) => ({
      update: async (data: Record<string, unknown>) => { updates.push({ path, data }) },
    }),
  }

  await handleApproveAction(fakeDb as never, 'uid1', {
    sessionId: 'sid1', taskId: 'tid1', approve: false, idToken: '',
  })

  assert.equal(updates[0].data.status, 'denied')
})
