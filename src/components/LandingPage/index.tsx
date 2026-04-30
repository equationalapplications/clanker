import React from 'react'
import { ScrollView, StyleSheet, View, Platform, Text } from 'react-native'
import { useTheme } from 'react-native-paper'
import HeroSection from './HeroSection'
import FeaturesSection from './FeaturesSection'
import LandingFooter from './LandingFooter'

export default function LandingPage() {
  const { colors } = useTheme()

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {Platform.OS === 'web' && (
        <View
          style={styles.skipLink}
          // @ts-ignore – web-only focusStyle is applied via StyleSheet for keyboard nav
          accessibilityRole="link"
          accessibilityLabel="Skip to main content"
        >
          <Text style={styles.skipLinkText}>Skip to main content</Text>
        </View>
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
  skipLink: {
    position: 'absolute',
    top: -1000,
    left: 0,
  },
  skipLinkText: {
    fontSize: 14,
  },
})
