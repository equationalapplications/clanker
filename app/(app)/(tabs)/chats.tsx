import { StyleSheet, ScrollView, View } from 'react-native'
import { Text, Card, Avatar } from 'react-native-paper'
import { router } from 'expo-router'
import { useCharacters } from '~/hooks/useCharacters'
import LoadingIndicator from '~/components/LoadingIndicator'

const defaultAvatarUrl = 'https://via.placeholder.com/150'

interface ChatItemProps {
  id: string
  name: string
  avatar?: string | null
  lastMessage?: string
}

export default function ChatsScreen() {
  const { data: characterList, isLoading } = useCharacters()

  const onPressChatItem = (id: string) => {
    router.push(`/characters/${id}/chat`)
  }

  const ChatItem = ({ id, name, avatar, lastMessage }: ChatItemProps) => (
    <Card style={styles.chatCard} onPress={() => onPressChatItem(id)}>
      <Card.Content style={styles.chatCardContent}>
        <Avatar.Image size={50} source={{ uri: avatar || defaultAvatarUrl }} />
        <View style={styles.chatTextContainer}>
          <Text variant="titleMedium" style={styles.chatName}>
            {name || 'Unnamed Character'}
          </Text>
          <Text variant="bodySmall" style={styles.lastMessage} numberOfLines={1}>
            {lastMessage || 'Start a conversation...'}
          </Text>
        </View>
      </Card.Content>
    </Card>
  )

  if (isLoading) {
    return (
      <View style={styles.container}>
        <LoadingIndicator disabled={false} />
      </View>
    )
  }

  if (!characterList || characterList.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text variant="headlineSmall" style={styles.emptyTitle}>
          No Characters Yet
        </Text>
        <Text variant="bodyMedium" style={styles.emptyNote}>
          Create a character to start chatting!
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 20, width: '100%' }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        {characterList.map((character) => (
          <ChatItem
            key={character.id}
            id={character.id}
            name={character.name || 'Unnamed Character'}
            avatar={character.avatar}
            lastMessage={undefined} // TODO: Add last message from messages table
          />
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    marginBottom: 10,
  },
  emptyNote: {
    opacity: 0.7,
    textAlign: 'center',
  },
  scrollContentContainer: {
    gap: 10,
    paddingBottom: 100,
    paddingHorizontal: 20,
  },
  chatCard: {
    width: '100%',
  },
  chatCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  chatTextContainer: {
    flex: 1,
  },
  chatName: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  lastMessage: {
    opacity: 0.7,
  },
})
