import { useSelector } from '@xstate/react'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Platform } from 'react-native'
import { useAuthMachine } from '~/hooks/useMachines'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { sendVoiceMessage } from '~/services/voiceChatService'

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'processing' | 'playing' | 'error'

interface UseVoiceChatReturn {
  voiceState: VoiceState
  transcription: string
  replyText: string
  error: string | null
  startListening: () => Promise<void>
  cancel: () => void
}

const MAX_LISTEN_MS = 30_000

function extractTranscript(payload: unknown): { transcript: string; isFinal: boolean } {
  if (!payload || typeof payload !== 'object') {
    return { transcript: '', isFinal: false }
  }

  const record = payload as {
    transcript?: unknown
    results?: { transcript?: unknown }[]
    isFinal?: unknown
  }

  const direct = typeof record.transcript === 'string' ? record.transcript : ''
  const fromResults = Array.isArray(record.results)
    ? record.results
        .map((entry) => (typeof entry?.transcript === 'string' ? entry.transcript : ''))
        .join(' ')
    : ''

  const transcript = (direct || fromResults).trim()
  const isFinal = record.isFinal === true

  return { transcript, isFinal }
}

export function useVoiceChat(characterId: string): UseVoiceChatReturn {
  const authService = useAuthMachine()
  const currentUser = useSelector(authService, (state) => state.context.user)
  const { data: character } = useCharacter(characterId)
  const messages = useChatMessages({ id: characterId, userId: currentUser?.uid || '' })
  const { isSubscriber, remainingCredits } = useCurrentPlan()

  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [transcription, setTranscription] = useState('')
  const [replyText, setReplyText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionActiveRef = useRef(false)
  const isMountedRef = useRef(true)
  const cancelledRef = useRef(false)
  const transcriptionRef = useRef('')
  const finalTranscriptionRef = useRef('')
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null)
  const playerSubRef = useRef<{ remove: () => void } | null>(null)
  const tempFileRef = useRef<File | null>(null)

  const canUseNativeVoice = Platform.OS !== 'web'

  useEffect(() => {
    if (!canUseNativeVoice) return
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch((err) => {
      console.warn('[useVoiceChat] setAudioModeAsync failed', err)
    })
  }, [canUseNativeVoice])

  const clearListenTimer = useCallback(() => {
    if (!timerRef.current) {
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const cleanupPlayback = useCallback(async () => {
    try {
      playerSubRef.current?.remove()
      playerSubRef.current = null

      if (playerRef.current) {
        playerRef.current.release()
        playerRef.current = null
      }

      if (tempFileRef.current) {
        const file = tempFileRef.current
        tempFileRef.current = null
        if (file.exists) {
          file.delete()
        }
      }
    } catch (error) {
      console.warn('Failed to clean up playback resources', error)
    }
  }, [])

  const goIdle = useCallback(() => {
    clearListenTimer()
    setVoiceState('idle')
  }, [clearListenTimer])

  const fail = useCallback(
    async (message: string) => {
      setError(message)
      setVoiceState('error')
      await cleanupPlayback()
    },
    [cleanupPlayback],
  )

  const processTranscript = useCallback(async () => {
    const currentText = (finalTranscriptionRef.current || transcriptionRef.current).trim()

    if (!currentText || !character || !currentUser?.uid) {
      setTranscription('')
      goIdle()
      return
    }

    setVoiceState('processing')

    try {
      const response = await sendVoiceMessage(currentText, character, currentUser.uid, messages)

      if (!isMountedRef.current || cancelledRef.current) {
        await cleanupPlayback()
        if (isMountedRef.current) {
          goIdle()
        }
        return
      }

      setReplyText(response.replyText)
      setVoiceState('playing')

      let playerUri: string
      if (Platform.OS === 'web') {
        playerUri = `data:${response.audioMimeType};base64,${response.audioBase64}`
      } else {
        const MIME_TO_EXT: Record<string, string> = {
          'audio/wav': 'wav',
          'audio/x-wav': 'wav',
          'audio/mpeg': 'mp3',
          'audio/mp3': 'mp3',
          'audio/ogg': 'ogg',
          'audio/mp4': 'm4a',
          'audio/aac': 'aac',
          'audio/webm': 'webm',
          'audio/flac': 'flac',
        }
        const ext = MIME_TO_EXT[response.audioMimeType] ?? 'wav'
        const file = new File(Paths.cache, `voice-reply-${Date.now()}.${ext}`)
        const binaryString = atob(response.audioBase64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        file.write(bytes)
        tempFileRef.current = file
        playerUri = file.uri
      }

      const player = createAudioPlayer({ uri: playerUri })
      playerRef.current = player
      playerSubRef.current = player.addListener('playbackStatusUpdate', (status) => {
        if (status?.didJustFinish) {
          if (isMountedRef.current) {
            goIdle()
          }
          void cleanupPlayback()
        }
      })

      await player.play()
    } catch (err) {
      if (!isMountedRef.current || cancelledRef.current) {
        await cleanupPlayback()
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Voice reply failed'
      await fail(errorMessage)
    }
  }, [character, cleanupPlayback, currentUser?.uid, fail, goIdle, messages])

  useSpeechRecognitionEvent('result', (payload) => {
    if (!recognitionActiveRef.current || cancelledRef.current || !isMountedRef.current) {
      return
    }

    const { transcript, isFinal } = extractTranscript(payload)

    if (!transcript) {
      return
    }

    transcriptionRef.current = transcript
    setTranscription(transcript)
    setVoiceState((prev) => (prev === 'processing' ? prev : 'transcribing'))

    if (isFinal) {
      finalTranscriptionRef.current = transcript
    }
  })

  useSpeechRecognitionEvent('error', (payload) => {
    if (!recognitionActiveRef.current || cancelledRef.current || !isMountedRef.current) {
      return
    }
    clearListenTimer()
    recognitionActiveRef.current = false

    const errorPayload = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const rawError =
      typeof errorPayload.error === 'string'
        ? errorPayload.error
        : typeof errorPayload.code === 'string'
          ? errorPayload.code
          : typeof errorPayload.type === 'string'
            ? errorPayload.type
            : ''
    const rawMessage = typeof errorPayload.message === 'string' ? errorPayload.message : ''
    const normalizedError = `${rawError} ${rawMessage}`.toLowerCase()
    const isPermissionError =
      normalizedError.includes('permission') ||
      normalizedError.includes('not-allowed') ||
      normalizedError.includes('service-not-allowed') ||
      normalizedError.includes('audio-capture') ||
      normalizedError.includes('mic') ||
      normalizedError.includes('microphone')

    void fail(
      isPermissionError
        ? 'Microphone permission required. Enable it in Settings.'
        : 'Speech recognition failed. Please try again.'
    )
  })

  useSpeechRecognitionEvent('end', () => {
    if (!recognitionActiveRef.current) {
      return
    }

    recognitionActiveRef.current = false
    clearListenTimer()
    void processTranscript()
  })

  const startListening = useCallback(async () => {
    if (voiceState !== 'idle' && voiceState !== 'error') {
      return
    }

    if (!character) {
      return
    }

    setError(null)
    cancelledRef.current = false
    finalTranscriptionRef.current = ''
    transcriptionRef.current = ''
    setTranscription('')

    if (!character.voice) {
      Alert.alert(
        'No Voice Set',
        'This character has no voice selected. Go to character settings to choose one.',
        [
          { text: 'OK' },
          { text: 'Edit Character', onPress: () => router.push(`/characters/${characterId}/edit`) },
        ],
      )
      return
    }

    if (!isSubscriber && typeof remainingCredits === 'number' && remainingCredits < 2) {
      Alert.alert(
        'Insufficient Credits',
        'Voice replies cost 2 credits. Purchase more or subscribe for unlimited.',
        [
          { text: 'Cancel' },
          { text: 'Get More', onPress: () => router.push('/subscribe') },
        ],
      )
      return
    }

    try {
      if (canUseNativeVoice) {
        const [sttPermission, audioPermission] = await Promise.all([
          ExpoSpeechRecognitionModule.requestPermissionsAsync(),
          requestRecordingPermissionsAsync(),
        ])
        if (!sttPermission.granted || !audioPermission.granted) {
          setError('Microphone permission required. Enable it in Settings.')
          setVoiceState('error')
          return
        }
      } else {
        const sttPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
        if (!sttPermission.granted) {
          setError('Microphone permission required. Allow it in your browser.')
          setVoiceState('error')
          return
        }
      }

      setVoiceState('listening')
      setTranscription('Listening...')
      timerRef.current = setTimeout(() => {
        ExpoSpeechRecognitionModule.stop()
      }, MAX_LISTEN_MS)
      recognitionActiveRef.current = true

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
      })
    } catch (err) {
      clearListenTimer()
      recognitionActiveRef.current = false
      const errorMessage = err instanceof Error ? err.message : 'Failed to start listening'
      await fail(errorMessage)
    }
  }, [canUseNativeVoice, character, characterId, clearListenTimer, fail, isSubscriber, remainingCredits, voiceState])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    recognitionActiveRef.current = false
    clearListenTimer()

    if (voiceState === 'listening' || voiceState === 'transcribing') {
      ExpoSpeechRecognitionModule.stop()
    }

    void cleanupPlayback()
    setTranscription('')
    setReplyText('')
    setError(null)
    setVoiceState('idle')
  }, [cleanupPlayback, clearListenTimer, voiceState])

  useEffect(() => {
    return () => {
      const wasRecognitionActive = recognitionActiveRef.current
      isMountedRef.current = false
      cancelledRef.current = true
      recognitionActiveRef.current = false
      clearListenTimer()
      if (wasRecognitionActive) {
        ExpoSpeechRecognitionModule.stop()
      }
      void cleanupPlayback()
    }
  }, [cleanupPlayback, clearListenTimer])

  return useMemo(
    () => ({
      voiceState,
      transcription,
      replyText,
      error,
      startListening,
      cancel,
    }),
    [voiceState, transcription, replyText, error, startListening, cancel],
  )
}
