import type { StyleProp, ViewStyle } from 'react-native'

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
 *   - `allow-popups` + an injected `<base target="_blank">` so source links open
 *     in a new tab instead of trying (and failing) to navigate inside the sandbox.
 *
 * The content itself is shown verbatim as required by the Google Search grounding
 * Terms of Use; only link target behavior is adjusted.
 */
export function GroundingHtml({ html }: GroundingHtmlProps) {
  const srcDoc = `<base target="_blank" rel="noopener noreferrer">${html}`
  return (
    <iframe
      title="Search sources"
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ border: 0, width: '100%', height: 44, backgroundColor: 'transparent' }}
    />
  )
}
