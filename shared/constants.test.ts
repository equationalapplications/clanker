// shared/constants.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { DESTRUCTIVE_ACTION_PATTERN, classifyActionLabel } from './constants.js'

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
