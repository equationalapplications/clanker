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
        <Text
          accessibilityRole="link"
          style={styles.skipLink}
          // @ts-ignore — web-only href prop
          href="#main-content"
        >
          Skip to main content
        </Text>
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
    top: -9999,
    left: 0,
  },
})
