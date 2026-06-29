import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { runAction } from './executor.js'

function ctx(html: string) {
  const dom = new JSDOM(html, { url: 'https://example.com/' })
  let scrolled = 0
  return {
    doc: dom.window.document,
    win: { scrollBy: (_x: number, y: number) => { scrolled += y }, location: { href: dom.window.location.href }, get scrolled() { return scrolled } },
  }
}

test('extract action returns data record', async () => {
  const c = ctx('<span class="p">$9</span>')
  const r = await runAction({ type: 'extract', selector: '.p', label: 'price' }, c.doc, c.win as never)
  assert.deepEqual(r.data, { price: '$9' })
})

test('read_dom returns html under read_dom key', async () => {
  const c = ctx('<div id="x"><i>z</i></div>')
  const r = await runAction({ type: 'read_dom', selector: '#x' }, c.doc, c.win as never)
  assert.match(r.data.read_dom, /<i>z<\/i>/)
})

test('scroll down moves the viewport', async () => {
  const c = ctx('<body></body>')
  await runAction({ type: 'scroll', direction: 'down', pixels: 200 }, c.doc, c.win as never)
  assert.equal(c.win.scrolled, 200)
})

function dom(html: string) {
  const d = new JSDOM(html, { url: 'https://test.com' })
  return { doc: d.window.document, win: { scrollBy: () => {}, location: { href: 'https://test.com' } } }
}

test('fill_field sets input value and fires input + change events', async () => {
  const { doc, win } = dom('<input id="username" />')
  const events: string[] = []
  const el = doc.querySelector('#username')!
  el.addEventListener('input', () => events.push('input'))
  el.addEventListener('change', () => events.push('change'))

  const result = await runAction(
    { type: 'fill_field', selector: '#username', value: 'hello', tier: 'stateful' },
    doc, win, { skipLayerTwo: true },
  )

  assert.ok(!('awaitingAuth' in result))
  assert.equal((el as HTMLInputElement).value, 'hello')
  assert.ok(events.includes('input'))
  assert.ok(events.includes('change'))
})

test('click executes click on element', async () => {
  const { doc, win } = dom('<button id="btn">Go</button>')
  let clicked = false
  doc.querySelector('#btn')!.addEventListener('click', () => { clicked = true })

  await runAction(
    { type: 'click', selector: '#btn', tier: 'stateful' },
    doc, win, { skipLayerTwo: true },
  )

  assert.ok(clicked)
})

test('click returns awaitingAuth when classifier flags requires_auth (skipLayerTwo: false)', async () => {
  const { doc, win } = dom('<button id="pay">Submit Payment</button>')
  const result = await runAction(
    { type: 'click', selector: '#pay', tier: 'stateful' },
    doc, win, { skipLayerTwo: false },
  )
  assert.ok('awaitingAuth' in result)
})

test('fill_field on form submit input returns awaitingAuth', async () => {
  const { doc, win } = dom('<form><input id="s" type="submit" value="Pay Now" /></form>')
  const result = await runAction(
    { type: 'fill_field', selector: '#s', value: 'x', tier: 'stateful' },
    doc, win, { skipLayerTwo: false },
  )
  assert.ok('awaitingAuth' in result)
})

test('fill_field throws SELECTOR_NOT_FOUND when element missing', async () => {
  const { doc, win } = dom('<div></div>')
  await assert.rejects(
    () => runAction({ type: 'fill_field', selector: '#missing', value: 'x', tier: 'stateful' }, doc, win, {}),
    /SELECTOR_NOT_FOUND/,
  )
})

test('click throws SELECTOR_NOT_FOUND when element missing', async () => {
  const { doc, win } = dom('<div></div>')
  await assert.rejects(
    () => runAction({ type: 'click', selector: '#missing', tier: 'stateful' }, doc, win, {}),
    /SELECTOR_NOT_FOUND/,
  )
})
