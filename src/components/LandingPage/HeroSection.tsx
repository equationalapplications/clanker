import { StyleSheet, View, Pressable, Platform, useWindowDimensions } from 'react-native'
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
  const { height } = useWindowDimensions()
  const router = useRouter()
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

  useEffect(() => {
    shiverX.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 10000 }),
        withTiming(5, { duration: 55 }),
        withTiming(-5, { duration: 55 }),
        withTiming(4, { duration: 45 }),
        withTiming(-4, { duration: 45 }),
        withTiming(2, { duration: 40 }),
        withTiming(-2, { duration: 40 }),
        withTiming(0, { duration: 55 })
      ),
      -1,
      false
    )
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

  const handleChatIntent = () => {
    if (isSignedIn) {
      router.push('/chat')
      return
    }

    router.push('/sign-in?redirect=/chat')
  }

  return (
    <View style={[styles.hero, { minHeight: Math.min(height, 560), backgroundColor: colors.background }]}>
      {/* Top-right sign-in button — no glow, just subtle */}
      <View style={styles.topBar}>
        <Button
          mode="text"
          compact
          textColor={colors.primary}
          onPress={handleChatIntent}
          style={styles.signInBtn}
        >
          {isSignedIn ? 'Open App' : 'Sign In'}
        </Button>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        {/* New-feature announcement pill */}
        <Animated.View entering={FadeInDown.delay(50).duration(600)}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="New: Live, real-time voice calls. Learn more."
            onPress={() => {
              if (Platform.OS === 'web') {
                window.location.assign('/real-time-voice')
              }
            }}
            style={[
              styles.announcePill,
              { backgroundColor: colors.secondaryContainer, borderColor: colors.primary },
            ]}
          >
            <MonoText style={[styles.announceText, { color: colors.onSecondaryContainer }]}>
              ✨ New: Live, Real-Time Voice Calls →
            </MonoText>
          </Pressable>
        </Animated.View>

        {/* Title with glow halo + shiver */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(600)}
          style={[styles.titleWrap, glowShiverStyle]}
        >
          <TitleText style={[styles.title, { color: colors.primary }]}>Clanker</TitleText>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(600)}>
          <MonoText style={[styles.tagline, { color: colors.onBackground }]}>
            Design, chat with, call, and share your own AI characters
          </MonoText>
        </Animated.View>

        <Animated.View style={logoAnimStyle}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="Clanker application logo"
            accessibilityRole="image"
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
            onPress={handleChatIntent}
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
    paddingHorizontal: 24,
    gap: 4,
  },
  announcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 20,
  },
  announceText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  titleWrap: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 18,
    borderRadius: 16,
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
