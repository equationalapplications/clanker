# Native Live Voice Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `expo-audio` per-chunk playback and `react-native-live-audio-stream` mic with `@speechmatics/expo-two-way-audio` for gapless PCM playback and hardware AEC in a single unified duplex native module.

**Architecture:** A `TwoWayAudioAdapter` class (`src/native/twoWayAudioAdapter.ts`) wraps the stock Speechmatics module and handles 24→16 kHz resampling and base64 encode/decode; `useLiveAudioIO.ts` imports only the adapter, preserving `UseLiveAudioIOReturn` unchanged. Playback state tracks via JS byte-count timer (module has no `isPlaying()` or `stopPlayback()` — use `restart()` for barge-in).

**Tech Stack:** `@speechmatics/expo-two-way-audio@0.1.2` (MIT, stock), TypeScript, Jest (unit, no device), Expo SDK 56, EAS dev client rebuild required.

---

## Module API Reference

`@speechmatics/expo-two-way-audio` exports (verified from GitHub source):

```typescript
// core.ts
initialize(): Promise<void>
playPCMData(audioData: Uint8Array): void          // NO sample rate param
toggleRecording(val: boolean): boolean             // true=start, false=stop
isRecording(): boolean
tearDown(): void
restart(): void                                    // use for barge-in clear
requestMicrophonePermissionsAsync(): Promise<PermissionResponse>
getMicrophonePermissionsAsync(): Promise<PermissionResponse>

// events.ts — onMicrophoneData delivers Uint8Array (NOT base64)
addExpoTwoWayAudioEventListener('onMicrophoneData', (ev: { data: Uint8Array }) => void)
addExpoTwoWayAudioEventListener('onRecordingChange', (ev: { data: boolean }) => void)
addExpoTwoWayAudioEventListener('onAudioInterruption', (ev: { data: string }) => void)

// hooks.ts
useExpoTwoWayAudioEventListener(eventName, listener)
useMicrophonePermissions()
```

**Critical divergences from spec pseudocode:**
- `playPCMData` takes `Uint8Array` only — no sample rate argument
- No `isPlaying()` — adapter implements with byte-count timer
- No `stopPlayback()` — `restart()` used for barge-in/clear
- Mic data is `Uint8Array`, not base64 — adapter converts with `btoa`

**Playback state contract:** The stock module has no `isPlaying()` or `stopPlayback()`. `TwoWayAudioAdapter.isPlaying()` is implemented via a JS byte-count timer (`_playbackEndTime`). `useLiveAudioIO` polls `adapter.isPlaying()` to derive `playbackState`. Barge-in uses `restart()`, not `stopPlayback()`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/native/twoWayAudioAdapter.ts` | **Create** | Wraps stock module; atob decode + resample; btoa encode mic; byte-count `isPlaying` |
| `src/utils/audioResample.ts` | **Create** | Pure `resample24to16(Uint8Array): Uint8Array` — no deps |
| `src/hooks/useLiveAudioIO.ts` | **Modify** | Swap LiveAudioStream + expo-audio for adapter; remove `setAudioModeAsync` |
| `__tests__/audioResample.test.ts` | **Create** | Unit tests for resample (Jest, no device) |
| `__tests__/twoWayAudioAdapter.test.ts` | **Create** | Unit tests for adapter (mock module) |
| `__tests__/useLiveAudioIO.test.tsx` | **Modify** | Replace LiveAudioStream + expo-audio mocks with adapter mock |
| `app.config.ts` | **Modify** | Add `@speechmatics/expo-two-way-audio` plugin; remove `expo-audio` mic config |
| `package.json` | **Modify** | Add speechmatics pkg; remove `react-native-live-audio-stream` (after spike) |
| `docs/real-time-voice-chat.md` | **Modify** | Document unified duplex module, rebuild requirement |

**Unchanged:** `useLiveAudioIO.web.ts`, `useLiveVoiceChat.ts`, `liveVoiceMachine.ts`, talk UI, `UseLiveAudioIOReturn` type.

---

## Task 0: AEC Spike — P0 Gate (MUST PASS BEFORE TASK 1)

**This is a blocking gate.** Do not begin Task 1 until AEC passes on both platforms.

**Files:**
- Create: `src/native/aecSpike.ts` (temp — delete after spike)
- Modify: `package.json` (add speechmatics)

- [ ] **Step 0.1: Verify license**

```bash
npm info @speechmatics/expo-two-way-audio license
```

Expected output: `MIT`

- [ ] **Step 0.2: Install package**

```bash
npx expo install @speechmatics/expo-two-way-audio
```

Verify in `package.json`:
```json
"@speechmatics/expo-two-way-audio": "~0.1.2"
```

- [ ] **Step 0.3: Create spike sandbox**

Create `src/native/aecSpike.ts`:

```typescript
import {
  initialize,
  playPCMData,
  toggleRecording,
  requestMicrophonePermissionsAsync,
  addExpoTwoWayAudioEventListener,
  tearDown,
} from '@speechmatics/expo-two-way-audio'
import { resample24to16 } from '../utils/audioResample'

