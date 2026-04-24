import { Stack, router } from 'expo-router'
import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Text } from 'react-native-paper'
import { useSelector } from '@xstate/react'
import { useCharacter, useCharacters } from '~/hooks/useCharacters'
import { useMostRecentMessage } from '~/hooks/useMessages'
import { useCharacterMachine } from '~/hooks/useMachines'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useVoiceChat } from '~/hooks/useVoiceChat'

function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
  const { voiceState, transcription, replyText, error, startListening } = useVoiceChat(characterId)

  if (!character) {
    return (
      <View style={styles.centered}>
        <Text>Character not found.</Text>
      </View>
    )
  }

  const statusText =
    error ||
    (voiceState === 'listening' ? 'Listening...' : '') ||
    (voiceState === 'transcribing' || voiceState === 'processing' ? transcription : '') ||
    (voiceState === 'playing' ? replyText : '')

  const isBusy = voiceState === 'transcribing' || voiceState === 'processing' || voiceState === 'playing'
  const canEdit = voiceState === 'idle'

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Pressable
                onPress={() => {
                  if (canEdit) {
                    router.push(`/characters/${characterId}/edit`)
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${character.name}`}
              >
                <CharacterAvatar size={40} imageUrl={character.avatar} characterName={character.name} />
              </Pressable>
              <Text variant="titleMedium" numberOfLines={1}>
                {character.name}
              </Text>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        <View style={styles.statusWrap}>
          <Text style={[styles.statusText, error ? styles.errorText : null]}>{statusText}</Text>
        </View>

        <View style={styles.buttonWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Talk"
            onPress={startListening}
            disabled={isBusy}
            style={[styles.micButton, isBusy ? styles.micButtonDisabled : null]}
          >
            {voiceState === 'playing' ? (
              <MaterialCommunityIcons name="volume-high" size={36} color="#ffffff" />
            ) : isBusy ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <MaterialCommunityIcons name="microphone" size={36} color="#ffffff" />
            )}
          </Pressable>
        </View>
      </View>
    </>
  )
}

export default function TalkTabScreen() {
  const { data: mostRecentMessage, isLoading: isLoadingMessage } = useMostRecentMessage()
  const { characters, isLoading: isLoadingCharacters } = useCharacters()
  const characterService = useCharacterMachine()
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))

  const isLoading = isLoadingMessage || isLoadingCharacters
  const characterId = mostRecentMessage?.character_id ?? characters?.[0]?.id

  if (isCreatingDefault) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Setting up your first character...</Text>
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
        <Text variant="bodyMedium" style={styles.emptyText}>
          Go to the Characters tab to create one!
        </Text>
      </View>
    )
  }

  return <TalkView characterId={characterId} />
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 56,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
  },
  emptyText: {
    marginTop: 8,
    opacity: 0.7,
    textAlign: 'center',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusWrap: {
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  statusText: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  errorText: {
    color: '#b00020',
  },
  buttonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#1f9d55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonDisabled: {
    opacity: 0.75,
  },
})
