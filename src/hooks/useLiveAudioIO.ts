import { useCallback, useEffect, useRef, useState } from 'react'
import { TwoWayAudioAdapter } from '~/native/twoWayAudioAdapter'

export type RecordingState = 'idle' | 'recording' | 'error'
export type PlaybackState = 'idle' | 'playing' | 'buffering'

export interface UseLiveAudioIOReturn {
  recordingState: RecordingState
  playbackState: PlaybackState
  error: string | null
  startRecording: () => Promise<boolean>
  stopRecording: () => void
  playChunk: (base64PCM: string) => Promise<void>
  clearPlaybackQueue: () => void
  onAudioChunk: (cb: (chunk: string) => void) => () => void
}

const PLAYBACK_POLL_MS = 50

export function useLiveAudioIO(): UseLiveAudioIOReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [error, setError] = useState<string | null>(null)

  const adapterRef = useRef(new TwoWayAudioAdapter())
  const chunkListenersRef = useRef<Set<(chunk: string) => void>>(new Set())
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPlaybackPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const startPlaybackPoll = useCallback(() => {
    if (pollTimerRef.current !== null) return
    pollTimerRef.current = setInterval(() => {
      if (!adapterRef.current.isPlaying()) {
        setPlaybackState('idle')
        stopPlaybackPoll()
      }
    }, PLAYBACK_POLL_MS)
  }, [stopPlaybackPoll])

  useEffect(() => {
    const adapter = adapterRef.current
    adapter.initialize().catch((err: unknown) => {
      console.warn('[useLiveAudioIO] initialize failed', err)
    })

    return () => {
      stopPlaybackPoll()
      adapter.tearDown().catch(() => {})
    }
  }, [stopPlaybackPoll])

  const startRecording = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current
    if (recordingState === 'recording') return true

    try {
      const ok = await adapter.startRecording((chunk) => {
        chunkListenersRef.current.forEach((cb) => cb(chunk))
      })
      if (!ok) {
        setError('Microphone permission required. Enable in Settings.')
        setRecordingState('error')
        return false
      }
      setError(null)
      setRecordingState('recording')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setRecordingState('error')
      return false
    }
  }, [recordingState])

  const stopRecording = useCallback(() => {
    adapterRef.current.stopRecording()
    setRecordingState('idle')
  }, [])

  const playChunk = useCallback(
    async (base64PCM: string): Promise<void> => {
      adapterRef.current.playChunk(base64PCM)
      setPlaybackState('playing')
      startPlaybackPoll()
    },
    [startPlaybackPoll],
  )

  const clearPlaybackQueue = useCallback(() => {
    adapterRef.current.clearPlaybackQueue()
    stopPlaybackPoll()
    setPlaybackState('idle')
  }, [stopPlaybackPoll])

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
