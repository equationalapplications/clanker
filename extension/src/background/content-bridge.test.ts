import test from 'node:test'
import assert from 'node:assert/strict'
import { installChromeStub } from '../../test/chrome-stub.js'

test('openTab requires host permission; throws HOST_PERMISSION_REQUIRED when absent', async () => {
  const store: Record<string, unknown> = {}
  installChromeStub({
    permissions: { contains: async () => false, request: async () => false },
    notifications: { create: () => {} },
    storage: { local: {
      get: async (keys: string | string[] | Record<string, unknown>) => {
        const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys)
        return Object.fromEntries(list.map((k) => [k, store[k]]))
      },
      set: async (o: Record<string, unknown>) => { Object.assign(store, o) },
    } },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  await assert.rejects(() => inj.openTab('https://amazon.com/cart'), /HOST_PERMISSION_REQUIRED/)
  assert.equal(store.pendingHost, 'amazon.com')
  assert.equal(store.pendingOrigin, 'https://amazon.com/*')
})

test('runInActiveTab returns the injected script result', async () => {
  installChromeStub({
    permissions: { contains: async () => true, request: async () => true },
    runtime: {
      sendMessage: async () => undefined,
      onMessage: { addListener: () => {} },
      getURL: (p: string) => p,
      lastError: undefined,
    },
    tabs: {
      query: async () => [{ id: 7, url: 'https://x.com/a' }],
      create: async () => ({ id: 1 }),
      update: async () => ({}),
      sendMessage: (_tabId: number, msg: { type: string }, cb: (response: unknown) => void) => {
        assert.equal(msg.type, 'CLANKER_RUN_ACTION')
        cb({ data: { price: '$3' }, activeUrl: 'https://x.com/a' })
      },
    },
    scripting: { executeScript: async () => [] },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  const out = await inj.runInActiveTab({ type: 'extract', selector: '.p', label: 'price' })
  assert.ok('data' in out)
  assert.deepEqual(out.data, { price: '$3' })
})
