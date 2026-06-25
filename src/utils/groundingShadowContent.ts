import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

export const GROUNDING_WIDGET_MIN_HEIGHT = 48
export const GROUNDING_WIDGET_MAX_HEIGHT = 160
/** Small buffer so subpixel rounding does not clip the widget row. */
export const GROUNDING_HEIGHT_BUFFER = 2
/** Wide probe width so percentage-based widget CSS can expand before we measure. */
export const GROUNDING_WIDTH_MEASURE_PX = 4096

/** Shadow-host layout — width comes from the outer sizer; height follows content. */
export const GROUNDING_SHADOW_HOST_CSS = `
:host {
  display: block;
  width: 100%;
  overflow: hidden;
  line-height: 0;
}
:host > :not(style) {
  line-height: normal;
}
`

/** Tags expected in Google's Search Suggestions widget HTML. */
const GROUNDING_ALLOWED_BODY_TAGS = new Set([
  'a',
  'b',
  'br',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'path',
  'polygon',
  'polyline',
  'rect',
  'span',
  'strong',
  'svg',
  'ul',
])

const GROUNDING_GLOBAL_ALLOWED_ATTRS = new Set([
  'class',
  'dir',
  'id',
  'lang',
  'role',
  'style',
  'title',
])

const GROUNDING_TAG_ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'rel', 'target']),
  img: new Set(['alt', 'decoding', 'height', 'loading', 'src', 'width']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width']),
  svg: new Set(['fill', 'height', 'viewbox', 'width', 'xmlns']),
}

/** Disallowed tags whose contents must not be preserved when removed. */
const GROUNDING_REMOVE_ENTIRELY_TAGS = new Set(['script', 'style'])

const GROUNDING_URL_ATTRS = new Set(['href', 'src'])

function isAllowedGroundingAttribute(tagName: string, attributeName: string): boolean {
  const lowerName = attributeName.toLowerCase()
  if (lowerName.startsWith('on') || lowerName.startsWith('data-') || lowerName.startsWith('aria-')) {
    return lowerName.startsWith('aria-') || lowerName.startsWith('data-')
  }
  if (GROUNDING_GLOBAL_ALLOWED_ATTRS.has(lowerName)) {
    return true
  }
  return GROUNDING_TAG_ALLOWED_ATTRS[tagName]?.has(lowerName) ?? false
}

function sanitizeGroundingUrlAttribute(element: Element, attributeName: string): void {
  const value = element.getAttribute(attributeName)
  if (!value || !isSafeHttpUrl(value)) {
    element.removeAttribute(attributeName)
    return
  }
  if (element.tagName.toLowerCase() === 'a') {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer')
  }
}

function unwrapDisallowedElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    element.remove()
    return
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function sanitizeGroundingElementTree(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tagName = element.tagName.toLowerCase()
    if (!GROUNDING_ALLOWED_BODY_TAGS.has(tagName)) {
      if (GROUNDING_REMOVE_ENTIRELY_TAGS.has(tagName)) {
        element.remove()
      } else {
        unwrapDisallowedElement(element)
      }
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      if (!isAllowedGroundingAttribute(tagName, attributeName)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (GROUNDING_URL_ATTRS.has(attributeName)) {
        sanitizeGroundingUrlAttribute(element, attribute.name)
      }
    }
  }
}

/** Allowlist sanitizer for Google widget HTML before shadow-root injection. */
export function sanitizeGroundingHtmlLinks(html: string): { headMarkup: string; bodyHtml: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  sanitizeGroundingElementTree(doc.body)
  const headMarkup = Array.from(doc.head.querySelectorAll('style'))
    .map((el) => el.outerHTML)
    .join('')
  return { headMarkup, bodyHtml: doc.body.innerHTML }
}

/** Sanitized snippet for shadow-root injection (Google's recommended embed path). */
export function formatGroundingShadowHtml(html: string): string {
  const { headMarkup, bodyHtml } = sanitizeGroundingHtmlLinks(html)
  return headMarkup + bodyHtml
}

