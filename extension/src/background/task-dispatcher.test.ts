import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchTask } from './task-dispatcher.js'

function injector(results: Record<string, { data: Record<string, string>; activeUrl: string }>) {
  const seen: string[] = []
  return {
    seen,
    runInActiveTab: async (action: { type: string }) => { seen.push(action.type); return results[action.type] },
    openTab: async (_url: string) => { seen.push('open_tab') },
    focusTab: async (_host: string) => { seen.push('focus_tab') },
  }
}

test('single extract action returns aggregated data', async () => {
  const inj = injector({ extract: { data: { price: '$1' }, activeUrl: 'https://x' } })
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x', action: { type: 'extract', selector: '.p', label: 'price' } },
    inj as never,
  )
  assert.equal(res.status, 'complete')
  assert.deepEqual(res.data, { price: '$1' })
})

test('sequence runs steps in order and merges data', async () => {
  const inj = injector({
    extract: { data: { total: '$9' }, activeUrl: 'https://x' },
    summarize_visible_text: { data: { summary: 'hi' }, activeUrl: 'https://x' },
  })
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x',
      action: { type: 'sequence', steps: [
        { type: 'open_tab', url: 'https://x' },
        { type: 'extract', selector: '.t', label: 'total' },
        { type: 'summarize_visible_text', filter: 'no_nav' },
      ] } },
    inj as never,
  )
  assert.deepEqual(inj.seen, ['open_tab', 'extract', 'summarize_visible_text'])
  assert.deepEqual(res.data, { total: '$9', summary: 'hi' })
})

test('selector failure → failed result with code', async () => {
  const inj = { runInActiveTab: async () => { throw new Error('SELECTOR_NOT_FOUND') }, openTab: async () => {}, focusTab: async () => {} }
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x', action: { type: 'extract', selector: '.x' } },
    inj as never,
  )
  assert.equal(res.status, 'failed')
  assert.equal(res.error?.code, 'SELECTOR_NOT_FOUND')
})
