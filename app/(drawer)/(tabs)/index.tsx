import { useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { Text, ActivityIndicator } from 'react-native-paper'
import { router } from 'expo-router'
import { useMostRecentMessage } from '~/hooks/useMessages'
import { useCharacters } from '~/hooks/useCharacters'

export default function ChatRedirectScreen() {
  const { data: mostRecentMessage, isLoading: isLoadingMessage } = useMostRecentMessage()
  const { data: characters, isLoading: isLoadingCharacters } = useCharacters()
  const hasRedirected = useRef(false)

  useEffect(() => {
    if (isLoadingMessage || isLoadingCharacters) {
      return
    }
    if (hasRedirected.current) {
      return
    }

    if (mostRecentMessage) {
      const characterId = (mostRecentMessage as any).character_id
      if (characterId) {
        hasRedirected.current = true
        router.replace(`/characters/${characterId}/chat`)
      }
    } else if (characters && characters.length > 0) {
      hasRedirected.current = true
      router.replace(`/characters/${characters[0].id}/chat`)
    }
  }, [mostRecentMessage, characters, isLoadingMessage, isLoadingCharacters])

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>Finding your most recent chat...</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    marginTop: 16,
    textAlign: 'center',
  },
})
