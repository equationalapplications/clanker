import React from 'react'
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Text, useTheme } from 'react-native-paper'
import { Image } from 'expo-image'
import { Link, useRouter } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useSelector } from '@xstate/react'
import LandingFooter from './LandingFooter'
import { getYouTubeEmbedUrl, realTimeVoiceDemoVideoUrl } from '~/config/marketingConfig'
import { useAuthMachine } from '~/hooks/useMachines'

const HIGHLIGHTS = [
  {
    icon: 'phone-in-talk' as const,
    title: 'Feels like a real phone call',
    body: 'Natural, uninterrupted back-and-forth — not tap-to-talk. Stay on speakerphone and keep the conversation flowing.',
  },
  {
    icon: 'hand-back-left' as const,
    title: 'Interrupt anytime',
    body: 'Change your mind mid-sentence? Barge in seamlessly. Your character listens and adapts in real time.',
  },
  {
    icon: 'web' as const,
    title: 'Tools mid-conversation',
    body: 'Ask your character to search the web or check shared memory while you talk — results come back spoken aloud.',
  },
  {
    icon: 'credit-card-outline' as const,
    title: 'Simple pricing',
    body: 'Live voice sessions cost just 1 credit per minute. No surprise per-reply charges during a call.',
  },
]

const youtubeEmbedUrl = getYouTubeEmbedUrl(realTimeVoiceDemoVideoUrl)

const IFRAME_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
}

export default function RealTimeVoicePage() {
  const { colors } = useTheme()
  const router = useRouter()
  const authService = useAuthMachine()
  const isSignedIn = useSelector(authService, (s) => s.matches('signedIn'))

  const handleTryVoice = () => {
    if (isSignedIn) {
      router.push('/talk')
      return
    }
    router.push('/sign-in?redirect=/talk')
  }

  const handleWatchDemo = () => {
    if (!realTimeVoiceDemoVideoUrl) return
    void Linking.openURL(realTimeVoiceDemoVideoUrl).catch((error) => {
      console.warn('Failed to open real-time voice demo video', error)
    })
  }

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Link href="/" asChild>
          <Button mode="text" compact textColor={colors.primary} style={styles.backLink}>
            ← Back to Clanker
          </Button>
        </Link>

        <Text variant="headlineLarge" style={[styles.heroTitle, { color: colors.primary }]}>
          Live, Real-Time Voice Calls
        </Text>
        <Text variant="titleMedium" style={[styles.heroSubtitle, { color: colors.onBackground }]}>
          Experience natural, uninterrupted conversations that feel exactly like a real phone call.
          Talk hands-free on speakerphone, interrupt your character seamlessly if you change your
          mind, and listen as they search the web or check your shared memory mid-conversation.
        </Text>
        <Text variant="bodyMedium" style={[styles.pricingNote, { color: colors.onSurfaceVariant }]}>
          Live voice sessions cost just 1 credit per minute.
        </Text>

        <View style={styles.heroActions}>
          <Button mode="contained" onPress={handleTryVoice} contentStyle={styles.ctaContent}>
            {isSignedIn ? 'Open Talk Tab' : 'Try Live Voice'}
          </Button>
          {realTimeVoiceDemoVideoUrl ? (
            <Button mode="outlined" onPress={handleWatchDemo} icon="play-circle-outline">
              Watch the demo
            </Button>
          ) : null}
        </View>
      </View>

      <View style={styles.videoSection}>
        <Text variant="titleLarge" style={[styles.sectionTitle, { color: colors.onSurface }]}>
          See it in action
        </Text>
        <View style={styles.videoFrameWrap}>
          {Platform.OS === 'web' && youtubeEmbedUrl ? (
            <iframe
              title="Clanker real-time voice demo"
              src={youtubeEmbedUrl}
              style={IFRAME_STYLE}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          ) : (
            <Pressable
              style={styles.videoPlaceholder}
              onPress={handleWatchDemo}
              disabled={!realTimeVoiceDemoVideoUrl}
              accessibilityRole={realTimeVoiceDemoVideoUrl ? 'button' : 'image'}
              accessibilityLabel={
                realTimeVoiceDemoVideoUrl
                  ? 'Watch the Clanker real-time voice demo'
                  : 'Real-time voice demo video coming soon'
              }
            >
              <Image
                source={require('../../../assets/banner.png')}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                accessibilityLabel="Clanker real-time voice"
              />
              <View style={styles.videoPlaceholderOverlay}>
                <MaterialCommunityIcons
                  name={realTimeVoiceDemoVideoUrl ? 'play-circle' : 'movie-open-outline'}
                  size={64}
                  color="#ffffff"
                />
                <Text style={styles.videoPlaceholderText}>
                  {realTimeVoiceDemoVideoUrl ? 'Watch the demo' : 'Demo video coming soon'}
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      </View>

      <View style={[styles.highlightsSection, { backgroundColor: colors.surfaceVariant }]}>
        <Text variant="headlineMedium" style={[styles.sectionTitle, { color: colors.onSurface }]}>
          Why you&apos;ll love it
        </Text>
        <View style={styles.grid}>
          {HIGHLIGHTS.map((item) => (
            <Card key={item.title} style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
              <Card.Content style={styles.cardContent}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={36}
                  color={colors.primary}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={item.title}
                />
                <Text variant="titleMedium" style={[styles.cardTitle, { color: colors.onSurface }]}>
                  {item.title}
                </Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  {item.body}
                </Text>
              </Card.Content>
            </Card>
          ))}
        </View>
      </View>

      <View style={styles.bottomCta}>
        <Text variant="titleLarge" style={[styles.bottomCtaTitle, { color: colors.onSurface }]}>
          Ready to talk to your character?
        </Text>
        <Button mode="contained" onPress={handleTryVoice} contentStyle={styles.ctaContent}>
          {isSignedIn ? 'Start a live call' : 'Get started free'}
        </Button>
      </View>

      <LandingFooter />
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
  hero: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 48,
    alignItems: 'center',
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  backLink: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  heroTitle: {
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 16,
  },
  heroSubtitle: {
    textAlign: 'center',
    lineHeight: 26,
    opacity: 0.9,
  },
  pricingNote: {
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  heroActions: {
    marginTop: 28,
    gap: 12,
    alignItems: 'center',
  },
  ctaContent: {
    paddingHorizontal: 24,
    paddingVertical: 6,
  },
  videoSection: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
  },
  videoFrameWrap: {
    width: '100%',
    maxWidth: 800,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
  },
  videoPlaceholder: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  videoPlaceholderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  videoPlaceholderText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  highlightsSection: {
    paddingVertical: 64,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  sectionTitle: {
    textAlign: 'center',
    marginBottom: 32,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
    maxWidth: 960,
    width: '100%',
  },
  card: {
    width: 280,
    flexGrow: 1,
    maxWidth: 320,
    borderRadius: 16,
  },
  cardContent: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 12,
  },
  cardTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomCta: {
    paddingVertical: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 20,
  },
  bottomCtaTitle: {
    textAlign: 'center',
    fontWeight: '700',
  },
})
