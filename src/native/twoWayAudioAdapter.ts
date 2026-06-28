import {
  initialize as moduleInitialize,
  playPCMData,
  toggleRecording,
  requestMicrophonePermissionsAsync,
  addExpoTwoWayAudioEventListener,
  tearDown as moduleTearDown,
  restart,
} from '@speechmatics/expo-two-way-audio'
import { resample24to16 } from '../utils/audioResample'

export interface TwoWayAudioAdapterInterface {
  initialize(): Promise<void>
  startRecording(onChunk: (base64: string) => void): Promise<boolean>
  stopRecording(): void
  playChunk(base64Pcm: string): void
  clearPlaybackQueue(): void
  isPlaying(): boolean
  tearDown(): Promise<void>
}

const BYTES_PER_MS = 32

export class TwoWayAudioAdapter implements TwoWayAudioAdapterInterface {
  private _micSub: { remove: () => void } | null = null
  private _playbackEndTime = 0

  async initialize(): Promise<void> {
    await moduleInitialize()
  }

  async startRecording(onChunk: (base64: string) => void): Promise<boolean> {
    const perm = await requestMicrophonePermissionsAsync()
    if (!perm.granted) return false

    this._micSub = addExpoTwoWayAudioEventListener('onMicrophoneData', (ev) => {
      try {
        let binaryString = ''
        for (let i = 0; i < ev.data.length; i++) {
          binaryString += String.fromCharCode(ev.data[i])
        }
        onChunk(btoa(binaryString))
      } catch (error) {
        console.warn('[TwoWayAudioAdapter] Dropped mic chunk due to encode error:', error)
      }
    })

    toggleRecording(true)
    return true
  }

  stopRecording(): void {
    toggleRecording(false)
    this._micSub?.remove()
    this._micSub = null
  }

  playChunk(base64Pcm: string): void {
    let pcm24: Uint8Array
    try {
      const binary = atob(base64Pcm)
      pcm24 = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) pcm24[i] = binary.charCodeAt(i)
    } catch {
      console.warn('[TwoWayAudioAdapter] malformed base64 chunk — skipping')
      return
    }

    const pcm16 = resample24to16(pcm24)
    const chunkMs = Math.ceil(pcm16.length / BYTES_PER_MS)
    this._playbackEndTime = Math.max(this._playbackEndTime, Date.now()) + chunkMs
    playPCMData(pcm16)
  }

  clearPlaybackQueue(): void {
    this._playbackEndTime = 0
    restart()
  }

  isPlaying(): boolean {
    return Date.now() < this._playbackEndTime
  }

  async tearDown(): Promise<void> {
    this._playbackEndTime = 0
    this._micSub?.remove()
    this._micSub = null
    moduleTearDown()
  }
}
