// shared/dsl-schema.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { taskIntentSchema, validateTaskIntent, actionTier } from './dsl-schema.js'

const validReadOnly = {
  version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false,
  actionSummary: 'Summarize', action: { type: 'summarize_visible_text', filter: 'no_nav' },
}

test('accepts a valid read-only intent', () => {
  assert.equal(taskIntentSchema.safeParse(validReadOnly).success, true)
})

test('rejects unknown action type', () => {
  const bad = { ...validReadOnly, action: { type: 'wipe_disk' } }
  assert.equal(taskIntentSchema.safeParse(bad).success, false)
})

test('rejects nested sequences', () => {
  const bad = {
    ...validReadOnly,
    action: { type: 'sequence', steps: [{ type: 'sequence', steps: [] }] },
  }
  assert.equal(taskIntentSchema.safeParse(bad).success, false)
})

test('validateTaskIntent returns typed value or throws', () => {
  assert.equal(validateTaskIntent(validReadOnly).taskId, 't1')
  assert.throws(() => validateTaskIntent({ version: '1' }))
})

test('actionTier classifies primitives', () => {
  assert.equal(actionTier({ type: 'extract', selector: '.x' }), 'read_only')
  assert.equal(actionTier({ type: 'open_tab', url: 'https://a.com' }), 'navigation')
  assert.equal(actionTier({ type: 'click', selector: '#b', tier: 'stateful' }), 'stateful')
})
