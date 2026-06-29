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

test('stateful action fails closed in Phase 1', async () => {
  const c = ctx('<button>Buy</button>')
  await assert.rejects(
    () => runAction({ type: 'click', selector: 'button', tier: 'stateful' }, c.doc, c.win as never),
    /EXECUTION_ERROR/,
  )
})
