import { View, StyleSheet } from 'react-native'
import { Text, Card, useTheme } from 'react-native-paper'
import { useEffect } from 'react'
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated'
import { MaterialCommunityIcons } from '@expo/vector-icons'

const FEATURES = [
  {
    icon: 'robot-outline' as const,
    title: 'Build Your Character',
    body: 'Give your AI a name, appearance, personality traits, emotional range, and backstory. Generate a unique portrait avatar with AI — no art skills needed.',
  },
  {
    icon: 'chat-outline' as const,
    title: 'Real AI Conversations',
    body: 'Chat with characters that actually remember their personality. Long conversation memory is automatically summarized so your Clanker stays in character.',
  },
  {
    icon: 'microphone-outline' as const,
    title: 'Talk to Your Character',
    body: 'Tap the mic and speak - your character replies in their own voice. Monthly subscribers talk for free; others use 2 credits per reply.',
  },
  {
    icon: 'cloud-sync-outline' as const,
    title: 'Share & Sync',
    body: 'Save characters to the cloud and sync across all your devices. Share any character via link — anyone can open it instantly.',
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

  // Idle float: gentle vertical bob, phase-offset by index so cards drift independently
  const floatY = useSharedValue(0)

  useEffect(() => {
    floatY.value = withDelay(
      index * 550,
      withRepeat(
        withSequence(
          withTiming(-7, { duration: 2600 }),
          withTiming(0, { duration: 2600 })
        ),
        -1,
        true
      )
    )
  }, [floatY, index])

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }))

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 150).duration(500)}
      style={[styles.cardWrap, cardAnimStyle]}
    >
      <Card style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <Card.Content style={styles.cardContent}>
          <MaterialCommunityIcons
            name={feat.icon}
            size={36}
            color={colors.primary}
            style={styles.icon}
          />
          <Text variant="titleMedium" style={[styles.cardTitle, { color: colors.onSurface }]}>
            {feat.title}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {feat.body}
          </Text>
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
  cardContent: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 12,
  },
  icon: {
    marginBottom: 4,
  },
  cardTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
})
