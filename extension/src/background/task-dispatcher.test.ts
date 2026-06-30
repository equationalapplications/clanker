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
  assert.deepEqual((res as TaskResult).data, { total: '$9', summary: 'hi' })
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

import type { TaskIntent, TaskResult } from '../shared/dsl-types.js'

const baseIntent: TaskIntent = {
  version: '1', taskId: 't1', sessionId: 's1',
  requiresAuth: true, actionSummary: 'Submit',
  action: { type: 'sequence', steps: [
    { type: 'extract', selector: '.price', label: 'price' },
    { type: 'click', selector: '#buy', label: 'Buy', tier: 'stateful' },
  ] },
}

test('dispatchTask halts with awaiting_auth when step returns awaitingAuth', async () => {
  let stepIdx = 0
  const inj = {
    runInActiveTab: async () => {
      if (stepIdx++ === 1) return { awaitingAuth: true as const }
      return { data: { price: '$10' }, activeUrl: 'https://x.com' }
    },
    openTab: async () => {},
    focusTab: async () => {},
  } as never

  const outcome = await dispatchTask(baseIntent, inj)
  assert.equal(outcome.status, 'awaiting_auth')
  assert.equal((outcome as { haltedStepIndex: number }).haltedStepIndex, 1)
  assert.deepEqual((outcome as { partialData: Record<string, string> }).partialData, { price: '$10' })
})

test('dispatchTask completes when no step requires auth', async () => {
  const inj = {
    runInActiveTab: async () => ({ data: { price: '$10' }, activeUrl: 'https://x.com' }),
    openTab: async () => {},
    focusTab: async () => {},
  } as never

  const intent: TaskIntent = { ...baseIntent, requiresAuth: false, action: { type: 'extract', selector: '.p', label: 'p' } }
  const outcome = await dispatchTask(intent, inj)
  assert.equal(outcome.status, 'complete')
})
