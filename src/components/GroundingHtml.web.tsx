import { useMemo } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface GroundingHtmlProps {
  /** Gemini's searchEntryPoint.renderedContent — the Google Search Suggestions HTML. */
  html: string
  style?: StyleProp<ViewStyle>
}

/** Strip non-http(s) hrefs so only safe citation links can navigate (matches native). */
function sanitizeGroundingHtmlLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href')
    if (!href || !isSafeHttpUrl(href)) {
      anchor.removeAttribute('href')
    } else {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }
  return doc.body.innerHTML
}

/**
 * Web renderer for the grounding "Search Suggestions" HTML. react-native-webview
 * has no web implementation, so we render the HTML in a sandboxed <iframe>:
 *   - no `allow-scripts` → scripts in the HTML never execute (matches the native
 *     WebView's javaScriptEnabled={false}).
 *   - `allow-popups` + `allow-popups-to-escape-sandbox` + an injected
 *     `<base target="_blank">` so source links open as normal top-level pages
 *     in a new tab instead of navigating inside the sandbox.
 *   - unsafe hrefs are stripped before injection (mirrors native isSafeHttpUrl).
 *
 * The content itself is shown verbatim as required by the Google Search grounding
 * Terms of Use; only link target behavior and href allowlisting are adjusted.
 */
export function GroundingHtml({ html, style }: GroundingHtmlProps) {
  const srcDoc = useMemo(
    () => `<base target="_blank">${sanitizeGroundingHtmlLinks(html)}`,
    [html],
  )
  const flattenedStyle = StyleSheet.flatten(style) as React.CSSProperties
  return (
    <iframe
      title="Search sources"
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ border: 0, width: '100%', backgroundColor: 'transparent', ...flattenedStyle }}
    />
  )
}
