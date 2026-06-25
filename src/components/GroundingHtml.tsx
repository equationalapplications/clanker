import { Linking } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface GroundingHtmlProps {
  /** Gemini's searchEntryPoint.renderedContent — the Google Search Suggestions HTML. */
  html: string
  style?: StyleProp<ViewStyle>
}

/**
 * Native renderer for the grounding "Search Suggestions" HTML. JavaScript stays
 * disabled (the content is static HTML/CSS); link taps are intercepted and opened
 * in the system browser rather than navigating inside the WebView.
 *
 * The web build resolves to GroundingHtml.web.tsx (react-native-webview has no
 * web support) which renders the same HTML in a sandboxed <iframe>.
 */
export function GroundingHtml({ html, style }: GroundingHtmlProps) {
  return (
    <WebView
      originWhitelist={['about:blank', 'http://*', 'https://*']}
      source={{ html }}
      style={style}
      scrollEnabled
      javaScriptEnabled={false}
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === 'about:blank') {
          return true
        }
        if (isSafeHttpUrl(request.url)) {
          void Linking.openURL(request.url).catch((error) => {
            console.warn('Failed to open search suggestion URL', error)
          })
        }
        return false
      }}
    />
  )
}