// Temporary spike: verifies unified duplex + AEC on device.
// Import and call runAecSpike() from a dev screen or Talk screen temporarily.
// Delete this file after spike passes.

export async function runAecSpike(base64Chunks: string[], onLog: (msg: string) => void): Promise<void> {
  onLog('[AEC Spike] initializing...')
  await initialize()

  const perm = await requestMicrophonePermissionsAsync()
  if (!perm.granted) {
    onLog('[AEC Spike] mic permission denied')
    return
  }

  const sub = addExpoTwoWayAudioEventListener('onMicrophoneData', (ev) => {
    onLog(`[AEC Spike] mic chunk ${ev.data.length} bytes`)
  })

  toggleRecording(true)
  onLog('[AEC Spike] recording started — playing chunks...')

  for (const base64 of base64Chunks) {
    const binary = atob(base64)
    const pcm24 = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) pcm24[i] = binary.charCodeAt(i)
    const pcm16 = resample24to16(pcm24)
    playPCMData(pcm16)
    await new Promise((r) => setTimeout(r, 40))
  }

  await new Promise((r) => setTimeout(r, 2000))
  toggleRecording(false)
  sub.remove()
  tearDown()
  onLog('[AEC Spike] done — check for echo in mic log above')
}
```

Note: `audioResample.ts` (Task 1) must exist before the spike can run. Create a stub first:

```typescript
// src/utils/audioResample.ts — STUB for spike only, replace in Task 1
export function resample24to16(pcm24: Uint8Array): Uint8Array {
  const inputSamples = Math.floor(pcm24.length / 2)
  const groups = Math.floor(inputSamples / 3)
  const out = new Uint8Array(groups * 4)
  for (let g = 0; g < groups; g++) {
    out[g * 4] = pcm24[g * 6]
    out[g * 4 + 1] = pcm24[g * 6 + 1]
    out[g * 4 + 2] = pcm24[g * 6 + 2]
    out[g * 4 + 3] = pcm24[g * 6 + 3]
  }
  return out
}
```

- [ ] **Step 0.4: Temporarily call spike from Talk screen**

In `app/(drawer)/(tabs)/talk/index.tsx`, add temporarily at the bottom of the component (inside `__DEV__` guard):

```tsx
// TEMP AEC SPIKE — remove after validation
import { runAecSpike } from '~/native/aecSpike'
// In component body:
React.useEffect(() => {
  if (!__DEV__) return
  // Pass real base64 chunks from a 30s Gemini session recording, or use synthetic sine chunks
}, [])
```

Alternatively: call `runAecSpike` from a button in the Talk dev UI if one exists.

- [ ] **Step 0.5: Rebuild dev client**

```bash
eas build --profile development --platform android --local
# or for iOS:
eas build --profile development --platform ios --local
```

Install rebuilt dev client on physical device.

- [ ] **Step 0.6: Run AEC echo test on Android physical device (speakerphone)**

Procedure:
1. Open Talk tab with dev client on Android physical device
2. Set volume to ~70%
3. Run spike with at least 30 s of known Gemini audio chunks
4. Remain **silent** during playback
5. Watch mic log output from `onLog`

**Pass:** No echo chunks in mic log correlating with playback; no phantom user turns
**Fail:** Mic log shows heavy byte bursts synchronized with speaker output

- [ ] **Step 0.7: Run AEC echo test on iOS physical device (speakerphone)**

Same procedure as Step 0.6 on iOS. Silent mode switch should not silence output.

- [ ] **Step 0.8: Gate decision**

If **both pass:** delete `src/native/aecSpike.ts`, remove the Talk screen debug hook. Proceed to Task 1.

If **either fails:** Do NOT remove `react-native-live-audio-stream`. Evaluate Option C (24 kHz fork of expo-two-way-audio — see spec §7). Stop this plan and raise with team before continuing.

---

## Task 1: audioResample.ts (TDD)

**Files:**
- Create: `src/utils/audioResample.ts`
- Create: `__tests__/audioResample.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `__tests__/audioResample.test.ts`:

