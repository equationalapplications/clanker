export function extract(doc: Document, selector: string, label = 'value'): Record<string, string> {
  const el = doc.querySelector(selector)
  if (!el) throw new Error('SELECTOR_NOT_FOUND')
  return { [label]: (el.textContent ?? '').trim() }
}

export function readDom(doc: Document, selector: string): string {
  const el = doc.querySelector(selector)
  if (!el) throw new Error('SELECTOR_NOT_FOUND')
  return el.innerHTML
}

export function summarizeVisibleText(doc: Document, filter: 'no_nav' | 'no_ads' | 'all' = 'all'): string {
  const drop = new Set<string>()
  if (filter === 'no_nav') ['nav', 'header', 'footer', 'aside'].forEach((t) => drop.add(t))
  if (filter === 'no_ads') ['aside', '[role=banner]'].forEach((t) => drop.add(t))
  const clone = doc.body.cloneNode(true) as HTMLElement
  for (const sel of drop) clone.querySelectorAll(sel).forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}
