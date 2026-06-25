/** @jest-environment jsdom */

import {
  applyHorizontalWheelToScrollport,
  formatGroundingShadowHtml,
  getHorizontalWheelDelta,
  GROUNDING_SHADOW_HOST_CSS,
  measureShadowContentHeight,
  measureShadowLayout,
  mountGroundingShadowContent,
  sanitizeGroundingHtmlLinks,
} from '../groundingShadowContent'

describe('sanitizeGroundingHtmlLinks', () => {
  it('strips scripts and unsafe hrefs while preserving body markup', () => {
    const { headMarkup, bodyHtml } = sanitizeGroundingHtmlLinks(
      '<style>.chip{color:red}</style><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>',
    )

    expect(headMarkup).toContain('.chip')
    expect(bodyHtml).not.toContain('<script')
    expect(bodyHtml).toContain('<a>bad</a>')
    expect(bodyHtml).toContain('good</a>')
  })

  it('removes embed-capable elements and external stylesheet links', () => {
    const { headMarkup, bodyHtml } = sanitizeGroundingHtmlLinks(
      '<link rel="stylesheet" href="https://evil.example/style.css"><style>.row{}</style><iframe src="https://evil.example"></iframe><div class="row">Suggestion</div>',
    )

    expect(headMarkup).toContain('.row')
    expect(headMarkup).not.toContain('<link')
    expect(bodyHtml).not.toContain('<iframe')
    expect(bodyHtml).toContain('Suggestion</div>')
  })
})

describe('formatGroundingShadowHtml', () => {
  it('concatenates head styles and body markup', () => {
    const formatted = formatGroundingShadowHtml(
      '<style>.row{display:flex}</style><div class="row">Suggestion</div>',
    )

    expect(formatted).toContain('.row{display:flex}')
    expect(formatted).toContain('Suggestion</div>')
  })
})

describe('mountGroundingShadowContent', () => {
  it('attaches sanitized html and host layout styles to a shadow root', () => {
    const host = document.createElement('div')
    mountGroundingShadowContent(
      host,
      '<style>.widget{}</style><div class="widget">Hi</div>',
    )

    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot?.innerHTML).toContain('class="widget"')
    expect(host.shadowRoot?.innerHTML).not.toContain('<script')
    expect(host.shadowRoot?.innerHTML).toContain(GROUNDING_SHADOW_HOST_CSS.trim())
  })
})

describe('measureShadowContentHeight', () => {
  it('returns zero when layout metrics are unavailable', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<div>widget</div>'

    expect(measureShadowContentHeight(shadow)).toBe(0)
  })
})

describe('measureShadowLayout', () => {
  it('measures width while the host is temporarily expanded', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = mountGroundingShadowContent(
      host,
      '<div id="widget" style="width:320px;height:40px">Suggestion</div>',
    )
    const widget = shadow.querySelector('#widget')
    if (widget instanceof HTMLElement) {
      Object.defineProperty(widget, 'scrollWidth', { configurable: true, value: 320 })
      Object.defineProperty(widget, 'offsetWidth', { configurable: true, value: 320 })
      widget.getBoundingClientRect = () =>
        ({ width: 320, height: 40, right: 320, left: 0, top: 0, bottom: 40 } as DOMRect)
    }
    Object.defineProperty(host, 'scrollWidth', { configurable: true, value: 320 })
    Object.defineProperty(host, 'offsetWidth', { configurable: true, value: 320 })

    const metrics = measureShadowLayout(host, shadow)
    expect(host.style.width).toBe('')
    expect(metrics.contentWidth).toBeGreaterThanOrEqual(320)
    host.remove()
  })
})

describe('getHorizontalWheelDelta', () => {
  it('prefers deltaX when horizontal motion dominates', () => {
    expect(getHorizontalWheelDelta({ deltaX: 12, deltaY: 2, shiftKey: false })).toBe(12)
  })

  it('maps shift+vertical wheel to horizontal scroll', () => {
    expect(getHorizontalWheelDelta({ deltaX: 0, deltaY: 8, shiftKey: true })).toBe(8)
  })
})

describe('applyHorizontalWheelToScrollport', () => {
  it('scrolls the scrollport when content overflows horizontally', () => {
    const scrollEl = document.createElement('div')
    Object.defineProperty(scrollEl, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 200 })
    scrollEl.scrollLeft = 0

    const scrolled = applyHorizontalWheelToScrollport(
      { deltaX: 10, deltaY: 0, shiftKey: false },
      scrollEl,
    )

    expect(scrolled).toBe(true)
    expect(scrollEl.scrollLeft).toBe(10)
  })

  it('returns false when the scrollport is already at the horizontal edge', () => {
    const scrollEl = document.createElement('div')
    Object.defineProperty(scrollEl, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 200 })
    scrollEl.scrollLeft = 200

    const scrolled = applyHorizontalWheelToScrollport(
      { deltaX: 10, deltaY: 0, shiftKey: false },
      scrollEl,
    )

    expect(scrolled).toBe(false)
    expect(scrollEl.scrollLeft).toBe(200)
  })
})