```typescript
import { resample24to16 } from '~/utils/audioResample'

function makePcm24Sine(samples: number): Uint8Array {
  const out = new Uint8Array(samples * 2)
  for (let i = 0; i < samples; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 16000)
    const u16 = val < 0 ? val + 0x10000 : val
    out[i * 2] = u16 & 0xff
    out[i * 2 + 1] = (u16 >> 8) & 0xff
  }
  return out
}

function makeSilence(samples: number): Uint8Array {
  return new Uint8Array(samples * 2)
}

describe('resample24to16', () => {
  test('1ms of 24kHz sine (48 samples) → 32 output samples (64 bytes)', () => {
    const input = makePcm24Sine(48)
    const output = resample24to16(input)
    expect(output.length).toBe(64)
  })

  test('output sample count = floor(inputSamples / 3) * 2', () => {
    // 99 input samples → floor(99/3)*2 = 66 output samples = 132 bytes
    const input = makePcm24Sine(99)
    const output = resample24to16(input)
    expect(output.length).toBe(132)
  })

  test('silence in → silence out (no DC offset)', () => {
    const input = makeSilence(48)
    const output = resample24to16(input)
    expect(output.every((b) => b === 0)).toBe(true)
  })

  test('odd-length input (incomplete sample) does not throw', () => {
    const input = new Uint8Array(7) // 3.5 samples — ignore last half-sample
    expect(() => resample24to16(input)).not.toThrow()
  })

  test('input with 0 samples returns empty Uint8Array', () => {
    expect(resample24to16(new Uint8Array(0)).length).toBe(0)
  })

  test('output sample 0 equals input sample 0 (pass-through for first of each group)', () => {
    // Build input with distinct sample values
    const input = new Uint8Array(6) // 3 samples
    // sample 0 = 1000 (0x03E8 LE)
    input[0] = 0xe8
    input[1] = 0x03
    // sample 1 = 2000 (0x07D0 LE)
    input[2] = 0xd0
    input[3] = 0x07
    // sample 2 = 4000 (0x0FA0 LE)
    input[4] = 0xa0
    input[5] = 0x0f
    const output = resample24to16(input) // 2 samples → 4 bytes
    // out[0] = in[0] = 1000
    const out0 = output[0] | (output[1] << 8)
    expect(out0).toBe(1000)
    // out[1] = round((2000 + 4000) / 2) = 3000
    const out1 = output[2] | (output[3] << 8)
    expect(out1).toBe(3000)
  })

  test('negative sample values preserved correctly (16-bit signed LE)', () => {
    const input = new Uint8Array(6)
    // sample 0 = -1000 → 0xFC18 LE
    const u0 = -1000 + 0x10000
    input[0] = u0 & 0xff
    input[1] = (u0 >> 8) & 0xff
    // sample 1 = -2000 → 0xF830 LE
    const u1 = -2000 + 0x10000
    input[2] = u1 & 0xff
    input[3] = (u1 >> 8) & 0xff
    // sample 2 = -4000
    const u2 = -4000 + 0x10000
    input[4] = u2 & 0xff
    input[5] = (u2 >> 8) & 0xff

    const output = resample24to16(input)
    // out[0] = -1000
    const raw0 = output[0] | (output[1] << 8)
    const signed0 = raw0 >= 0x8000 ? raw0 - 0x10000 : raw0
    expect(signed0).toBe(-1000)
    // out[1] = round((-2000 + -4000) / 2) = -3000
    const raw1 = output[2] | (output[3] << 8)
    const signed1 = raw1 >= 0x8000 ? raw1 - 0x10000 : raw1
    expect(signed1).toBe(-3000)
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
npx jest __tests__/audioResample.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '~/utils/audioResample'"

- [ ] **Step 1.3: Implement audioResample.ts**

Create `src/utils/audioResample.ts`:

```typescript
export function resample24to16(pcm24: Uint8Array): Uint8Array {
  const inputSamples = Math.floor(pcm24.length / 2)
  const groups = Math.floor(inputSamples / 3)
  const out = new Uint8Array(groups * 4) // 2 output samples * 2 bytes each

  let outIdx = 0
  for (let g = 0; g < groups; g++) {
    const base = g * 3
    const s0 = readSample(pcm24, base)
    const s1 = readSample(pcm24, base + 1)
    const s2 = readSample(pcm24, base + 2)
    writeSample(out, outIdx++, s0)
    writeSample(out, outIdx++, Math.round((s1 + s2) / 2))
  }

  return out
}

