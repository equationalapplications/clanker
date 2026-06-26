import { useCallback, useEffect, useRef, useState } from 'react'
import { requestRecordingPermissionsAsync, setAudioModeAsync, createAudioPlayer } from 'expo-audio'
import LiveAudioStream from 'react-native-live-audio-stream'

export type RecordingState = 'idle' | 'recording' | 'error'
export type PlaybackState = 'idle' | 'playing' | 'buffering'

/** Audio I/O state and controls for live PCM streaming and chunked playback. */
export interface UseLiveAudioIOReturn {
  recordingState: RecordingState
  playbackState: PlaybackState
  error: string | null
  /** Requests mic permission, initialises LiveAudioStream, and starts recording. Returns true on success. */
  startRecording: () => Promise<boolean>
  stopRecording: () => void
  playChunk: (base64PCM: string) => Promise<void>
  clearPlaybackQueue: () => void
  onAudioChunk: (cb: (chunk: string) => void) => () => void
}

const PCM_SAMPLE_RATE = 16000
const PCM_CHANNELS = 1
const PCM_BITS_PER_SAMPLE = 16

/** Manages 16 kHz PCM mic input via LiveAudioStream and 24 kHz chunked PCM playback via expo-audio. */
export function useLiveAudioIO(): UseLiveAudioIOReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [error, setError] = useState<string | null>(null)

  const chunkListenersRef = useRef<Set<(chunk: string) => void>>(new Set())
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null)
  const playbackQueueRef = useRef<string[]>([])
  const isPlayingRef = useRef(false)

  const releasePlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.release()
      playerRef.current = null
    }
    isPlayingRef.current = false
    playbackQueueRef.current = []
    setPlaybackState('idle')
  }, [])

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch((err: unknown) => {
      console.warn('[useLiveAudioIO] setAudioModeAsync failed', err)
    })

    LiveAudioStream.on('data', (data: string) => {
      chunkListenersRef.current.forEach((cb) => cb(data))
    })

    return () => {
      LiveAudioStream.stop()
      releasePlayer()
    }
  }, [releasePlayer])

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted) {
        setError('Microphone permission required. Enable in Settings.')
        setRecordingState('error')
        return false
      }
      LiveAudioStream.init({
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        bitsPerSample: PCM_BITS_PER_SAMPLE,
        audioSource: 6, // MIC on Android
        bufferSize: 4096,
        wavFile: '',
      })
      LiveAudioStream.start()
      setError(null)
      setRecordingState('recording')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setRecordingState('error')
      return false
    }
  }, [])

  const stopRecording = useCallback(() => {
    LiveAudioStream.stop()
    setRecordingState('idle')
  }, [])

  const playNextRef = useRef<() => void>(() => {})

  useEffect(() => {
    playNextRef.current = () => {
      if (playbackQueueRef.current.length === 0) {
        isPlayingRef.current = false
        setPlaybackState('idle')
        return
      }

      const next = playbackQueueRef.current.shift()!
      const dataUri = `data:audio/pcm;rate=24000;encoding=signed-integer;bits=16;base64,${next}`
      const player = createAudioPlayer({ uri: dataUri })
      playerRef.current = player
      isPlayingRef.current = true
      setPlaybackState('playing')

      player.addListener('playbackStatusUpdate', (status) => {
        if (status?.didJustFinish) {
          player.release()
          if (playerRef.current === player) {
            playerRef.current = null
          }
          playNextRef.current()
        }
      })

      void player.play()
    }
  }, [])

  const drainQueue = useCallback(() => {
    playNextRef.current()
  }, [])

  const playChunk = useCallback(
    async (base64PCM: string) => {
      playbackQueueRef.current.push(base64PCM)
      if (!isPlayingRef.current) {
        drainQueue()
      }
    },
    [drainQueue],
  )

  const clearPlaybackQueue = useCallback(() => {
    playbackQueueRef.current = []
    releasePlayer()
  }, [releasePlayer])

  const onAudioChunk = useCallback((cb: (chunk: string) => void) => {
    chunkListenersRef.current.add(cb)
    return () => {
      chunkListenersRef.current.delete(cb)
    }
  }, [])

  return {
    recordingState,
    playbackState,
    error,
    startRecording,
    stopRecording,
    playChunk,
    clearPlaybackQueue,
    onAudioChunk,
  }
}
