import {
  initialize as moduleInitialize,
  playPCMData,
  toggleRecording,
  requestMicrophonePermissionsAsync,
  addExpoTwoWayAudioEventListener,
  tearDown as moduleTearDown,
  bargeIn,
} from '../../modules/expo-two-way-audio/src'
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
  // Deduplicates concurrent startRecording() calls. The LATEST caller's
  // onChunk wins (the single mic listener always forwards to it) — a second
  // caller must not silently lose chunks. stopRecording() bumps the
  // generation so a start that was still awaiting permissions aborts instead
  // of bringing the mic live with no owner.
  private _startPromise: Promise<boolean> | null = null
  private _onChunk: ((b64: string) => void) | null = null
  private _startGeneration = 0
  private _playbackEndTime = 0
  private _pcmCarryover = new Uint8Array(0)

  async initialize(): Promise<void> {
    await moduleInitialize()
  }

  startRecording(onChunk: (base64: string) => void): Promise<boolean> {
    this._onChunk = onChunk
    if (this._startPromise) return this._startPromise
    this._startPromise = this._doStartRecording(onChunk).finally(() => {
      this._startPromise = null
    })
    return this._startPromise
  }

  private async _doStartRecording(onChunk: (base64: string) => void): Promise<boolean> {
    if (this._micSub !== null) return true

    const generation = this._startGeneration
    const perm = await requestMicrophonePermissionsAsync()
    if (this._startGeneration !== generation) {
      // stopRecording()/tearDown() ran while the permission prompt was up —
      // do not bring the mic live with no owner.
      return false
    }
    if (!perm.granted) return false

    const micSub = addExpoTwoWayAudioEventListener('onMicrophoneData', (ev) => {
      try {
        let binaryString = ''
        for (let i = 0; i < ev.data.length; i++) {
          binaryString += String.fromCharCode(ev.data[i])
        }
        this._onChunk?.(btoa(binaryString))
      } catch (error) {
        console.warn('[TwoWayAudioAdapter] Dropped mic chunk due to encode error:', error)
      }
    })
    this._micSub = micSub

    try {
      const started = toggleRecording(true)
      if (!started) {
        micSub.remove()
        this._micSub = null
        return false
      }
    } catch (error) {
      micSub.remove()
      this._micSub = null
      throw error
    }
    return true
  }

  stopRecording(): void {
    this._startGeneration += 1
    toggleRecording(false)
    this._micSub?.remove()
    this._micSub = null
  }

  playChunk(base64Pcm: string): void {
    let decoded: Uint8Array
    try {
      const binary = atob(base64Pcm)
      decoded = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i)
    } catch {
      console.warn('[TwoWayAudioAdapter] malformed base64 chunk — skipping')
      return
    }

    let pcm24: Uint8Array
    if (this._pcmCarryover.length > 0) {
      pcm24 = new Uint8Array(this._pcmCarryover.length + decoded.length)
      pcm24.set(this._pcmCarryover)
      pcm24.set(decoded, this._pcmCarryover.length)
      this._pcmCarryover = new Uint8Array(0)
    } else {
      pcm24 = decoded
    }

    const inputSamples = Math.floor(pcm24.length / 2)
    const completeGroups = Math.floor(inputSamples / 3)
    const consumedBytes = completeGroups * 6
    const leftover = pcm24.subarray(consumedBytes)
    if (leftover.length > 0) {
      this._pcmCarryover = new Uint8Array(leftover)
    }

    if (consumedBytes === 0) return

    const pcm16 = resample24to16(pcm24.subarray(0, consumedBytes))
    const chunkMs = Math.ceil(pcm16.length / BYTES_PER_MS)
    this._playbackEndTime = Math.max(this._playbackEndTime, Date.now()) + chunkMs
    playPCMData(pcm16)
  }

  clearPlaybackQueue(): void {
    this._playbackEndTime = 0
    this._pcmCarryover = new Uint8Array(0)
    bargeIn()
  }

  isPlaying(): boolean {
    return Date.now() < this._playbackEndTime
  }

  async tearDown(): Promise<void> {
    this._startGeneration += 1
    this._playbackEndTime = 0
    this._pcmCarryover = new Uint8Array(0)
    this._micSub?.remove()
    this._micSub = null
    moduleTearDown()
  }
}