function readSample(pcm: Uint8Array, i: number): number {
  const u16 = pcm[i * 2] | (pcm[i * 2 + 1] << 8)
  return u16 >= 0x8000 ? u16 - 0x10000 : u16
}

function writeSample(out: Uint8Array, i: number, val: number): void {
  const clamped = Math.max(-32768, Math.min(32767, val))
  const u16 = clamped < 0 ? clamped + 0x10000 : clamped
  out[i * 2] = u16 & 0xff
  out[i * 2 + 1] = (u16 >> 8) & 0xff
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
npx jest __tests__/audioResample.test.ts --no-coverage
```

Expected: PASS — all 7 tests pass

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/audioResample.ts __tests__/audioResample.test.ts
git commit -m "feat(voice): add resample24to16 utility for 24→16kHz PCM downsampling"
```

---

## Task 2: TwoWayAudioAdapter (TDD)

**Files:**
- Create: `src/native/twoWayAudioAdapter.ts`
- Create: `__tests__/twoWayAudioAdapter.test.ts`

- [ ] **Step 2.1: Write failing adapter tests**

Create `__tests__/twoWayAudioAdapter.test.ts`:

```typescript
const mockInitialize = jest.fn()
const mockPlayPCMData = jest.fn()
const mockToggleRecording = jest.fn()
const mockRequestMicPermissions = jest.fn()
const mockAddEventListener = jest.fn()
const mockTearDown = jest.fn()
const mockRestart = jest.fn()

jest.mock('@speechmatics/expo-two-way-audio', () => ({
  initialize: (...a: unknown[]) => mockInitialize(...a),
  playPCMData: (...a: unknown[]) => mockPlayPCMData(...a),
  toggleRecording: (...a: unknown[]) => mockToggleRecording(...a),
  requestMicrophonePermissionsAsync: (...a: unknown[]) => mockRequestMicPermissions(...a),
  addExpoTwoWayAudioEventListener: (...a: unknown[]) => mockAddEventListener(...a),
  tearDown: (...a: unknown[]) => mockTearDown(...a),
  restart: (...a: unknown[]) => mockRestart(...a),
}))

jest.mock('~/utils/audioResample', () => ({
  resample24to16: (input: Uint8Array) => input.subarray(0, Math.floor(input.length * 2 / 3)),
}))

import { TwoWayAudioAdapter } from '~/native/twoWayAudioAdapter'

describe('TwoWayAudioAdapter', () => {
  let adapter: TwoWayAudioAdapter

  beforeEach(() => {
    jest.clearAllMocks()
    mockInitialize.mockResolvedValue(undefined)
    mockTearDown.mockReturnValue(undefined)
    mockRestart.mockReturnValue(undefined)
    mockToggleRecording.mockReturnValue(true)
    mockRequestMicPermissions.mockResolvedValue({ granted: true })
    mockAddEventListener.mockReturnValue({ remove: jest.fn() })
    adapter = new TwoWayAudioAdapter()
  })

  test('initialize() calls module initialize', async () => {
    await adapter.initialize()
    expect(mockInitialize).toHaveBeenCalledTimes(1)
  })

  test('startRecording requests permissions before toggling recording', async () => {
    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)
    expect(mockRequestMicPermissions).toHaveBeenCalled()
    expect(mockToggleRecording).toHaveBeenCalledWith(true)
  })

  test('startRecording returns false when permission denied', async () => {
    mockRequestMicPermissions.mockResolvedValue({ granted: false })
    const result = await adapter.startRecording(jest.fn())
    expect(result).toBe(false)
    expect(mockToggleRecording).not.toHaveBeenCalled()
  })

  test('startRecording returns true on success', async () => {
    const result = await adapter.startRecording(jest.fn())
    expect(result).toBe(true)
  })

  test('startRecording registers onMicrophoneData listener', async () => {
    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)
    expect(mockAddEventListener).toHaveBeenCalledWith('onMicrophoneData', expect.any(Function))
  })

  test('mic listener converts Uint8Array to base64 and calls onChunk', async () => {
    let micListener: ((ev: { data: Uint8Array }) => void) | null = null
    mockAddEventListener.mockImplementation((event, cb) => {
      if (event === 'onMicrophoneData') micListener = cb
      return { remove: jest.fn() }
    })

    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)

    const testData = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    micListener!({ data: testData })

    expect(onChunk).toHaveBeenCalledTimes(1)
    const b64 = onChunk.mock.calls[0][0]
    expect(typeof b64).toBe('string')
    // Verify round-trip: base64 decodes back to original bytes
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(testData))
  })

  test('stopRecording calls toggleRecording(false) and removes mic listener', async () => {
    const removeMock = jest.fn()
    mockAddEventListener.mockReturnValue({ remove: removeMock })
    await adapter.startRecording(jest.fn())
    adapter.stopRecording()
    expect(mockToggleRecording).toHaveBeenCalledWith(false)
    expect(removeMock).toHaveBeenCalled()
  })

  test('playChunk decodes base64, resamples, and calls playPCMData', () => {
    const raw = new Uint8Array([0, 1, 2, 3, 4, 5]) // 3 samples at 24kHz
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    expect(mockPlayPCMData).toHaveBeenCalledTimes(1)
    const arg = mockPlayPCMData.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Uint8Array)
  })

  test('playChunk with malformed base64 does not throw and does not call playPCMData', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => adapter.playChunk('not!!valid!!base64!!')).not.toThrow()
    expect(mockPlayPCMData).not.toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })

  test('clearPlaybackQueue calls restart()', () => {
    adapter.clearPlaybackQueue()
    expect(mockRestart).toHaveBeenCalled()
  })

  test('isPlaying() returns false initially', () => {
    expect(adapter.isPlaying()).toBe(false)
  })

  test('isPlaying() returns true immediately after playChunk', () => {
    const raw = new Uint8Array(64) // some bytes
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    expect(adapter.isPlaying()).toBe(true)
  })

  test('isPlaying() returns false after clearPlaybackQueue', () => {
    const raw = new Uint8Array(64)
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    adapter.clearPlaybackQueue()
    expect(adapter.isPlaying()).toBe(false)
  })

  test('tearDown calls module tearDown', async () => {
    await adapter.tearDown()
    expect(mockTearDown).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
npx jest __tests__/twoWayAudioAdapter.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '~/native/twoWayAudioAdapter'"

- [ ] **Step 2.3: Create src/native/ directory and implement adapter**

```bash
mkdir -p src/native
```

Create `src/native/twoWayAudioAdapter.ts`:

```typescript
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

// At 16kHz 16-bit mono: 32000 bytes/sec = 32 bytes/ms
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
        const b64 = btoa(String.fromCharCode(...ev.data))
        onChunk(b64)
      } catch {
        // empty chunk or encode failure — skip silently
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
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npx jest __tests__/twoWayAudioAdapter.test.ts --no-coverage
```

Expected: PASS — all tests pass

- [ ] **Step 2.5: Commit**

```bash
git add src/native/twoWayAudioAdapter.ts __tests__/twoWayAudioAdapter.test.ts
git commit -m "feat(voice): add TwoWayAudioAdapter wrapping expo-two-way-audio with resample"
```

---

## Task 3: Refactor useLiveAudioIO.ts (TDD)

**Files:**
- Modify: `__tests__/useLiveAudioIO.test.tsx`
- Modify: `src/hooks/useLiveAudioIO.ts`

- [ ] **Step 3.1: Replace test file mocks**

Replace `__tests__/useLiveAudioIO.test.tsx` entirely:

```typescript
import React from 'react'
import { act, create } from 'react-test-renderer'

const mockInitialize = jest.fn()
const mockStartRecording = jest.fn()
const mockStopRecording = jest.fn()
const mockPlayChunk = jest.fn()
const mockClearPlaybackQueue = jest.fn()
const mockIsPlaying = jest.fn()
const mockTearDown = jest.fn()

let capturedOnChunk: ((base64: string) => void) | null = null

jest.mock('~/native/twoWayAudioAdapter', () => ({
  TwoWayAudioAdapter: jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    startRecording: (cb: (base64: string) => void) => {
      capturedOnChunk = cb
      return mockStartRecording(cb)
    },
    stopRecording: mockStopRecording,
    playChunk: mockPlayChunk,
    clearPlaybackQueue: mockClearPlaybackQueue,
    isPlaying: mockIsPlaying,
    tearDown: mockTearDown,
  })),
}))

