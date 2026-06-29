import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { classifyElement } from './safety-classifier.js'

function el(html: string) { return new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild! }

test('destructive button text → requires_auth', () => {
  assert.equal(classifyElement(el('<button>Submit Payment</button>')), 'requires_auth')
})

test('benign link → safe', () => {
  assert.equal(classifyElement(el('<a>Read more</a>')), 'safe')
})

test('submit input inside a form → requires_auth', () => {
  const form = new JSDOM('<form><input type="submit" value="Go"></form>').window.document.querySelector('input')!
  assert.equal(classifyElement(form), 'requires_auth')
})

test('button-type input with destructive value → requires_auth', () => {
  assert.equal(classifyElement(el('<input type="button" value="Delete account" />')), 'requires_auth')
})

test('input with destructive aria-label → requires_auth', () => {
  assert.equal(classifyElement(el('<button aria-label="submit payment">Go</button>')), 'requires_auth')
})
