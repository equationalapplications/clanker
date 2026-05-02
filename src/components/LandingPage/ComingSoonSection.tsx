import { View, StyleSheet } from 'react-native'
import { Text, Card, useTheme } from 'react-native-paper'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useFloatingCardAnimation } from '~/hooks/useFloatingCardAnimation'

const COMING_SOON_FEATURES = [
  {
    icon: 'account-cog-outline' as const,
    title: 'Personal Assistant',
    body: 'Upload documents and your personal assistant builds knowledge from them. Share it with others and watch it evolve as you all add to its understanding.',
  },
  {
    icon: 'brain' as const,
    title: 'Wiki-Based Memory',
    body: 'As your assistant learns more, it automatically reconciles conflicting information to stay consistent and accurate.',
  },
]

function ComingSoonCard({
  feat,
  index,
}: {
  feat: (typeof COMING_SOON_FEATURES)[0]
  index: number
}) {
  const { colors } = useTheme()
  const cardAnimStyle = useFloatingCardAnimation(index)

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 150).duration(500)}
      style={[styles.cardWrap, cardAnimStyle]}
    >
      <Card style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]} elevation={1}>
        <View style={styles.badgeRow}>
          <View
            style={[styles.badge, { backgroundColor: colors.secondaryContainer }]}
            accessibilityRole="text"
            accessibilityLabel="Coming soon"
            accessible
          >
            <Text style={[styles.badgeText, { color: colors.onSecondaryContainer }]}>
              Coming Soon
            </Text>
          </View>
        </View>
        <Card.Content style={styles.cardContent}>
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
        </Card.Content>
      </Card>
    </Animated.View>
  )
}

export default function ComingSoonSection() {
  const { colors } = useTheme()

  return (
    <View style={[styles.section, { backgroundColor: colors.surfaceVariant }]}>
      <Text
        variant="headlineMedium"
        style={[styles.sectionTitle, { color: colors.onSurface }]}
        accessibilityRole="header"
        accessibilityLabel="What's Coming Next"
      >
        What&apos;s Coming Next
      </Text>
      <View style={styles.grid}>
        {COMING_SOON_FEATURES.map((feat, i) => (
          <ComingSoonCard key={feat.title} feat={feat} index={i} />
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
    borderWidth: 1,
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
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  cardContent: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    paddingTop: 44,
    gap: 12,
  },
  icon: {
    marginBottom: 4,
  },
  cardTitle: {
    textAlign: 'center',
    fontWeight: '600',
  },
})
