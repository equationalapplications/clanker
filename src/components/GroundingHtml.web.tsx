import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native'

interface GroundingHtmlProps {
  /** Gemini's searchEntryPoint.renderedContent — the Google Search Suggestions HTML. */
  html: string
  style?: StyleProp<ViewStyle>
}

/**
 * Web renderer for the grounding "Search Suggestions" HTML. react-native-webview
 * has no web implementation, so we render the HTML in a sandboxed <iframe>:
 *   - no `allow-scripts` → scripts in the HTML never execute (matches the native
 *     WebView's javaScriptEnabled={false}).
 *   - `allow-popups` + `allow-popups-to-escape-sandbox` + an injected
 *     `<base target="_blank">` so source links open as normal top-level pages
 *     in a new tab instead of navigating inside the sandbox.
 *
 * The content itself is shown verbatim as required by the Google Search grounding
 * Terms of Use; only link target behavior is adjusted.
 */
export function GroundingHtml({ html, style }: GroundingHtmlProps) {
  const srcDoc = `<base target="_blank">${html}`
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
