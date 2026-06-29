import type { SingleAction } from '../shared/dsl-types.js'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'

export interface ActionOutcome { data: Record<string, string>; activeUrl: string }

interface WinLike { scrollBy(x: number, y: number): void; location: { href: string } }

export async function runAction(action: SingleAction, doc: Document, win: WinLike): Promise<ActionOutcome> {
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
    case 'fill_field':
    case 'click':
      throw new Error('EXECUTION_ERROR: stateful actions are not enabled in Phase 1')
    default:
      throw new Error('EXECUTION_ERROR: unknown action')
  }
}

export async function runActionInPage(action: SingleAction): Promise<ActionOutcome> {
  return runAction(action, document, window as unknown as WinLike)
}
