import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'

function doc(html: string) { return new JSDOM(html).window.document }

test('extract returns matched text keyed by label', () => {
  const d = doc('<div class="price">$42.99</div>')
  assert.deepEqual(extract(d, '.price', 'price'), { price: '$42.99' })
})

test('extract throws SELECTOR_NOT_FOUND when missing', () => {
  const d = doc('<div></div>')
  assert.throws(() => extract(d, '.nope', 'x'), /SELECTOR_NOT_FOUND/)
})

test('readDom returns innerHTML of the selector', () => {
  const d = doc('<section id="s"><b>hi</b></section>')
  assert.match(readDom(d, '#s'), /<b>hi<\/b>/)
})

test('summarizeVisibleText drops nav when filter=no_nav', () => {
  const d = doc('<nav>MENU</nav><article>Body text here.</article>')
  const out = summarizeVisibleText(d, 'no_nav')
  assert.match(out, /Body text here/)
  assert.doesNotMatch(out, /MENU/)
})
