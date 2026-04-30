import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform } from 'react-native'
import { useTheme } from 'react-native-paper'
import HeroSection from './HeroSection'
import FeaturesSection from './FeaturesSection'
import LandingFooter from './LandingFooter'

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
          href="#main-content"
          onFocus={() => setSkipFocused(true)}
          onBlur={() => setSkipFocused(false)}
          onClick={(e) => {
            const target = document.getElementById('main-content')
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
        nativeID="main-content"
        tabIndex={-1}
      >
        <HeroSection />
        <FeaturesSection />
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