/** Mount Google's Search Suggestions widget into an open shadow root on `host`. */
export function mountGroundingShadowContent(host: HTMLElement, html: string): ShadowRoot {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  shadow.innerHTML = formatGroundingShadowHtml(html)

  if (!shadow.querySelector('[data-grounding-host-layout="true"]')) {
    const layoutStyle = document.createElement('style')
    layoutStyle.setAttribute('data-grounding-host-layout', 'true')
    layoutStyle.textContent = GROUNDING_SHADOW_HOST_CSS
    shadow.appendChild(layoutStyle)
  }

  return shadow
}

/** Fit the host height to the visible widget row (ignores the host's own fixed height). */
export function measureShadowContentHeight(shadow: ShadowRoot): number {
  const host = shadow.host
  if (!(host instanceof HTMLElement)) {
    return 0
  }

  const hostTop = host.getBoundingClientRect().top
  let maxBottom = 0

  for (const child of Array.from(shadow.children)) {
    if (child instanceof HTMLElement && child.tagName !== 'STYLE') {
      const style = shadow.ownerDocument?.defaultView?.getComputedStyle(child)
      const marginBottom = Number.parseFloat(style?.marginBottom ?? '0') || 0
      const rect = child.getBoundingClientRect()
      if (rect.height > 0 || rect.width > 0) {
        maxBottom = Math.max(maxBottom, rect.bottom - hostTop + marginBottom)
      }
    }
  }

  if (maxBottom <= 0) {
    return 0
  }

  const measured = Math.ceil(maxBottom) + GROUNDING_HEIGHT_BUFFER
  return Math.min(measured, GROUNDING_WIDGET_MAX_HEIGHT)
}

/** Natural content width at probe width so the outer scrollport can pan when chips overflow. */
export function measureShadowContentWidth(shadow: ShadowRoot, host: HTMLElement): number {
  const hostLeft = host.getBoundingClientRect().left
  let max = 0

  for (const child of Array.from(shadow.children)) {
    if (child instanceof HTMLElement && child.tagName !== 'STYLE') {
      const rect = child.getBoundingClientRect()
      max = Math.max(
        max,
        child.scrollWidth,
        child.offsetWidth,
        rect.width,
        rect.right - hostLeft,
      )
    }
  }

  for (const element of Array.from(shadow.querySelectorAll('*'))) {
    if (element instanceof HTMLElement) {
      const rect = element.getBoundingClientRect()
      max = Math.max(max, rect.right - hostLeft, element.scrollWidth, element.offsetWidth)
    }
  }

  return Math.ceil(max)
}

export interface GroundingLayoutMetrics {
  height: number
  contentWidth: number
}

/** Measure width at probe width; height at the host's natural width. */
export function measureShadowLayout(host: HTMLElement, shadow: ShadowRoot): GroundingLayoutMetrics {
  const previousWidth = host.style.width
  host.style.width = `${GROUNDING_WIDTH_MEASURE_PX}px`
  void host.offsetWidth

  const contentWidth = measureShadowContentWidth(shadow, host)

  host.style.width = previousWidth
  void host.offsetWidth

  return {
    height: measureShadowContentHeight(shadow),
    contentWidth,
  }
}

/** Map trackpad / mouse wheel motion to horizontal scroll delta. */
export function getHorizontalWheelDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'shiftKey'>): number {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    return event.deltaX
  }
  if (event.shiftKey && event.deltaY !== 0) {
    return event.deltaY
  }
  return 0
}

/** Stop GiftedChat bubble press handlers from swallowing scroll gestures on web. */
export function stopBubbleScrollCapture(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

/** Forward horizontal wheel deltas to the scrollport (works when pointer is over shadow content). */
export function applyHorizontalWheelToScrollport(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'shiftKey'>,
  scrollEl: HTMLElement,
): boolean {
  const delta = getHorizontalWheelDelta(event)
  if (delta === 0 || scrollEl.scrollWidth <= scrollEl.clientWidth) {
    return false
  }
  const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth
  const nextScrollLeft = Math.min(Math.max(scrollEl.scrollLeft + delta, 0), maxScrollLeft)
  if (nextScrollLeft === scrollEl.scrollLeft) {
    return false
  }
  scrollEl.scrollLeft = nextScrollLeft
  return true
}
