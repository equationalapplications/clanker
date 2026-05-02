import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform } from 'react-native'
import { useTheme } from 'react-native-paper'
import HeroSection from './HeroSection'
import FeaturesSection from './FeaturesSection'
import ComingSoonSection from './ComingSoonSection'
import LandingFooter from './LandingFooter'

const MAIN_CONTENT_ID = 'main-content'

const SKIP_LINK_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  top: '-9999px',
  left: 0,
}

const SKIP_LINK_VISIBLE: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 9999,
  padding: '8px 16px',
  background: '#fff',
  color: '#000',
  fontWeight: 'bold',
  textDecoration: 'none',
  borderRadius: '4px',
}

export default function LandingPage() {
  const { colors } = useTheme()
  const [skipFocused, setSkipFocused] = useState(false)

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {Platform.OS === 'web' && (
        <a
          href={`#${MAIN_CONTENT_ID}`}
          onFocus={() => setSkipFocused(true)}
          onBlur={() => setSkipFocused(false)}
          onClick={(e) => {
            const target = document.getElementById(MAIN_CONTENT_ID)
            if (target) {
              e.preventDefault()
              target.focus()
            }
          }}
          style={skipFocused ? SKIP_LINK_VISIBLE : SKIP_LINK_HIDDEN}
        >
          Skip to main content
        </a>
      )}
      <View
        nativeID={MAIN_CONTENT_ID}
        tabIndex={-1}
      >
        <HeroSection />
        <FeaturesSection />
        <ComingSoonSection />
        <LandingFooter />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
})
