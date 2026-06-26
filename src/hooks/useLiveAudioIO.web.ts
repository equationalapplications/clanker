import { useCallback, useState } from 'react'

export type RecordingState = 'idle' | 'recording' | 'error'
export type PlaybackState = 'idle' | 'playing' | 'buffering'

/** Audio I/O state and controls for live PCM streaming and chunked playback. */
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

const WEB_UNSUPPORTED = 'Live voice is not supported on web.'

/** Web stub — live PCM I/O requires native modules. */
export function useLiveAudioIO(): UseLiveAudioIOReturn {
  const [error] = useState<string | null>(WEB_UNSUPPORTED)

  const noopUnsubscribe = useCallback(() => {}, [])

  const startRecording = useCallback(async () => false, [])
  const stopRecording = useCallback(() => {}, [])
  const playChunk = useCallback(async () => {}, [])
  const clearPlaybackQueue = useCallback(() => {}, [])
  const onAudioChunk = useCallback(() => noopUnsubscribe, [noopUnsubscribe])

  return {
    recordingState: 'idle',
    playbackState: 'idle',
    error,
    startRecording,
    stopRecording,
    playChunk,
    clearPlaybackQueue,
    onAudioChunk,
  }
}
