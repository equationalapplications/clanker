import React from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { Card, Text, Icon, useTheme } from 'react-native-paper'
import { router } from 'expo-router'
import CharacterAvatar from '~/components/CharacterAvatar'

interface CharacterCardProps {
  id: string
  name: string
  appearance?: string
  avatar?: string
  onPress?: () => void
  onEdit?: () => void
}

export const CharacterCard: React.FC<CharacterCardProps> = ({
  id,
  name,
  appearance,
  avatar,
  onPress,
  onEdit,
}) => {
  const theme = useTheme()

  const handlePress = () => {
    if (onPress) {
      onPress()
    } else {
      router.push(`/chat/${id}`)
    }
  }

  const handleEdit = (e: any) => {
    e.stopPropagation()
    if (onEdit) {
      onEdit()
    } else {
      router.push(`/characters/${id}/edit`)
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <TouchableOpacity
        onPress={handlePress}
        style={styles.touchable}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${appearance ?? 'No description available'}`}
        accessibilityHint="Opens chat with this character"
      >
        <Card.Content style={styles.content}>
          <View style={styles.header}>
            <View style={styles.avatarContainer}>
              <CharacterAvatar size={48} imageUrl={avatar} characterName={name} />
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
            <TouchableOpacity
              onPress={handleEdit}
              style={styles.editButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${name}`}
              accessibilityHint="Opens character editor"
            >
              <Icon source="pencil" size={20} />
            </TouchableOpacity>
          </View>
        </Card.Content>
      </TouchableOpacity>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    marginHorizontal: 16,
  },
  touchable: {
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