import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'

let hookRef: ReturnType<typeof useLiveAudioIO>

function TestHarness() {
  hookRef = useLiveAudioIO()
  return null
}

describe('useLiveAudioIO', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedOnChunk = null
    mockInitialize.mockResolvedValue(undefined)
    mockStartRecording.mockResolvedValue(true)
    mockStopRecording.mockReturnValue(undefined)
    mockPlayChunk.mockReturnValue(undefined)
    mockClearPlaybackQueue.mockReturnValue(undefined)
    mockIsPlaying.mockReturnValue(false)
    mockTearDown.mockResolvedValue(undefined)
  })

  test('mounts: adapter.initialize() called on mount', async () => {
    await act(async () => {
      create(<TestHarness />)
    })
    expect(mockInitialize).toHaveBeenCalledTimes(1)
  })

  test('startRecording calls adapter.startRecording and sets recordingState', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(mockStartRecording).toHaveBeenCalled()
    expect(hookRef.recordingState).toBe('recording')
  })

  test('startRecording with denied permission sets error state', async () => {
    mockStartRecording.mockResolvedValue(false)

    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(hookRef.recordingState).toBe('error')
    expect(hookRef.error).toMatch(/permission/i)
  })

  test('onAudioChunk fires when adapter emits mic data', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    const received: string[] = []
    hookRef.onAudioChunk((chunk) => received.push(chunk))

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      capturedOnChunk?.('base64audiodata')
    })

    expect(received).toEqual(['base64audiodata'])
  })

  test('onAudioChunk fan-out: multiple subscribers all receive chunks', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    const received1: string[] = []
    const received2: string[] = []
    hookRef.onAudioChunk((c) => received1.push(c))
    hookRef.onAudioChunk((c) => received2.push(c))

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      capturedOnChunk?.('chunk1')
    })

    expect(received1).toEqual(['chunk1'])
    expect(received2).toEqual(['chunk1'])
  })

  test('onAudioChunk returns unsubscribe function', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    const received: string[] = []
    const unsub = hookRef.onAudioChunk((c) => received.push(c))
    unsub()

    act(() => {
      capturedOnChunk?.('after-unsub')
    })

    expect(received).toEqual([])
  })

  test('playChunk forwards base64 to adapter and sets playbackState playing', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    expect(mockPlayChunk).toHaveBeenCalledWith('abc123')
    expect(hookRef.playbackState).toBe('playing')
  })

  test('playbackState returns idle when adapter.isPlaying() becomes false (natural drain)', async () => {
    jest.useFakeTimers()
    mockIsPlaying.mockReturnValue(true)

    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    expect(hookRef.playbackState).toBe('playing')

    // Simulate playback draining
    mockIsPlaying.mockReturnValue(false)

    await act(async () => {
      jest.advanceTimersByTime(100) // poll fires at 50ms
    })

    expect(hookRef.playbackState).toBe('idle')
    jest.useRealTimers()
  })

  test('clearPlaybackQueue calls adapter clear and sets playbackState idle', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    act(() => {
      hookRef.clearPlaybackQueue()
    })

    expect(mockClearPlaybackQueue).toHaveBeenCalled()
    expect(hookRef.playbackState).toBe('idle')
  })

  test('stopRecording calls adapter.stopRecording and sets recordingState idle', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      hookRef.stopRecording()
    })

    expect(mockStopRecording).toHaveBeenCalled()
    expect(hookRef.recordingState).toBe('idle')
  })

  test('unmount calls adapter.tearDown()', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<TestHarness />)
    })

    await act(async () => {
      renderer.unmount()
    })

    expect(mockTearDown).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3.2: Run updated tests to verify they fail**

