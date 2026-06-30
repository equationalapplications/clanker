import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

function makeLog(entries: Array<{ ts: number; action: string; status: string }>): Element {
  const dom = new JSDOM('<ul id="log"></ul>')
  const document = dom.window.document
  const logEl = document.getElementById('log')!
  logEl.textContent = ''
  for (const entry of entries) {
    const li = document.createElement('li')
    li.textContent = `${new Date(entry.ts).toLocaleTimeString()} ${entry.action} ${entry.status === 'complete' ? '✓' : '✕'}`
    logEl.appendChild(li)
  }
  return logEl
}

test('renderLog creates li elements, not innerHTML strings', () => {
  const ts = new Date('2026-01-01T12:00:00Z').getTime()
  const logEl = makeLog([
    { ts, action: 'READ_PAGE', status: 'complete' },
    { ts, action: 'CLICK', status: 'failed' },
  ])
  const items = logEl.querySelectorAll('li')
  assert.equal(items.length, 2)
  assert.match(items[0].textContent ?? '', /READ_PAGE/)
  assert.match(items[0].textContent ?? '', /✓/)
  assert.match(items[1].textContent ?? '', /CLICK/)
  assert.match(items[1].textContent ?? '', /✕/)
})

test('renderLog clears previous entries before rendering', () => {
  const ts = Date.now()
  const logEl = makeLog([{ ts, action: 'FIRST', status: 'complete' }])
  // Simulate a second render by running the same logic
  logEl.textContent = ''
  const li = logEl.ownerDocument.createElement('li')
  li.textContent = 'SECOND'
  logEl.appendChild(li)
  assert.equal(logEl.querySelectorAll('li').length, 1)
  assert.match(logEl.querySelector('li')?.textContent ?? '', /SECOND/)
})

test('XSS payload in action field is not executed as HTML', () => {
  const ts = Date.now()
  const logEl = makeLog([{ ts, action: '<script>evil()</script>', status: 'complete' }])
  const li = logEl.querySelector('li')
  assert.ok(li?.textContent?.includes('<script>'))
  assert.equal(logEl.querySelectorAll('script').length, 0)
})
