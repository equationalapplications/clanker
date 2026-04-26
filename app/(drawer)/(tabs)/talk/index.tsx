import { Stack, router, useFocusEffect } from 'expo-router'
import React, { useCallback, useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Text } from 'react-native-paper'
import { useSelector } from '@xstate/react'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useCharacter, useCharacters } from '~/hooks/useCharacters'
import { useMostRecentMessage } from '~/hooks/useMessages'
import { useCharacterMachine } from '~/hooks/useMachines'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useVoiceChat } from '~/hooks/useVoiceChat'

const AVATAR_SIZE = 200
const GLOW_SIZE = AVATAR_SIZE + 60

function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
  const { voiceState, transcription, replyText, error, startListening, cancel } = useVoiceChat(characterId)

  const glowScale = useSharedValue(1)
  const glowOpacity = useSharedValue(0)

  const isPlaying = voiceState === 'playing'

  useEffect(() => {
    if (isPlaying) {
      glowOpacity.value = withTiming(0.7, { duration: 250 })
      glowScale.value = withRepeat(
        withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      )
    } else {
      cancelAnimation(glowScale)
      cancelAnimation(glowOpacity)
      glowOpacity.value = withTiming(0, { duration: 250 })
      glowScale.value = withTiming(1, { duration: 250 })
    }
  }, [isPlaying, glowOpacity, glowScale])

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }))

  useFocusEffect(
    useCallback(() => {
      return () => {
        cancel()
      }
    }, [cancel]),
  )

  if (!character) {
    return (
      <View style={styles.centered}>
        <Text>Character not found.</Text>
      </View>
    )
  }

  const statusText = (() => {
    if (error) return error
    if (voiceState === 'listening') return transcription || 'Listening…'
    if (voiceState === 'transcribing') return transcription || 'Listening…'
    if (voiceState === 'processing') return transcription || 'Thinking…'
    if (voiceState === 'playing') return replyText || 'Speaking…'
    return 'Tap the mic to talk'
  })()

  const showSpinner = voiceState === 'processing'
  const isBusy =
    voiceState === 'listening' ||
    voiceState === 'transcribing' ||
    voiceState === 'processing' ||
    voiceState === 'playing'
  const canEdit = voiceState === 'idle' || voiceState === 'error'

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Pressable
                onPress={canEdit ? () => router.push(`/characters/${characterId}/edit`) : undefined}
                disabled={!canEdit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canEdit }}
                accessibilityLabel={canEdit ? `Edit ${character.name}` : character.name}
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
        <View style={styles.avatarWrap}>
          <Animated.View style={[styles.glow, glowAnimatedStyle]} />
          <CharacterAvatar
            size={AVATAR_SIZE}
            imageUrl={character.avatar}
            characterName={character.name}
          />
        </View>

        <View style={styles.statusWrap}>
          {showSpinner ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
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
            ) : voiceState === 'listening' || voiceState === 'transcribing' ? (
              <MaterialCommunityIcons name="microphone" size={36} color="#ffffff" />
            ) : voiceState === 'processing' ? (
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 32,
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
  avatarWrap: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: '#1f9d55',
  },
  statusWrap: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  spinner: {
    marginRight: 4,
  },
  statusText: {
    flexShrink: 1,
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
