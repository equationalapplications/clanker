import test from 'node:test'
import assert from 'node:assert/strict'
import { findBlockedNavigation, isBlockedUrl } from './hostPolicy.js'

test('isBlockedUrl rejects chrome and file schemes', () => {
  assert.equal(isBlockedUrl('chrome://settings').blocked, true)
  assert.equal(isBlockedUrl('file:///etc/passwd').blocked, true)
  assert.equal(isBlockedUrl('javascript:alert(1)').blocked, true)
})

test('isBlockedUrl allows http and https', () => {
  assert.equal(isBlockedUrl('https://example.com/path').blocked, false)
  assert.equal(isBlockedUrl('http://localhost:3000').blocked, false)
})

test('findBlockedNavigation catches open_tab in a sequence', () => {
  const hit = findBlockedNavigation({
    type: 'sequence',
    steps: [
      { type: 'read_dom', selector: 'body' },
      { type: 'open_tab', url: 'chrome://extensions' },
    ],
  })
  assert.ok(hit)
  assert.match(hit!.message, /not allowed/i)
})

test('findBlockedNavigation ignores non-navigation actions', () => {
  assert.equal(findBlockedNavigation({ type: 'extract', selector: '.p', label: 'x' }), null)
})
