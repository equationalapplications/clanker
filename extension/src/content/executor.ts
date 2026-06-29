import type { SingleAction } from '../shared/dsl-types.js'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'
import { classifyElement } from './safety-classifier.js'

export interface ActionOutcome { data: Record<string, string>; activeUrl: string }
export type ActionResult = ActionOutcome | { awaitingAuth: true }

interface WinLike { scrollBy(x: number, y: number): void; location: { href: string } }

export interface RunActionContext {
  skipLayerTwo?: boolean
}

export async function runAction(
  action: SingleAction,
  doc: Document,
  win: WinLike,
  ctx: RunActionContext = {},
): Promise<ActionResult> {
  const activeUrl = win.location.href
  switch (action.type) {
    case 'extract':
      return { data: extract(doc, action.selector, action.label ?? 'value'), activeUrl }
    case 'read_dom':
      return { data: { read_dom: readDom(doc, action.selector) }, activeUrl }
    case 'summarize_visible_text':
      return { data: { summary: summarizeVisibleText(doc, action.filter ?? 'all') }, activeUrl }
    case 'scroll': {
      const delta = (action.pixels ?? 600) * (action.direction === 'up' ? -1 : 1)
      win.scrollBy(0, delta)
      return { data: {}, activeUrl }
    }
    case 'open_tab':
    case 'focus_tab':
      throw new Error('EXECUTION_ERROR: tab actions are handled by the service worker')
    case 'fill_field': {
      const el = doc.querySelector(action.selector)
      if (!el) throw new Error('SELECTOR_NOT_FOUND')
      if (!ctx.skipLayerTwo && classifyElement(el) === 'requires_auth') return { awaitingAuth: true }
      ;(el as HTMLInputElement).value = action.value
      const EventCtor = (el.ownerDocument?.defaultView ?? globalThis).Event
      el.dispatchEvent(new EventCtor('input', { bubbles: true }))
      el.dispatchEvent(new EventCtor('change', { bubbles: true }))
      return { data: {}, activeUrl }
    }
    case 'click': {
      const el = doc.querySelector(action.selector)
      if (!el) throw new Error('SELECTOR_NOT_FOUND')
      if (!ctx.skipLayerTwo && classifyElement(el) === 'requires_auth') return { awaitingAuth: true }
      ;(el as HTMLElement).click()
      return { data: {}, activeUrl }
    }
    default:
      throw new Error('EXECUTION_ERROR: unknown action')
  }
}

export async function runActionInPage(action: SingleAction, ctx: RunActionContext = {}): Promise<ActionResult> {
  return runAction(action, document, window as unknown as WinLike, ctx)
}
