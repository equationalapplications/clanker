import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { useMachine, useSelector } from '@xstate/react'
import { router, type Href } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import type { IMessage } from 'react-native-gifted-chat'
import type { GroundingMetadata } from '@google/genai'
import { useCharacter } from '~/hooks/useCharacters'
import { useAuthMachine } from '~/hooks/useMachines'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'
import { liveVoiceMachine, type LiveVoiceEvent } from '~/machines/liveVoiceMachine'

/** Return value of useLiveVoiceChat — exposes machine state and call controls. */
export interface UseLiveVoiceChatReturn {
  isConnecting: boolean
  isLive: boolean
  isSyncing: boolean
  error: string | null
  transcript: IMessage[]
  activeTool: string | null
  groundingMetadata: GroundingMetadata | null
  remainingCredits: number
  isPlayingAudio: boolean
  startCall: () => Promise<void>
  endCall: () => void
  cancelCall: () => void
}

const MIN_CREDITS_FOR_CALL = 2

/** Controller hook that wires liveVoiceMachine to hardware I/O, app lifecycle, and navigation. */
export function useLiveVoiceChat(characterId: string): UseLiveVoiceChatReturn {
  const authService = useAuthMachine()
  const currentUser = useSelector(authService, (s) => s.context.user)
  const { data: character } = useCharacter(characterId)
  const { remainingCredits } = useCurrentPlan()
  const navigation = useNavigation()

  const audioIO = useLiveAudioIO()
  const { playChunk, clearPlaybackQueue, stopRecording } = audioIO
  const userId = currentUser?.uid ?? ''

  const machineWithAudio = useMemo(
    () =>
      liveVoiceMachine.provide({
        actions: {
          playIncomingAudio: ({ event }: { event: LiveVoiceEvent }) => {
            if (event.type === 'AUDIO_OUTPUT') {
              void playChunk(event.data)
            }
          },
          flushAudioPlayback: () => {
            clearPlaybackQueue()
          },
        },
      }),
    [playChunk, clearPlaybackQueue],
  )

  const [state, send] = useMachine(machineWithAudio, {
    input: {
      characterId,
      userId,
      initialCredits: typeof remainingCredits === 'number' ? remainingCredits : 0,
    },
  })

  // Mic → machine: forward audio chunks as AUDIO_INPUT events
  useEffect(() => {
    const unsubscribe = audioIO.onAudioChunk((chunk) => {
      send({ type: 'AUDIO_INPUT', data: chunk })
    })
    return unsubscribe
  }, [audioIO, send])

  const endCall = useCallback(() => {
    audioIO.stopRecording()
    audioIO.clearPlaybackQueue()
    send({ type: 'END_CALL' })
  }, [audioIO, send])

  const cancelCall = useCallback(() => {
    audioIO.stopRecording()
    audioIO.clearPlaybackQueue()
    send({ type: 'END_CALL' })
  }, [audioIO, send])

  const startCall = useCallback(async () => {
    if (!character) return

    if (!userId) return

    if (!character.voice) {
      Alert.alert(
        'No Voice Set',
        'This character has no voice selected. Go to character settings to choose one.',
        [
          { text: 'Cancel' },
          { text: 'Edit Character', onPress: () => router.push(`/characters/${characterId}/edit`) },
        ],
      )
      return
    }

    if (typeof remainingCredits === 'number' && remainingCredits < MIN_CREDITS_FOR_CALL) {
      Alert.alert(
        'Insufficient Credits',
        'Live voice calls require credits. Purchase more to continue.',
        [{ text: 'Cancel' }, { text: 'Get More', onPress: () => router.push('/subscribe') }],
      )
      return
    }

    if (!character.save_to_cloud) {
      Alert.alert(
        'Cloud Sync Required',
        'Live voice chat needs cloud sync enabled so your AI can access your memory. Enable it in character settings.',
        [
          { text: 'Cancel' },
          { text: 'Enable Sync', onPress: () => router.push(`/characters/${characterId}/edit` as Href) },
        ],
      )
      return
    }

    const started = await audioIO.startRecording()
    if (!started) return

    send({ type: 'START_CALL' })
  }, [audioIO, character, characterId, remainingCredits, send, userId])

  // Navigation blur → end call
  const endCallRef = useRef(endCall)
  useEffect(() => {
    endCallRef.current = endCall
  }, [endCall])

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      endCallRef.current()
    })
    return () => {
      endCallRef.current()
      unsubscribeBlur?.()
    }
  }, [navigation])

  // AppState backgrounding → end call
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const hasActiveCall =
        state.matches('syncing_memory') ||
        state.matches({ session: 'connecting' }) ||
        state.matches({ session: 'live' })
      if (nextAppState.match(/inactive|background/) && hasActiveCall) {
        endCallRef.current()
      }
    })
    return () => subscription.remove()
  }, [state])

  const isConnecting = state.matches({ session: 'connecting' })
  const isLive = state.matches({ session: 'live' })
  const isSyncing = state.matches('syncing_memory')
  const isSaving = state.matches('saving_to_db')
  const errorState = state.matches('error')

  // Stop mic/playback when the machine exits the live session without an explicit endCall
  useEffect(() => {
    if (errorState || isSaving) {
      stopRecording()
      clearPlaybackQueue()
    }
  }, [errorState, isSaving, stopRecording, clearPlaybackQueue])
  const error = errorState
    ? state.context.socketError === 'credit_exhausted'
      ? 'Out of credits. Tap to get more.'
      : (state.context.socketError ?? 'Connection error')
    : audioIO.error

  return useMemo(
    () => ({
      isConnecting,
      isLive,
      isSyncing,
      error,
      transcript: state.context.transcript,
      activeTool: state.context.activeTool,
      groundingMetadata: state.context.groundingMetadata,
      remainingCredits: state.context.remainingCredits,
      isPlayingAudio: audioIO.playbackState === 'playing',
      startCall,
      endCall,
      cancelCall,
    }),
    [
      isConnecting,
      isLive,
      isSyncing,
      error,
      state.context,
      audioIO.playbackState,
      startCall,
      endCall,
      cancelCall,
    ],
  )
}
