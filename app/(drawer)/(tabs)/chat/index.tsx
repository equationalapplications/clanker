import { View, StyleSheet } from 'react-native'
import { Text, ActivityIndicator } from 'react-native-paper'
import { useSelector } from '@xstate/react'
import { useCharacters } from '~/hooks/useCharacters'
import { useMostRecentMessage } from '~/hooks/useMessages'
import ChatView from '~/components/ChatView'
import { useAuthMachine, useCharacterMachine } from '~/hooks/useMachines'
import { isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'
import { DEV_CLOUD_CHARACTER_ID } from '../../../../shared/dev-sandbox'

export default function ChatTabScreen() {
  const { data: mostRecentMessage, isLoading: isLoadingMessage } = useMostRecentMessage()
  const { characters, isLoading: isLoadingCharacters } = useCharacters()
  const characterService = useCharacterMachine()
  const authService = useAuthMachine()
  const defaultCharacterId = useSelector(
    authService,
    (s) => s.context.dbUser?.defaultCharacterId ?? null,
  )
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))

  const isLoading = isLoadingMessage || isLoadingCharacters

  const devLinkedCharacterId = isDevSandboxEnabled()
    ? characters.find((c) => c.cloud_id === DEV_CLOUD_CHARACTER_ID)?.id
    : undefined

  const characterId =
    mostRecentMessage?.character_id ??
    devLinkedCharacterId ??
    defaultCharacterId ??
    characters?.[0]?.id

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
