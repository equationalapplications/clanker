import { createElement } from 'react'
import { View, StyleSheet } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { VIDEO } from '~/config/landingConfig'

const IFRAME_STYLE = {
  width: '100%',
  height: '100%',
  border: 'none',
} as const

export default function VideoSection() {
  const { colors } = useTheme()
  const embedUrl = `https://www.youtube.com/embed/${VIDEO.youtubeId}`

  return (
    <View style={styles.section}>
      <Text
        variant="headlineMedium"
        style={[styles.heading, { color: colors.onSurface }]}
        accessibilityRole="header"
        nativeID="video-heading"
      >
        {VIDEO.heading}
      </Text>
      <View style={styles.frame}>
        {createElement('iframe', {
          title: VIDEO.iframeTitle,
          src: embedUrl,
          allow:
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          allowFullScreen: true,
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
          style: IFRAME_STYLE,
          'aria-label': VIDEO.iframeTitle,
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
  },
  heading: {
    textAlign: 'center',
    marginBottom: 24,
    fontWeight: '700',
  },
  frame: {
    width: '100%',
    maxWidth: 800,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
})
