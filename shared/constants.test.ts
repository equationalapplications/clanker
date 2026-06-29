// shared/constants.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { DESTRUCTIVE_ACTION_PATTERN, classifyActionLabel, intentRequiresAuth } from './constants.js'

test('pattern matches destructive verbs case-insensitively', () => {
  for (const s of ['Submit Payment', 'DELETE account', 'pay now', 'Confirm order', 'Cancel subscription']) {
    assert.equal(DESTRUCTIVE_ACTION_PATTERN.test(s), true, s)
  }
})

test('pattern ignores benign labels', () => {
  for (const s of ['Read more', 'Show details', 'Next page', 'order_total']) {
    assert.equal(DESTRUCTIVE_ACTION_PATTERN.test(s), false, s)
  }
})

test('classifyActionLabel returns requires_auth for destructive text', () => {
  assert.equal(classifyActionLabel('Submit Payment'), 'requires_auth')
  assert.equal(classifyActionLabel('Read article'), 'safe')
  assert.equal(classifyActionLabel(undefined), 'safe')
})

test('intentRequiresAuth checks actionSummary', () => {
  assert.equal(intentRequiresAuth('Submit payment on checkout', { type: 'read_dom', selector: 'body' }), true)
  assert.equal(intentRequiresAuth('Read article', { type: 'read_dom', selector: 'body' }), false)
})

test('intentRequiresAuth checks step labels and selectors', () => {
  assert.equal(
    intentRequiresAuth('Open page', { type: 'click', selector: '#buy', label: 'Submit order', tier: 'stateful' }),
    true,
  )
  assert.equal(
    intentRequiresAuth('Extract total', { type: 'extract', selector: '.checkout-submit', label: 'total' }),
    true,
  )
  assert.equal(
    intentRequiresAuth('Extract total', { type: 'extract', selector: '.order-total', label: 'total' }),
    false,
  )
})
