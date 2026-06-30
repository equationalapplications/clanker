import { View, StyleSheet, Platform } from 'react-native'
import { Text, Card, useTheme } from 'react-native-paper'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useFloatingCardAnimation } from '~/hooks/useFloatingCardAnimation'

const FEATURES = [
  {
    icon: 'phone-in-talk' as const,
    title: 'Live, Real-Time Voice Calls',
    body: 'Experience natural, uninterrupted conversations that feel exactly like a real phone call. Talk hands-free on speakerphone, interrupt your character seamlessly if you change your mind, and listen as they search the web or check your shared memory mid-conversation. (Live voice sessions cost just 1 credit per minute.)',
    learnMoreHref: '/real-time-voice',
    isNew: true,
  },
  {
    icon: 'robot-outline' as const,
    title: 'Build Your Character',
    body: 'Give your AI a name, appearance, personality traits, emotional range, and backstory. Generate a unique portrait avatar with AI. No art skills needed.',
  },
  {
    icon: 'chat-outline' as const,
    title: 'Real AI Conversations',
    body: 'Chat with characters that actually remember their personality. Long conversation memory is automatically summarized so your Clanker stays in character.',
  },
  {
    icon: 'cloud-sync-outline' as const,
    title: 'Share & Sync',
    body: 'Save characters to the cloud and sync across all your devices. Share any character via link. Anyone can open it instantly.',
  },
  {
    icon: 'account-cog-outline' as const,
    title: 'Personal Assistant',
    body: 'Upload documents (including PDFs, Word docs, and images) and your personal assistant builds foundational knowledge from them. Share it with others and watch it evolve as you all add to its understanding.',
  },
  {
    icon: 'brain' as const,
    title: 'Wiki-Based Memory',
    body: 'As your assistant learns more, it automatically reconciles conflicting information to stay consistent and accurate. Powered by our local-first LLM Wiki engine, your agent actively maintains a compounding knowledge base without prompt bloat.',
  },
]

function FeatureCard({
  feat,
  index,
}: {
  feat: (typeof FEATURES)[0]
  index: number
}) {
  const { colors } = useTheme()
  const cardAnimStyle = useFloatingCardAnimation(index)
  const isNew = 'isNew' in feat && feat.isNew === true

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 150).duration(500)}
      style={[styles.cardWrap, cardAnimStyle]}
    >
      <Card
        style={[
          styles.card,
          { backgroundColor: colors.surface },
          isNew && { borderColor: colors.primary, borderWidth: 1 },
        ]}
        elevation={isNew ? 3 : 1}
      >
        {isNew ? (
          <View style={styles.badgeRow}>
            <View
              style={[styles.badge, { backgroundColor: colors.primary }]}
              accessibilityRole="text"
              accessibilityLabel="New feature"
              accessible
            >
              <Text style={[styles.badgeText, { color: colors.onPrimary }]}>New</Text>
            </View>
          </View>
        ) : null}
        <Card.Content style={[styles.cardContent, isNew && styles.cardContentWithBadge]}>
          <MaterialCommunityIcons
            name={feat.icon}
            size={36}
            color={colors.primary}
            style={styles.icon}
            accessible
            accessibilityRole="image"
            accessibilityLabel={feat.title}
          />
          <Text variant="titleMedium" style={[styles.cardTitle, { color: colors.onSurface }]}>
            {feat.title}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {feat.body}
          </Text>
          {'learnMoreHref' in feat && feat.learnMoreHref ? (
            <Text
              variant="labelLarge"
              onPress={() => {
                if (Platform.OS === 'web') {
                  window.location.assign(feat.learnMoreHref as string)
                }
              }}
              style={{ color: colors.primary, marginTop: 4 }}
              accessibilityRole="link"
              accessibilityLabel={`Learn more about ${feat.title}`}
            >
              Learn more →
            </Text>
          ) : null}
        </Card.Content>
      </Card>
    </Animated.View>
  )
}

export default function FeaturesSection() {
  const { colors } = useTheme()

  return (
    <View style={[styles.section, { backgroundColor: colors.surfaceVariant }]}>
      <Text
        variant="headlineMedium"
        style={[styles.sectionTitle, { color: colors.onSurface }]}
      >
        Your characters. Your conversations.
      </Text>
      <View style={styles.grid}>
        {FEATURES.map((feat, i) => (
          <FeatureCard key={feat.title} feat={feat} index={i} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 64,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  sectionTitle: {
    textAlign: 'center',
    marginBottom: 40,
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
  cardWrap: {
    width: 280,
    flexGrow: 1,
    maxWidth: 320,
  },
  card: {
    borderRadius: 16,
  },
  badgeRow: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
  },
  badge: {
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  cardContent: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 12,
  },
  cardContentWithBadge: {
    paddingTop: 44,
  },
  icon: {
    marginBottom: 4,
  },
  cardTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
})
