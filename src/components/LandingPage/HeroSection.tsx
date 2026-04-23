import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useEffect } from 'react'
import { Button, useTheme } from 'react-native-paper'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  FadeInDown,
} from 'react-native-reanimated'
import { TitleText, MonoText } from '~/components/StyledText'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'

export default function HeroSection() {
  const { colors } = useTheme()
  const router = useRouter()
  const { height } = useWindowDimensions()
  const authService = useAuthMachine()
  const isSignedIn = useSelector(authService, (s) => s.matches('signedIn'))

  // --- Logo: gentle float + breathe scale ---
  const floatY = useSharedValue(0)
  const logoScale = useSharedValue(0.85)

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 2200 }),
        withTiming(0, { duration: 2200 })
      ),
      -1,
      true
    )
    logoScale.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.97, { duration: 1600 }),
        withTiming(1, { duration: 800 })
      ),
      -1,
      true
    )
  }, [floatY, logoScale])

  const logoAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }, { scale: logoScale.value }],
  }))

  // --- Glow halo: continuous breathing opacity ---
  const glowOpacity = useSharedValue(0.25)

  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1800 }),
        withTiming(0.2, { duration: 2400 })
      ),
      -1,
      true
    )
  }, [glowOpacity])

  // --- Shiver: every 10 s, rapid translateX burst ---
  const shiverX = useSharedValue(0)

  // JS-thread interval is fine — we just write to the shared value
  useEffect(() => {
    const id = setInterval(() => {
      shiverX.value = withSequence(
        withTiming(5, { duration: 55 }),
        withTiming(-5, { duration: 55 }),
        withTiming(4, { duration: 45 }),
        withTiming(-4, { duration: 45 }),
        withTiming(2, { duration: 40 }),
        withTiming(-2, { duration: 40 }),
        withTiming(0, { duration: 55 })
      )
    }, 10000)
    return () => clearInterval(id)
  }, [shiverX])

  // Shared animated style for both title halo wrapper and CTA halo wrapper
  const glowShiverStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shiverX.value }],
    // react-native-web converts these shadow props → CSS box-shadow (fuzzy halo)
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 28,
    shadowOpacity: glowOpacity.value,
  }))

  const handleCTA = () => {
    router.push(isSignedIn ? '/chat' : '/sign-in')
  }

  return (
    <View style={[styles.hero, { minHeight: Math.min(height, 560), backgroundColor: colors.background }]}>
      {/* Top-right sign-in button — no glow, just subtle */}
      <View style={styles.topBar}>
        <Button
          mode="text"
          compact
          textColor={colors.primary}
          onPress={() => router.push(isSignedIn ? '/chat' : '/sign-in')}
          style={styles.signInBtn}
        >
          {isSignedIn ? 'Open App' : 'Sign In'}
        </Button>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        {/* Title with glow halo + shiver */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(600)}
          style={[styles.titleWrap, glowShiverStyle]}
        >
          <TitleText style={[styles.title, { color: colors.primary }]}>Clanker</TitleText>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(600)}>
          <MonoText style={[styles.tagline, { color: colors.onBackground }]}>
            Design, chat with, and share your own AI characters
          </MonoText>
        </Animated.View>

        <Animated.View style={logoAnimStyle}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </Animated.View>

        {/* CTA button with same glow halo + shiver */}
        <Animated.View
          entering={FadeInDown.delay(500).duration(600)}
          style={[styles.ctaWrap, glowShiverStyle]}
        >
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.onPrimary}
            contentStyle={styles.ctaContent}
            labelStyle={styles.ctaLabel}
            onPress={handleCTA}
          >
            {isSignedIn ? 'Open App' : 'Try the App!'}
          </Button>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
  },
  topBar: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  signInBtn: {
    borderRadius: 20,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    paddingBottom: 24,
    paddingHorizontal: 24,
    gap: 4,
  },
  titleWrap: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  title: {
    fontSize: 44,
    lineHeight: 52,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.8,
    marginBottom: 8,
  },
  logo: {
    width: 140,
    height: 140,
    marginVertical: 12,
  },
  ctaWrap: {
    marginTop: 16,
    borderRadius: 40,
  },
  ctaContent: {
    paddingHorizontal: 32,
    paddingVertical: 8,
  },
  ctaLabel: {
    fontSize: 18,
  },
})
