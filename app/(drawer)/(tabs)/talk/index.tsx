import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import React, { useEffect } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Text } from 'react-native-paper'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import type { GroundingMetadata } from '@google/genai'
import { useCharacter } from '~/hooks/useCharacters'
import { useTabCharacterId } from '~/hooks/useTabCharacterId'
import CharacterAvatar from '~/components/CharacterAvatar'
import { GroundingHtml } from '~/components/GroundingHtml'
import { useLiveVoiceChat } from '~/hooks/useLiveVoiceChat'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

const AVATAR_SIZE = 200
const GLOW_SIZE = AVATAR_SIZE + 60
const LOW_CREDIT_THRESHOLD = 5

function TalkGroundingDisplay({ metadata }: { metadata: GroundingMetadata }) {
  const chunks = metadata.groundingChunks ?? []
  const renderedContent = metadata.searchEntryPoint?.renderedContent

  if (chunks.length === 0 && !renderedContent) {
    return null
  }

  return (
    <View style={styles.groundingContainer}>
      {chunks.length > 0 && (
        <View
          style={styles.citationRow}
          accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}
          accessibilityLabel="Search sources"
        >
          {chunks.map((chunk, index) => {
            const uri = chunk.web?.uri
            const title = chunk.web?.title ?? uri
            if (!uri || !title || !isSafeHttpUrl(uri)) {
              return null
            }
            return (
              <TouchableOpacity
                key={`${uri}-${index}`}
                style={styles.citationChip}
                onPress={() => {
                  void Linking.openURL(uri).catch((error) => {
                    console.warn('Failed to open citation URL', error)
                  })
                }}
                accessibilityRole="link"
                accessibilityLabel={title}
              >
                <Text style={styles.citationChipText} numberOfLines={1}>
                  {title}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
      {renderedContent ? (
        <GroundingHtml html={renderedContent} style={styles.searchSuggestions} />
      ) : null}
    </View>
  )
}

function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
  const {
    isConnecting,
    isLive,
    isSyncing,
    syncPhase,
    error,
    transcript,
    activeTool,
    groundingMetadata,
    isPlayingAudio,
    remainingCredits,
    startCall,
    endCall,
  } = useLiveVoiceChat(characterId)
  const navigation = useNavigation()

  const glowScale = useSharedValue(1)
  const glowOpacity = useSharedValue(0)

  useEffect(() => {
    if (isPlayingAudio) {
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
  }, [isPlayingAudio, glowOpacity, glowScale])

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }))

  React.useLayoutEffect(() => {
    if (!character) return
    const drawerNav = navigation.getParent()?.getParent()

    const setHeader = () => {
      drawerNav?.setOptions({
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <Pressable
              onPress={!isLive ? () => router.push(`/characters/${characterId}/edit`) : undefined}
              disabled={isLive}
              accessibilityRole="button"
              accessibilityState={{ disabled: isLive }}
              accessibilityLabel={!isLive ? `Edit ${character.name}` : character.name}
            >
              <CharacterAvatar size={40} imageUrl={character.avatar} characterName={character.name} />
            </Pressable>
            <Text variant="titleMedium" numberOfLines={1}>
              {character.name}
            </Text>
          </View>
        ),
      })
    }

    setHeader()
    const unsubscribeFocus = navigation.addListener?.('focus', setHeader)
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    })

    return () => {
      unsubscribeFocus?.()
      unsubscribeBlur?.()
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    }
  }, [character, isLive, characterId, navigation])

  const isBusy = isConnecting || isLive || isSyncing
  const showSpinner = isSyncing || isConnecting

  const statusText = (() => {
    if (error) return error
    if (isSyncing && syncPhase === 'saving_observations') return 'Saving observations…'
    if (isSyncing && syncPhase === 'syncing_cloud') return 'Syncing memory…'
    if (isSyncing) return 'Preparing memory…'
    if (isConnecting) return 'Connecting…'
    if (isLive && isPlayingAudio) return transcript[transcript.length - 1]?.text ?? 'Speaking…'
    if (isLive && activeTool) return `⏳ ${activeTool.replace(/_/g, ' ')}…`
    if (isLive) {
      const lastUserMsg = [...transcript].reverse().find((m) => m.user._id !== characterId)
      return lastUserMsg?.text ?? 'Listening…'
    }
    return 'Tap the mic to talk'
  })()

  if (!character) {
    return (
      <View style={styles.centered}>
        <Text>Character not found.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatarWrap}>
        <Animated.View style={[styles.glow, glowAnimatedStyle]} />
        <CharacterAvatar
          size={AVATAR_SIZE}
          imageUrl={character.avatar}
          characterName={character.name}
        />
      </View>

      <View style={styles.statusWrap} accessibilityLiveRegion="polite">
        {showSpinner ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
        <Text style={[styles.statusText, error ? styles.errorText : null]}>{statusText}</Text>
      </View>

      {isLive || isConnecting ? (
        <Text
          accessibilityLabel="Credits remaining"
          style={[
            styles.creditCount,
            remainingCredits <= LOW_CREDIT_THRESHOLD ? styles.creditCountLow : null,
          ]}
        >
          {remainingCredits} credits
        </Text>
      ) : null}

      {groundingMetadata ? <TalkGroundingDisplay metadata={groundingMetadata} /> : null}

      <View style={styles.buttonWrap}>
        {isLive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End Call"
            onPress={endCall}
            style={[styles.micButton, styles.endCallButton]}
          >
            <MaterialCommunityIcons name="phone-hangup" size={36} color="#ffffff" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start Voice Call"
            onPress={startCall}
            disabled={isBusy}
            style={[styles.micButton, isBusy ? styles.micButtonDisabled : null]}
          >
            {showSpinner ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <MaterialCommunityIcons name="microphone" size={36} color="#ffffff" />
            )}
          </Pressable>
        )}
      </View>
    </View>
  )
}

export default function TalkTabScreen() {
  const { characterId, isLoading, isCreatingDefault } = useTabCharacterId()

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

  return <TalkView key={characterId} characterId={characterId} />
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
  creditCount: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 4,
  },
  creditCountLow: {
    color: '#b00020',
    opacity: 1,
    fontWeight: '600',
  },
  groundingContainer: {
    width: '100%',
    maxWidth: 480,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  citationChip: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  citationChipText: {
    fontSize: 13,
    color: '#1565c0',
  },
  searchSuggestions: {
    width: '100%',
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
  endCallButton: {
    backgroundColor: '#b00020',
  },
})
