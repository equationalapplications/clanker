import test from 'node:test'
import assert from 'node:assert/strict'
import { installChromeStub } from '../../test/chrome-stub.js'

test('openTab requires host permission; throws HOST_PERMISSION_REQUIRED when absent', async () => {
  installChromeStub({
    permissions: { contains: async () => false, request: async () => false },
    notifications: { create: () => {} },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  await assert.rejects(() => inj.openTab('https://amazon.com/cart'), /HOST_PERMISSION_REQUIRED/)
})

test('runInActiveTab returns the injected script result', async () => {
  installChromeStub({
    permissions: { contains: async () => true, request: async () => true },
    tabs: { query: async () => [{ id: 7, url: 'https://x.com/a' }], create: async () => ({ id: 1 }), update: async () => ({}) },
    scripting: { executeScript: async () => [{ result: { data: { price: '$3' }, activeUrl: 'https://x.com/a' } }] },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  const out = await inj.runInActiveTab({ type: 'extract', selector: '.p', label: 'price' })
  assert.deepEqual(out.data, { price: '$3' })
})
