import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform } from 'react-native'
import { useTheme } from 'react-native-paper'
import HeroSection from './HeroSection'
import FeaturesSection from './FeaturesSection'
import LandingFooter from './LandingFooter'

const skipLinkHidden: Record<string, unknown> = {
  position: 'absolute',
  top: -9999,
  left: 0,
}

const skipLinkVisible: Record<string, unknown> = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 9999,
  padding: '8px 16px',
  background: '#fff',
  color: '#000',
  fontWeight: 'bold',
  textDecoration: 'none',
  borderRadius: 4,
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
          style={skipFocused ? skipLinkVisible : skipLinkHidden}
        >
          Skip to main content
        </a>
      )}
      <View nativeID="main-content">
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
