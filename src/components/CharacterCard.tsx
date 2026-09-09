import React from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { Card, Text, Icon, useTheme } from 'react-native-paper'
import { router } from 'expo-router'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useResolvedImage } from '~/hooks/useResolvedImage'

interface CharacterCardProps {
  id: string
  name: string
  appearance?: string
  activeImageId?: string | null
  onPress?: () => void
  onEdit?: () => void
}

export const CharacterCard: React.FC<CharacterCardProps> = ({
  id,
  name,
  appearance,
  activeImageId,
  onPress,
  onEdit,
}) => {
  const theme = useTheme()
  // Thumb, not master: this renders at 48px, and the list can hold many cards.
  const { uri: avatarUri } = useResolvedImage(activeImageId, 'thumb')
  // No unread dot here yet. It was severed along with push in 86de54b5 — while
  // PROACTIVE_PUSH_ENABLED is false a message can land with nothing to deeplink
  // into, so badging it would point at an empty chat. When the fast-follow wires
  // the lifecycle sync and un-gates push, the dot comes back as a boolean driven
  // by `countUnreadProactive` (which already enforces the staleness escape, so it
  // matches the server's push-decision contract) — deliberately a boolean and not
  // a count, because AI chats are not an inbox.

  const handlePress = () => {
    if (onPress) {
      onPress()
    } else {
      router.push(`/chat/${id}`)
    }
  }

  const handleEdit = () => {
    if (onEdit) {
      onEdit()
    } else {
      router.push(`/characters/${id}/edit`)
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <View style={styles.cardWrapper}>
        <TouchableOpacity
          onPress={handlePress}
          style={styles.touchable}
          accessibilityRole="button"
          accessibilityLabel={`${name || 'Unnamed Character'}, ${appearance ?? 'No description available'}`}
          accessibilityHint="Opens chat with this character"
        >
          <Card.Content style={styles.content}>
            <View style={styles.header}>
              <View style={styles.avatarContainer}>
                <CharacterAvatar size={48} imageUrl={avatarUri} characterName={name} />
              </View>
              <View style={styles.info}>
                <Text variant="titleMedium" style={styles.name}>
                  {name || 'Unnamed Character'}
                </Text>
                <Text
                  variant="bodySmall"
                  style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={2}
                >
                  {appearance || 'No description available'}
                </Text>
              </View>
            </View>
          </Card.Content>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleEdit}
          style={styles.editButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name || 'Unnamed Character'}`}
          accessibilityHint="Opens character editor"
        >
          <Icon source="pencil" size={20} />
        </TouchableOpacity>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    marginHorizontal: 16,
  },
  cardWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  touchable: {
    flex: 1,
    borderRadius: 12,
  },
  content: {
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: 12,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  description: {
    opacity: 0.7,
    lineHeight: 18,
  },
  editButton: {
    padding: 8,
    borderRadius: 20,
  },
})

export default CharacterCard