```bash
npx jest __tests__/useLiveAudioIO.test.tsx --no-coverage
```

Expected: FAIL — tests fail because hook still uses old LiveAudioStream imports

- [ ] **Step 3.3: Rewrite useLiveAudioIO.ts**

Replace `src/hooks/useLiveAudioIO.ts` entirely:

```typescript
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

  const adapterRef = useRef<TwoWayAudioAdapter | null>(null)
  const chunkListenersRef = useRef<Set<(chunk: string) => void>>(new Set())
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  if (!adapterRef.current) {
    adapterRef.current = new TwoWayAudioAdapter()
  }

  const stopPlaybackPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const startPlaybackPoll = useCallback(() => {
    if (pollTimerRef.current !== null) return
    pollTimerRef.current = setInterval(() => {
      if (!adapterRef.current?.isPlaying()) {
        setPlaybackState('idle')
        stopPlaybackPoll()
      }
    }, PLAYBACK_POLL_MS)
  }, [stopPlaybackPoll])

  useEffect(() => {
    adapterRef.current!.initialize().catch((err: unknown) => {
      console.warn('[useLiveAudioIO] initialize failed', err)
    })

    return () => {
      stopPlaybackPoll()
      adapterRef.current!.tearDown().catch(() => {})
    }
  }, [stopPlaybackPoll])

  const startRecording = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current!
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
  }, [])

  const stopRecording = useCallback(() => {
    adapterRef.current!.stopRecording()
    setRecordingState('idle')
  }, [])

  const playChunk = useCallback(async (base64PCM: string): Promise<void> => {
    adapterRef.current!.playChunk(base64PCM)
    setPlaybackState('playing')
    startPlaybackPoll()
  }, [startPlaybackPoll])

  const clearPlaybackQueue = useCallback(() => {
    adapterRef.current!.clearPlaybackQueue()
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
```

