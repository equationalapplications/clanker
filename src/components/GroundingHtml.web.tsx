import { useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import {
  applyHorizontalWheelToScrollport,
  measureShadowLayout,
  mountGroundingShadowContent,
  stopBubbleScrollCapture,
} from '~/utils/groundingShadowContent'

interface GroundingHtmlProps {
  /** Gemini's searchEntryPoint.renderedContent — the Google Search Suggestions HTML. */
  html: string
  style?: StyleProp<ViewStyle>
}

const LAYOUT_REMEASURE_DELAYS_MS = [0, 100, 400, 800] as const

/**
 * Web renderer for the grounding "Search Suggestions" HTML.
 *
 * Google recommends shadow DOM so widget CSS stays isolated. Content width is
 * measured at probe width, then the widget sits in an explicit-width sizer so
 * the outer scrollport (overflow-x: auto) can pan horizontally. Height follows
 * the widget naturally so there is no empty space below the row.
 */
export function GroundingHtml({ html, style }: GroundingHtmlProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const syncRafRef = useRef<number | null>(null)
  const [contentWidth, setContentWidth] = useState(0)

  const syncLayout = useCallback(() => {
    const host = hostRef.current
    const shadow = host?.shadowRoot
    if (!mountedRef.current || !host || !shadow) {
      return
    }
    setContentWidth(measureShadowLayout(host, shadow).contentWidth)
  }, [])

  const scheduleSync = useCallback(() => {
    syncLayout()
    if (syncRafRef.current !== null) {
      cancelAnimationFrame(syncRafRef.current)
    }
    syncRafRef.current = requestAnimationFrame(() => {
      syncRafRef.current = null
      syncLayout()
    })
  }, [syncLayout])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof host.attachShadow !== 'function') {
      return
    }

    mountedRef.current = true
    const shadow = mountGroundingShadowContent(host, html)
    scheduleSync()

    const timeouts = LAYOUT_REMEASURE_DELAYS_MS.map((delayMs) =>
      window.setTimeout(scheduleSync, delayMs),
    )

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSync) : null
    resizeObserver?.observe(host)

    const onShadowWheel = (event: Event) => {
      if (!(event instanceof WheelEvent)) {
        return
      }
      const scrollEl = scrollRef.current
      if (!scrollEl) {
        return
      }
      if (applyHorizontalWheelToScrollport(event, scrollEl)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    shadow.addEventListener('wheel', onShadowWheel, { capture: true, passive: false })

    return () => {
      mountedRef.current = false
      if (syncRafRef.current !== null) {
        cancelAnimationFrame(syncRafRef.current)
        syncRafRef.current = null
      }
      for (const timeoutId of timeouts) {
        window.clearTimeout(timeoutId)
      }
      resizeObserver?.disconnect()
      shadow.removeEventListener('wheel', onShadowWheel, { capture: true })
      shadow.innerHTML = ''
    }
  }, [html, scheduleSync])

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      if (applyHorizontalWheelToScrollport(event, scrollEl)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    scrollEl.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  const captureBubblePress = useCallback((event: SyntheticEvent) => {
    stopBubbleScrollCapture(event)
  }, [])

  const flattenedStyle = (StyleSheet.flatten(style) ?? {}) as CSSProperties
  const { minHeight: _minHeight, height: _height, ...containerStyle } = flattenedStyle

  const sizerWidth = contentWidth > 0 ? `${contentWidth}px` : '100%'

  return (
    <div
      ref={scrollRef}
      style={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        boxSizing: 'border-box',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-x pan-y',
        ...containerStyle,
      }}
      onMouseDown={captureBubblePress}
    >
      <div
        style={{
          width: sizerWidth,
          minWidth: '100%',
        }}
      >
        <div
          ref={hostRef}
          style={{
            display: 'block',
            width: '100%',
          }}
        />
      </div>
    </div>
  )
}
