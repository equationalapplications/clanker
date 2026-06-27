import { useCallback, useEffect, useRef, useState } from 'react'

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

const TARGET_SAMPLE_RATE = 16000
const CHUNK_DURATION_SEC = 0.02 // 20ms — matches native LiveAudioStream buffer cadence

/** Inlined as Blob URL — bypasses Metro bundler static asset pipeline entirely. */
function buildWorkletProcessorCode(chunkSize: number): string {
  return `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunkSize = ${chunkSize};
    this._buffer = new Int16Array(this._chunkSize);
    this._offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      // Asymmetric multiply matches Int16 range [-32768, 32767]
      this._buffer[this._offset++] = s < 0 ? s * 32768 : s * 32767;
      if (this._offset === this._chunkSize) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(this._chunkSize);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`
}

function closeAudioContextSilently(ctx: AudioContext | null | undefined): void {
  void ctx?.close().catch(() => {
    // Already closed or rejected — teardown should stay silent
  })
}

export function useLiveAudioIO(): UseLiveAudioIOReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [error, setError] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const chunkListenersRef = useRef<Set<(chunk: string) => void>>(new Set())

  // Output pipeline state
  const scheduledNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const nextStartTimeRef = useRef<number>(0)

  const stopRecording = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    workletNodeRef.current?.disconnect()
    sourceNodeRef.current?.disconnect()
    closeAudioContextSilently(audioCtxRef.current)
    streamRef.current = null
    workletNodeRef.current = null
    sourceNodeRef.current = null
    audioCtxRef.current = null
    setRecordingState('idle')
  }, [])

  const clearPlaybackQueue = useCallback(() => {
    scheduledNodesRef.current.forEach((node) => {
      try {
        node.stop()
      } catch {
        // Defensive: node may have already ended naturally
      }
    })
    scheduledNodesRef.current.clear()
    nextStartTimeRef.current = 0
    setPlaybackState('idle')
  }, [])

  // Release all resources on unmount
  useEffect(() => {
    return () => {
      stopRecording()
      clearPlaybackQueue()
    }
  }, [stopRecording, clearPlaybackQueue])

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      if (streamRef.current || audioCtxRef.current) {
        return true
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Microphone access requires a secure connection (HTTPS).')
        setRecordingState('error')
        return false
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
      audioCtxRef.current = audioCtx
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      if (audioCtx.sampleRate !== TARGET_SAMPLE_RATE) {
        setError(
          `Browser did not honor ${TARGET_SAMPLE_RATE}Hz AudioContext sampleRate (got ${audioCtx.sampleRate}Hz).`,
        )
        setRecordingState('error')
        stream.getTracks().forEach((t) => t.stop())
        closeAudioContextSilently(audioCtx)
        streamRef.current = null
        audioCtxRef.current = null
        return false
      }

      // sampleRate is a hint only — size chunks from the context's actual rate so each
      // post is always ~20ms of captured audio regardless of device rate.
      const chunkSize = Math.round(audioCtx.sampleRate * CHUNK_DURATION_SEC)

      const blobUrl = URL.createObjectURL(
        new Blob([buildWorkletProcessorCode(chunkSize)], { type: 'application/javascript' }),
      )
      try {
        await audioCtx.audioWorklet.addModule(blobUrl)
      } catch {
        setError('Browser does not support AudioWorklet. Use Chrome, Firefox, or Safari 15+.')
        setRecordingState('error')
        stream.getTracks().forEach((t) => t.stop())
        closeAudioContextSilently(audioCtx)
        streamRef.current = null
        audioCtxRef.current = null
        return false
      } finally {
        URL.revokeObjectURL(blobUrl)
      }

      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor')
      workletNodeRef.current = workletNode

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const int16 = new Int16Array(event.data)
        // Spread is safe for 20ms chunks (≤~2 KB at 48kHz), well under call-stack limits
        const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)))
        chunkListenersRef.current.forEach((cb) => cb(base64))
      }

      const sourceNode = audioCtx.createMediaStreamSource(stream)
      sourceNodeRef.current = sourceNode
      sourceNode.connect(workletNode)
      // Must connect worklet to destination — Web Audio graph only pulls audio through
      // nodes that have a path to AudioDestinationNode. The worklet outputs silence.
      workletNode.connect(audioCtx.destination)

      setError(null)
      setRecordingState('recording')
      return true
    } catch (err) {
      stopRecording()
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      const isPermission =
        msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
      setError(isPermission ? 'Microphone permission required.' : msg)
      setRecordingState('error')
      return false
    }
  }, [stopRecording])

  const playChunk = useCallback(async (base64PCM: string): Promise<void> => {
    const audioCtx = audioCtxRef.current
    if (!audioCtx) return

    try {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      const binary = atob(base64PCM)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const int16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(int16.length)
      // Divide by 32768.0 (not 32767) — guarantees Float32 stays in [-1.0, 1.0]
      // because Int16 min is -32768 and dividing by 32767 would yield ~-1.00003
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0

      const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000)
      audioBuffer.getChannelData(0).set(float32)

      const node = audioCtx.createBufferSource()
      node.buffer = audioBuffer
      node.connect(audioCtx.destination)

      // Clamp to current time — prevents scheduling in the past if tool execution
      // or network jitter caused a gap between chunks
      if (nextStartTimeRef.current < audioCtx.currentTime) {
        nextStartTimeRef.current = audioCtx.currentTime
      }
      node.start(nextStartTimeRef.current)
      nextStartTimeRef.current += audioBuffer.duration

      scheduledNodesRef.current.add(node)
      node.onended = () => {
        // Remove from set to prevent memory leak across long sessions
        scheduledNodesRef.current.delete(node)
        if (scheduledNodesRef.current.size === 0) {
          setPlaybackState('idle')
        }
      }

      setPlaybackState('playing')
    } catch (err) {
      // Malformed base64 or decode error: skip the chunk rather than crashing the session.
      // A dropped 20ms chunk sounds like a faint pop; a crashed socket destroys the call.
      console.warn('[useLiveAudioIO.web] playChunk error — skipping chunk', err)
    }
  }, [])

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