- [ ] **Step 3.4: Run updated tests to verify they pass**

```bash
npx jest __tests__/useLiveAudioIO.test.tsx --no-coverage
```

Expected: PASS — all tests pass

- [ ] **Step 3.5: Run full regression**

```bash
npx jest __tests__/liveVoiceMachine.test.ts __tests__/useLiveAudioIO.test.tsx __tests__/useLiveVoiceChat.test.tsx __tests__/audioResample.test.ts __tests__/twoWayAudioAdapter.test.ts --no-coverage
```

Expected: all pass

- [ ] **Step 3.6: Commit**

```bash
git add src/hooks/useLiveAudioIO.ts __tests__/useLiveAudioIO.test.tsx
git commit -m "feat(voice): refactor useLiveAudioIO to use TwoWayAudioAdapter for unified duplex AEC"
```

---

## Task 4: Build Config + Dependency Cleanup

**Files:**
- Modify: `app.config.ts`
- Modify: `package.json`

- [ ] **Step 4.1: Add @speechmatics/expo-two-way-audio plugin to app.config.ts**

In `app.config.ts`, locate the `plugins` array (line ~168). Add the speechmatics plugin after `expo-audio`:

```typescript
// Add after the expo-audio plugin block:
'@speechmatics/expo-two-way-audio',
```

Verify this is correct by checking if the package ships a plugin:

```bash
node -e "const p = require('./node_modules/@speechmatics/expo-two-way-audio/package.json'); console.log(p['expo-module-config'] || p.main)"
```

If the package has no Expo plugin (auto-links via expo-modules-core), skip the plugin entry — the module auto-links at build time via the Expo SDK 56 autolinking system.

- [ ] **Step 4.2: Remove react-native-live-audio-stream from package.json**

```bash
npm uninstall react-native-live-audio-stream
```

Verify it's gone from `package.json`:

```bash
grep "react-native-live-audio-stream" package.json
```

Expected: no output

- [ ] **Step 4.3: Verify @speechmatics/expo-two-way-audio is in package.json**

```bash
grep "@speechmatics/expo-two-way-audio" package.json
```

Expected: `"@speechmatics/expo-two-way-audio": "~0.1.2"` (or similar)

- [ ] **Step 4.4: Evaluate expo-audio retention**

Check if any remaining code (outside of the old useLiveAudioIO.ts) still imports expo-audio:

```bash
grep -rn "from 'expo-audio'\|from \"expo-audio\"" src/ app/ --include="*.ts" --include="*.tsx"
```

If other files use `expo-audio` for non-playback features (e.g., `requestRecordingPermissionsAsync` elsewhere): keep `expo-audio` in `package.json` and `app.config.ts`.

If `useLiveAudioIO.ts` was the only consumer: remove `expo-audio`:

```bash
npm uninstall expo-audio
```

And remove the `expo-audio` plugin block from `app.config.ts`.

- [ ] **Step 4.5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4.6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all pass (or same count as before this task — no new failures)

- [ ] **Step 4.7: Commit**

```bash
git add app.config.ts package.json package-lock.json
git commit -m "chore(voice): add expo-two-way-audio plugin, remove react-native-live-audio-stream"
```

---

## Task 5: Update Documentation

**Files:**
- Modify: `docs/real-time-voice-chat.md`

- [ ] **Step 5.1: Update docs/real-time-voice-chat.md**

Find and update the native audio section. Replace any references to `expo-audio` + `react-native-live-audio-stream` with:

