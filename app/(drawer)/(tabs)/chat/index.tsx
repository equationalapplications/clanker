import { View, StyleSheet } from 'react-native'
import { Text, ActivityIndicator } from 'react-native-paper'
import { useCharacters } from '~/hooks/useCharacters'
import { useEnsureDefaultCharacter } from '~/hooks/useEnsureDefaultCharacter'
import { useMostRecentMessage } from '~/hooks/useMessages'
import ChatView from '~/components/ChatView'

export default function ChatTabScreen() {
  const { data: mostRecentMessage, isLoading: isLoadingMessage } = useMostRecentMessage()
  const { data: characters, isLoading: isLoadingCharacters } = useCharacters()
  const { isCreatingDefault } = useEnsureDefaultCharacter()

  const isLoading = isLoadingMessage || isLoadingCharacters

  const characterId = mostRecentMessage?.character_id ?? characters?.[0]?.id

  if (isCreatingDefault) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.text}>Setting up your first character...</Text>
      </View>
    )
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (!characterId) {
    return (
      <View style={styles.centered}>
        <Text variant="headlineSmall">No Characters Yet</Text>
        <Text variant="bodyMedium" style={styles.subText}>
          Go to the Characters tab to create one!
        </Text>
      </View>
    )
  }

  return <ChatView characterId={characterId} />
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    marginTop: 16,
  },
  subText: {
    marginTop: 8,
    opacity: 0.7,
    textAlign: 'center',
  },
})
