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

/** Strip executable markup and non-http(s) hrefs before rendering. */
export function sanitizeGroundingHtmlLinks(html: string): { headMarkup: string; bodyHtml: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    script.remove()
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href')
    if (!href || !isSafeHttpUrl(href)) {
      anchor.removeAttribute('href')
    } else {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }
  const headMarkup = Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
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
  scrollEl.scrollLeft += delta
  return true
}