> **Native audio (Talk tab):** Uses `@speechmatics/expo-two-way-audio` (MIT, stock, Speechmatics-maintained) as a unified duplex module for microphone capture and PCM playback. Hardware AEC is enabled on both iOS (`VoiceProcessingIO`) and Android (linked `AudioRecord`/`AudioTrack` session). Downlink audio is resampled from 24 kHz to 16 kHz in `src/utils/audioResample.ts` before enqueue. Wire protocol (24 kHz base64 downlink, 16 kHz uplink) is unchanged.
>
> **Native rebuild required** — `@speechmatics/expo-two-way-audio` is a native module. OTA updates are insufficient. Rebuild dev client after install.

- [ ] **Step 5.2: Commit**

```bash
git add docs/real-time-voice-chat.md
git commit -m "docs(voice): update native audio to reflect unified duplex module"
```

---

## Task 6: Device QA Checklist

**This task requires physical devices. Cannot be done in simulator.**

Run the full acceptance matrix from spec §16. For each test, mark pass/fail.

- [ ] **Build fresh dev client**

```bash
# Android:
eas build --profile development --platform android --local
# iOS:
eas build --profile development --platform ios --local
```

Install on physical devices.

- [ ] **Test 0 (P0): Echo loop — Android speakerphone, user silent**

Procedure: Start live call on Android at ~70% speaker volume. Speak no words for 30 s while agent responds.

Pass: Agent speaks continuously with no self-interruption. No phantom user turns in transcript. No echo heard in uplink.

- [ ] **Test 0 (P0): Echo loop — iOS speakerphone, user silent**

Same procedure on iOS.

- [ ] **Test 1: Continuous agent speech 30 s**

Agent speaks for 30 s. Audio is gapless (no perceptible gaps between chunks). No crash.

- [ ] **Test 2: Real barge-in**

User speaks while agent is speaking. Agent stops within 200 ms. Mic remains live after barge-in.

- [ ] **Test 3: False barge-in must NOT trigger**

User is silent during agent speech. Agent does NOT get cut off. (Validates AEC suppresses echo.)

- [ ] **Test 4: End call / remount**

End call. Reopen Talk tab. No leaked audio, no crash, no memory warning.

- [ ] **Test 5: Full-duplex**

User and agent speak simultaneously. User audio reaches server. No crash.

- [ ] **Test 6: Silent mode (iOS)**

Enable iOS silent switch. Agent audio is still audible. (Module routes to `.playAndRecord` — silent switch should not mute.)

- [ ] **Test 7: Bluetooth headset**

Connect Bluetooth headset. Agent audio routes to headset. AEC acceptable (may be hardware-dependent).

- [ ] **Test 8: Long call 5+ min**

Run call for 5+ minutes. No memory growth trend in Xcode/Android Studio. No crash.

- [ ] **Test 9: Avatar glow**

Avatar glow tracks agent speech end within 500 ms of last chunk. Does not stay stuck after agent stops.

---

## Acceptance Criteria Checklist

From spec §19 — all must pass before merge:

- [ ] `@speechmatics/expo-two-way-audio` license verified as MIT (`npm info @speechmatics/expo-two-way-audio license`)
- [ ] Spike builds on Android + iOS dev client (Task 0)
- [ ] P0 echo test passes on Android physical device (Task 0, Step 0.6)
- [ ] P0 echo test passes on iOS physical device (Task 0, Step 0.7)
- [ ] `resample24to16` unit tests pass (Task 1)
- [ ] `TwoWayAudioAdapter` unit tests pass (Task 2)
- [ ] `useLiveAudioIO` unit tests pass (Task 3)
- [ ] Full regression passes (`liveVoiceMachine`, `useLiveAudioIO`, `useLiveVoiceChat`, `audioResample`, `twoWayAudioAdapter`)
- [ ] No WAV files or `createAudioPlayer` in native hot path
- [ ] Gapless agent speech (Test 1)
- [ ] Real barge-in works (Test 2); false barge-in from echo does not (Test 3)
- [ ] Avatar glow tracks speech end within 500 ms (Test 9)
- [ ] `UseLiveAudioIOReturn` interface unchanged (verified by TypeScript)
- [ ] `react-native-live-audio-stream` removed from package.json
- [ ] `docs/real-time-voice-chat.md` updated
- [ ] Web talk regression unchanged (`useLiveAudioIO.web.test.ts` passes)
