import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { renderLogEntries } from './render-log.js'

test('renderLog creates li elements, not innerHTML strings', () => {
  const dom = new JSDOM('<ul id="log"></ul>')
  const logEl = dom.window.document.getElementById('log')!
  const ts = new Date('2026-01-01T12:00:00Z').getTime()
  renderLogEntries(logEl, [
    { ts, action: 'READ_PAGE', status: 'complete' },
    { ts, action: 'CLICK', status: 'failed' },
  ], dom.window.document)
  const items = logEl.querySelectorAll('li')
  assert.equal(items.length, 2)
  assert.match(items[0].textContent ?? '', /READ_PAGE/)
  assert.match(items[0].textContent ?? '', /✓/)
  assert.match(items[1].textContent ?? '', /CLICK/)
  assert.match(items[1].textContent ?? '', /✕/)
})

test('renderLog clears previous entries before rendering', () => {
  const dom = new JSDOM('<ul id="log"><li>stale</li></ul>')
  const logEl = dom.window.document.getElementById('log')!
  const ts = Date.now()
  renderLogEntries(logEl, [{ ts, action: 'SECOND', status: 'complete' }], dom.window.document)
  assert.equal(logEl.querySelectorAll('li').length, 1)
  assert.match(logEl.querySelector('li')?.textContent ?? '', /SECOND/)
})

test('XSS payload in action field is not executed as HTML', () => {
  const dom = new JSDOM('<ul id="log"></ul>')
  const logEl = dom.window.document.getElementById('log')!
  const ts = Date.now()
  renderLogEntries(logEl, [{ ts, action: '<script>evil()</script>', status: 'complete' }], dom.window.document)
  const li = logEl.querySelector('li')
  assert.ok(li?.textContent?.includes('<script>'))
  assert.equal(logEl.querySelectorAll('script').length, 0)
})
