import { useMemo, useState } from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'
import { sanitizeGroundingHtmlForNative } from '~/utils/sanitizeGroundingHtml'

interface GroundingHtmlProps {
  /** Gemini's searchEntryPoint.renderedContent — the Google Search Suggestions HTML. */
  html: string
  style?: StyleProp<ViewStyle>
}

const DEFAULT_MIN_HEIGHT = 48
const MAX_HEIGHT = 160

/**
 * Measure the rendered widget height so the WebView can size to its content.
 * Snippet scripts/event handlers are stripped before load; only this injected
 * script runs in the WebView.
 */
const MEASURE_HEIGHT_SCRIPT = `
(function() {
  function measure() {
    var height = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    );
    if (height > 0 && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(String(height));
    }
  }
  measure();
  window.addEventListener('load', measure);
  setTimeout(measure, 100);
})();
true;
`

/** Wrap the sanitized API snippet in a minimal document shell. */
function wrapGroundingHtmlSnippet(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;}</style>
</head>
<body>${html}</body>
</html>`
}

interface GroundingHtmlWebViewProps {
  html: string
  minHeight: number
  containerStyle: ViewStyle
}

function GroundingHtmlWebView({ html, minHeight, containerStyle }: GroundingHtmlWebViewProps) {
  const [height, setHeight] = useState(minHeight)
  const wrappedHtml = useMemo(
    () => wrapGroundingHtmlSnippet(sanitizeGroundingHtmlForNative(html)),
    [html],
  )

  return (
    <View
      style={[
        containerStyle,
        { overflow: 'hidden', height, width: '100%', flex: 0, flexGrow: 0 },
      ]}
      collapsable={false}
    >
      <WebView
        originWhitelist={['about:blank', 'http://*', 'https://*']}
        source={{ html: wrappedHtml }}
        style={{ flex: 0, height, width: '100%', opacity: 0.99, backgroundColor: 'transparent' }}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        injectedJavaScript={MEASURE_HEIGHT_SCRIPT}
        onMessage={(event) => {
          const measured = Number.parseInt(event.nativeEvent.data, 10)
          if (Number.isFinite(measured) && measured > 0) {
            setHeight(Math.min(Math.max(measured, minHeight), MAX_HEIGHT))
          }
        }}
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
    </View>
  )
}

/**
 * Native renderer for the grounding "Search Suggestions" HTML. Link taps are
 * intercepted and opened in the system browser rather than navigating inside
 * the WebView.
 *
 * WebViews inside inverted FlatLists are prone to painting over sibling rows on
 * native. The clipped wrapper, fixed flex, opacity workaround, and
 * removeClippedSubviews={false} on GiftedChat (see ChatView) keep the widget
 * contained within its message bubble.
 *
 * The web build resolves to GroundingHtml.web.tsx (react-native-webview has no
 * web support) which renders the same HTML in a sandboxed <iframe>.
 */
export function GroundingHtml({ html, style }: GroundingHtmlProps) {
  const flattened = StyleSheet.flatten(style) ?? {}
  const minHeight =
    typeof flattened.height === 'number'
      ? flattened.height
      : typeof flattened.minHeight === 'number'
        ? flattened.minHeight
        : DEFAULT_MIN_HEIGHT

  const { height: _fixedHeight, minHeight: _minHeight, ...containerStyle } = flattened

  return (
    <GroundingHtmlWebView
      key={html}
      html={html}
      minHeight={minHeight}
      containerStyle={containerStyle}
    />
  )
}
