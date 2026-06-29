// cloud-agent/src/tools/browserAction.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { browserActionTool } = await import('./browserAction.js')

function baseDeps(over: Record<string, unknown> = {}) {
  const calls: Record<string, number> = { spend: 0, refund: 0, wake: 0, writeTask: 0 }
  return {
    calls,
    deps: {
      uid: 'u1',
      firestoreSession: {
        getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
        createSession: async () => {},
        writeTask: async () => { calls.writeTask++ },
        writeTaskResult: async () => {},
        getTask: async () => ({ status: 'pending' }),
        getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
        closeSession: async () => {},
        watchTask: (_u: string, _s: string, _t: string, cb: (d: unknown) => void) => {
          setTimeout(() => cb({ status: 'complete', result: { data: { price: '$5' }, activeUrl: 'https://x' } }), 5)
          return () => {}
        },
      },
      fcmDispatcher: { wakeExtension: async () => { calls.wake++ } },
      creditService: { spendCredit: async () => { calls.spend++; return 'tx1' }, refundCredit: async () => { calls.refund++ } },
      instanceId: 'i1',
      wakeTimeoutMs: 50,
      textTimeoutMs: 200,
      ...over,
    },
  }
}

test('no device → tool error, no credit spent', async () => {
  const { deps, calls } = baseDeps({
    firestoreSession: { ...baseDeps().deps.firestoreSession, getActiveDevice: async () => null },
  })
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  assert.match(out, /not paired|Install/i)
  assert.equal(calls.spend, 0)
  assert.equal(calls.wake, 0)
})

test('text path is preBilled → skips spendCredit', async () => {
  const { deps, calls } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'extract', selector: '.p', label: 'price' } },
  })
  assert.equal(calls.spend, 0)
  assert.equal(calls.wake, 1)
  assert.equal(calls.writeTask, 1)
})

test('voice path spends a credit', async () => {
  const { deps, calls } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'voice', preBilled: false })
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  assert.equal(calls.spend, 1)
})

test('text path returns the completed result string', async () => {
  const { deps } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'extract', selector: '.p', label: 'price' } },
  })
  assert.match(out, /\$5/)
})

test('voice wake timeout (no connect) refunds and reports offline', async () => {
  const fs = {
    ...baseDeps().deps.firestoreSession,
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    watchTask: (_u: string, _s: string, _t: string, cb: (d: unknown) => void) => {
      setTimeout(() => cb({ status: 'failed', result: null, error: { code: 'EXTENSION_OFFLINE', message: 'offline' } }), 60)
      return () => {}
    },
  }
  const { deps, calls } = baseDeps({ firestoreSession: fs })
  const tool = browserActionTool(deps as never, { trigger: 'voice', preBilled: false })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(calls.refund, 1)
  assert.match(out, /sent|offline|browser/i)
})
