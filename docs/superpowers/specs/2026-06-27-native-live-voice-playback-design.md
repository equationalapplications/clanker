# Native Live Voice Audio — Design Specification

**Date:** 2026-06-27  
**Status:** Implemented
**Project:** Clanker Talk tab / Gemini Live  
**Feature:** Replace `expo-audio` playback + `react-native-live-audio-stream` mic with a **single unified native duplex module** (stock `@speechmatics/expo-two-way-audio`) supporting gapless PCM playback and hardware AEC, with 24→16 kHz adapter-layer resample  
**Scope:** Native path in `useLiveAudioIO.ts` only. Web (`useLiveAudioIO.web.ts`), XState machine, WebSocket protocol, and cloud-agent backend are unchanged.  
**Depends on:** `docs/superpowers/specs/2026-06-26-real-time-voice-chat-design.md` (Phase 1), `docs/superpowers/specs/2026-06-26-web-voice-design.md` (Phase 3 web playback)

---

## 1. Overview

Talk tab live voice receives **24 kHz, 16-bit mono PCM** downlink chunks from Cloud Agent `/agent/live` and sends **16 kHz, 16-bit mono PCM** uplink while the mic stays open for full-duplex conversation on the **main speaker**.

Web already does this correctly via the Web Audio API (`useLiveAudioIO.web.ts`).

Native currently uses **`expo-audio` per-chunk file playback** (raw PCM data URIs fail on both platforms) plus **`react-native-live-audio-stream`** for mic capture. That split is **not production-viable**:

| Failure mode | Cause |
|---|---|
| Stutter, pops, crashes | Per-chunk WAV files + new `MediaPlayer`/`AVPlayer` instance per chunk |
| Stuck avatar glow | `didJustFinish` / JS timer drift vs hardware playback |
| **Echo loop / self-barge-in** | **Two isolated native modules cannot link `AudioRecord` + `AudioTrack` to the same session ID on Android; iOS `VoiceProcessingIO` requires a unified graph. Mic picks up speaker output → Gemini VAD treats agent voice as user speech.** |

**Decision (rev. 3):** Skip playback-only alternatives (Option B). Adopt **stock `@speechmatics/expo-two-way-audio`** with a 24→16 kHz adapter-layer resample (**Option C′**) as a **single unified duplex module** — the only architecturally sound path for speakerphone Gemini Live, without fork maintenance burden.

No spike to “prove” dual-module AEC failure — that outcome is predictable from OS audio routing constraints. **A thin hardware AEC spike is required before the full hook refactor** (§15, Step 1).

---

## 2. Problem Statement

| Symptom | Root cause |
|---|---|
| Stuttering / robotic audio | File-based `expo-audio` per chunk; no gapless PCM pipeline |
| Avatar glow stuck | `playbackState` tied to enqueue / broken completion events |
| App crash (Android) | High-frequency file I/O + player allocation |
| Silent playback (earlier) | Raw PCM data URIs rejected by high-level media players |
| **Agent cuts itself off / replies to itself** | **No hardware AEC — mic hears 24 kHz speaker output; Gemini Live VAD is highly sensitive** |

Phase 1 design already called for native streaming playback. Implementation diverged to `expo-audio` + separate mic module. This spec realigns native with **full-duplex conversational audio** requirements.

---

## 3. Goals

1. **Gapless PCM playback** on Android and iOS — subjectively indistinguishable from web (no stutter, no perceptible gap between chunks).
2. **Hardware acoustic echo cancellation (AEC)** for speakerphone full-duplex — mic and speaker in **one native audio session**.
3. **Stable 16 kHz mic uplink** while agent audio plays (same rates as today’s wire protocol).
4. **No filesystem writes** on the hot path during a live call.
5. **Preserve `UseLiveAudioIOReturn`** — `useLiveVoiceChat` and `liveVoiceMachine` require no protocol changes.
6. **Correct `playbackState` / avatar glow** — prefer native `isPlaying` / queue state over JS timers.
7. **Native rebuild** — explicitly **not** OTA-only.

## 4. Non-Goals

- Replacing web playback (already correct).
- Changing Gemini Live backend or WebSocket message format.
- Building a from-scratch custom Expo module (unless Option C′ and D both fail acceptance).
- Changing the wire protocol — 24 kHz downlink and 16 kHz uplink are unchanged. Resampling is adapter-internal only.

---

## 5. Constraints

| Constraint | Detail |
|---|---|
| Audio format (downlink) | 24 kHz, mono, 16-bit signed LE PCM, base64 on wire |
| Audio format (uplink) | 16 kHz, mono, 16-bit — matches Gemini Live input |
| Chunk cadence | ~20–100 ms from Gemini Live |
| Interface stability | `playChunk`, `clearPlaybackQueue`, `playbackState`, `onAudioChunk` unchanged |
| Expo SDK | 56, dev client + EAS production builds |
| Speakerphone | Primary UX — AEC is mandatory, not optional |
| `@speechmatics/expo-two-way-audio` (stock) | Playback at **16 kHz** — adapter resamples 24→16 kHz before enqueue; wire protocol unchanged |

---

## 6. Why Dual-Module Architectures Fail (Option B Rejected)

### Android

`AcousticEchoCanceler` requires `AudioRecord` (input) and `AudioTrack` (output) to share the **same native audio session ID**. Two isolated React Native modules (`react-native-live-audio-stream` + `react-native-pcm-player-lite`) each open their own session — **hardware AEC will not engage**.

### iOS

Full-duplex AEC requires a unified **`VoiceProcessingIO`** audio unit graph. Splitting mic (`LiveAudioStream`) and playback (separate `AVAudioEngine`) bypasses that graph.

### Gemini Live impact

Without cancellation, the microphone captures 24 kHz speaker output. Gemini Live **VAD** interprets the agent’s own voice as user barge-in → constant self-interruption, truncated replies, or hallucinated user turns.

**Verdict:** Option B (`pcm-player-lite` + existing mic) is **rejected** for production. Do not spike it for speakerphone validation.

---

## 7. Options Evaluated

### Option A — `expo-audio` + WAV cache files (current / interim)

| | |
|---|---|
| **Verdict** | **Reject.** Stutter, I/O thrashing, crashes. Already reverted from repo. |

### Option B — `react-native-pcm-player-lite` + `react-native-live-audio-stream`

| | |
|---|---|
| **Pros** | Simple playback API; small diff |
| **Cons** | **No unified session → no hardware AEC → echo loop on speakerphone** |
| **Verdict** | **Rejected.** Dead end for Talk tab UX. |

### Option C — 24 kHz fork of `@speechmatics/expo-two-way-audio`

| | |
|---|---|
| **Pros** | Unified duplex; **hardware AEC + noise suppression**; no resample step |
| **Cons** | Hobbyist forks (sugaith / talantiq-dev) — unvetted native C++/Java/ObjC; no license audit; supply-chain risk; fork maintenance burden; may diverge from upstream Expo SDK bumps |
| **Verdict** | **Fallback** — use if Option C′ fails AEC acceptance on both platforms. |

### Option C′ — Stock `@speechmatics/expo-two-way-audio` + 24→16 kHz adapter resample (**recommended**)

| | |
|---|---|
| **Pros** | **Officially maintained** Speechmatics package; no fork; MIT-licensed; Expo 56 tested; unified duplex → hardware AEC; `stopPlayback`/`isPlaying` present; resample is pure-JS, unit-testable, fractions of a ms per chunk |
| **Cons** | 24→16 kHz downsample = wideband (16 kHz) vs super-wideband (24 kHz) playback quality. Perceptible only on high-fidelity headphones; inaudible on phone speaker. Adapter adds ~5 lines of math. |
| **Verdict** | **Adopt for v1.** |

**Why 16 kHz quality is acceptable:** Gemini Live *input* already at 16 kHz; agent voice is generated speech, not music. ITU-T G.722 wideband (16 kHz) is the standard for HD voice calls. Downgrade to wideband is a pragmatic swap for zero fork maintenance.

**Resample location:** `src/utils/audioResample.ts` — imported by adapter only. Hook stays at wire-protocol rate (24 kHz base64 in). See §9.

**Base64 decode:** use `atob()` (globally available in Hermes ≥ RN 0.71) — same pattern as `useLiveAudioIO.web.ts` L198. No `buffer` polyfill needed.

### Option D — `expo-audio-stream` (edkimmel)

| | |
|---|---|
| **Pros** | AI voice streaming; `playbackMode: "conversation"`; jitter buffer |
| **Cons** | Heavier API; less proven in this repo; still need full mic+playback validation |
| **Verdict** | **Second fallback** only if both C′ and C fail Expo 56 build or AEC acceptance. |

### Option E — `react-native-audio-api`

| | |
|---|---|
| **Verdict** | **Defer** — gapless queue API not ready. |

### Option F — Custom Expo native module

| | |
|---|---|
| **Verdict** | **Defer** — Option C′ already provides the required native primitives without fork maintenance. |

---

## 8. Recommendation

**Adopt Option C′: stock `@speechmatics/expo-two-way-audio` with 24→16 kHz adapter-layer resample.**

Replace **both**:

- `react-native-live-audio-stream` (mic)
- `expo-audio` `createAudioPlayer` (playback)

With **one officially maintained module** owning input, output, and audio session. The 24→16 kHz resample lives in `src/utils/audioResample.ts`, called by the adapter — not the hook.

Rationale:

1. **Only mathematically sound path** for speakerphone full-duplex with Gemini Live VAD.
2. **Single `VoiceProcessingIO` (iOS) / linked session (Android)** enables hardware AEC.
3. **Wire protocol unchanged** — hook receives 24 kHz base64 from Gemini; adapter resamples before feeding module. No backend change.
4. **Zero fork maintenance** — stock npm package, MIT license, Speechmatics-maintained.
5. **Adapter boundary** (`TwoWayAudioAdapter`) preserves swap-ability to Option C or D if needed.
6. **Thin spike gates full PR** — AEC must be confirmed on physical device before hook refactor (§15 Step 1).

**Remove from native hot path:**

- `expo-audio` playback (`createAudioPlayer`, data URIs, WAV files)
- `react-native-live-audio-stream` (`LiveAudioStream.init/start/stop/on(‘data’)`)
- Redundant `setAudioModeAsync` if the module owns session (see §12)

**Keep `expo-audio`** only if other features need it (e.g. `requestRecordingPermissionsAsync` — evaluate whether stock module’s `useMicrophonePermissions` replaces this).

---

## 9. Architecture

```
Gemini Live (cloud-agent /agent/live)
        │  audio_output { base64 PCM 24kHz }
        ▼
liveVoiceMachine  ──AUDIO_OUTPUT──▶  useLiveVoiceChat.playChunk()
        ▲                                    │
        │  audio_input                       ▼
        │                          ┌──────────────────────────┐
        └──── onAudioChunk ────────│  useLiveAudioIO.ts       │
                                   │  (native)                │
                                   ├──────────────────────────┤
                                   │  TwoWayAudioAdapter      │
                                   ├──────────────────────────┤
                                   │  atob() → Uint8Array     │
                                   │  resample24to16()        │  ← audioResample.ts
                                   ├──────────────────────────┤
                                   │  @speechmatics/          │
                                   │  expo-two-way-audio      │
                                   │  (stock, official)       │
                                   ├──────────────────────────┤
                                   │  IN:  onMicrophoneData   │
                                   │       16kHz → base64     │
                                   │  OUT: playPCMData(16kHz) │
                                   │       stopPlayback()     │
                                   │  AEC: unified session    │
                                   └──────────────────────────┘
```

### New module: `src/native/twoWayAudioAdapter.ts`

Thin wrapper isolating the stock module from the hook. Rate conversion is internal to the adapter:

```typescript
export interface TwoWayAudioAdapter {
  /** Idempotent module init + audio session setup. */
  initialize(): Promise<void>
  /** Request permission + start mic; emit base64 chunks via callback. */
  startRecording(onChunk: (base64: string) => void): Promise<boolean>
  stopRecording(): void
  /**
   * Accepts 24 kHz base64 PCM (wire format). Adapter resamples to 16 kHz
   * before passing to module — caller operates at wire-protocol rate.
   */
  playChunk(base64Pcm: string): void
  /** Barge-in: stop speaker immediately and clear queue. */
  clearPlaybackQueue(): void
  /** Native playback active (preferred over JS byte timer). */
  isPlaying(): boolean
  /** Full teardown on unmount / end call. */
  tearDown(): Promise<void>
}
```

Implementation delegates to stock `@speechmatics/expo-two-way-audio`. Hook imports adapter only.

**Base64 → PCM inside adapter:**

```typescript
// src/native/twoWayAudioAdapter.ts
import { resample24to16 } from '../utils/audioResample'

playChunk(base64Pcm: string): void {
  const binary = atob(base64Pcm)          // Hermes global, no polyfill
  const pcm24 = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) pcm24[i] = binary.charCodeAt(i)
  const pcm16 = resample24to16(pcm24)     // 2:3 linear interpolation
  module.playPCMData(pcm16, 16000)
}
```

```typescript
// src/utils/audioResample.ts
/** Downsample 24 kHz 16-bit mono PCM to 16 kHz via 2:3 linear interpolation. */
export function resample24to16(pcm24: Uint8Array): Uint8Array {
  // 24kHz → 16kHz: output 2 samples for every 3 input samples
  // Samples are 16-bit signed LE (2 bytes each); interpolate at sample level
}
```

`resample24to16` is pure TypeScript, no native deps, fully unit-testable in Jest without a device.

---

## 10. Hook Behavior Mapping

Behavior must match web semantics where possible. **`UseLiveAudioIOReturn` unchanged.**

| Event / action | Native behavior (new) |
|---|---|
| Mount | `adapter.initialize()` |
| `startRecording()` | Request mic permission (stock module or expo-audio permission API); `adapter.startRecording(cb)`; register `cb` → fan-out to `chunkListenersRef` |
| `stopRecording()` | `adapter.stopRecording()` |
| First `playChunk()` | `playChunk` on adapter; set `playbackState = 'playing'` |
| Subsequent `playChunk()` | `playChunk` only |
| `clearPlaybackQueue()` | `adapter.clearPlaybackQueue()` → `stopPlayback()`; `playbackState = 'idle'` |
| `AUDIO_INTERRUPTED` | Same as `clearPlaybackQueue()` — already wired in `useLiveVoiceChat` |
| `endCall` / unmount | `tearDown()` |
| Malformed base64 | Log warning, skip chunk |

### `playbackState` semantics

**`PlaybackState` type** is `'idle' | 'playing' | 'buffering'`. The `'buffering'` variant is **not used on the native path** — the stock module enqueues synchronously. Set only `'idle'` and `'playing'`; `'buffering'` remains in the type for web/future use.

**Primary:** poll or subscribe to adapter `isPlaying()` when chunks are enqueued. Stock module exposes `isPlaying` — use it.

**Fallback:** rolling byte-count timer (single timer for queue drain) — same technique as spec v1 §9, but **only if module lacks idle signal**.

Do **not** use `expo-audio` `didJustFinish`.

Mic events: replace `LiveAudioStream.on('data')` with stock module `useExpoTwoWayAudioEventListener('onMicrophoneData')` **inside adapter** (hook stays callback-based via `onAudioChunk`).

---

## 11. Platform Parity: iOS vs Android

**One JS path, one native module, two platform backends inside `@speechmatics/expo-two-way-audio`.**

| Platform | Native duplex stack (inside module) | AEC |
|---|---|---|
| **Android** | Linked `AudioRecord` + `AudioTrack` session | Hardware `AcousticEchoCanceler` when session unified |
| **iOS** | `VoiceProcessingIO` / unified `AVAudioEngine` graph | System voice-processing AEC |

No separate iOS or Android playback branches in JS.

### iOS-specific validation (physical device)

| Quirk | Mitigation |
|---|---|
| Earpiece routing | Module routes to main speaker by default; verify at ~70% volume |
| Silent switch | Confirm agent audible with silent switch on |
| Voice Isolation / mic modes | Module supports iOS mic mode APIs — test if user prompted |
| Barge-in ducking | Real barge-in should work; **false barge-in from echo must not occur** |

### Android-specific validation (physical device)

| Quirk | Mitigation |
|---|---|
| Session linking | Verify no echo loop — primary acceptance test |
| `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` | Already in Expo config for speech; confirm stock module plugin |
| Emulator | Insufficient for AEC — physical device required |

---

## 12. Audio Session Configuration

**Session owner moves to `@speechmatics/expo-two-way-audio`.** On `initialize()`:

1. Fork configures `.playAndRecord` / voice-communication mode with AEC enabled.
2. **Remove or gate** `setAudioModeAsync` from `useLiveAudioIO` if it conflicts with module session (implementation must not double-configure).

If permission API remains on `expo-audio`:

```typescript
import { requestRecordingPermissionsAsync } from 'expo-audio'
```

…keep only the permission call; do **not** configure playback through expo-audio.

**Speaker routing:** confirm agent audio uses bottom speaker, not earpiece, during active mic capture.

---

## 13. Build & Deployment Requirements

| Requirement | Detail |
|---|---|
| Native rebuild | **Mandatory** — install `@speechmatics/expo-two-way-audio` + remove old native deps |
| OTA | **Insufficient** |
| Dev client | Rebuild `build:dev-a` / `build:dev-i` after adding module |
| Production | Next store release |
| `app.config.ts` | Add `@speechmatics/expo-two-way-audio` Expo plugin if required; keep `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` |
| Dependencies | Add `@speechmatics/expo-two-way-audio` (stock npm); **remove** `react-native-live-audio-stream` after spike passes (§15 Step 1). No `buffer` polyfill needed — use `atob()`. |
| iOS | `pod install` via EAS |

Update `docs/real-time-voice-chat.md`: unified duplex module, rebuild required, AEC dependency.

---

## 14. Files to Create / Modify

| File | Action |
|---|---|
| `src/native/twoWayAudioAdapter.ts` | **Create** — wrapper over stock module; owns `atob` decode + resample |
| `src/utils/audioResample.ts` | **Create** — `resample24to16(pcm24: Uint8Array): Uint8Array`; pure TS |
| `src/hooks/useLiveAudioIO.ts` | **Modify** — unified duplex via adapter; remove `LiveAudioStream` + `expo-audio` playback |
| `__tests__/useLiveAudioIO.test.tsx` | **Modify** — mock `TwoWayAudioAdapter` |
| `__tests__/twoWayAudioAdapter.test.ts` | **Create** — base64 decode, resample call, error handling |
| `__tests__/audioResample.test.ts` | **Create** — `resample24to16`: known PCM in → expected 16 kHz bytes out |
| `app.config.ts` | **Modify** — Expo plugin for `@speechmatics/expo-two-way-audio` if required |
| `package.json` | **Add** `@speechmatics/expo-two-way-audio`; **remove** `react-native-live-audio-stream` (after spike) |
| `docs/real-time-voice-chat.md` | **Update** |
| `docs/superpowers/specs/2026-06-26-real-time-voice-chat-design.md` | **Append errata** |

**Unchanged:** `useLiveAudioIO.web.ts`, `useLiveVoiceChat.ts`, `liveVoiceMachine.ts`, talk UI.

---

## 15. Migration Plan

1. **Thin AEC spike (P0 gate — must pass before Step 2).**
   - Install `@speechmatics/expo-two-way-audio` (stock npm); rebuild dev client.
   - Write ~30-line sandbox: `initialize()` → `startRecording()` → loop `playPCMData(resampledChunk, 16000)` for 30 s of known Gemini audio.
   - Run **§16 Test 0 (echo loop)** on Android physical device (speakerphone, user silent).
   - Run **§16 Test 0** on iOS physical device.
   - **If both pass:** proceed to Step 2. **If either fails:** evaluate Option C (24 kHz fork, §7) or Option D before full refactor.
   - Do **not** remove `react-native-live-audio-stream` yet — spike coexists with current code.

2. **Implement `TwoWayAudioAdapter` + `audioResample.ts` + hook refactor** — replace mic and playback in one PR. Write unit tests first (TDD per §16).

3. **Remove** `react-native-live-audio-stream` and `expo-audio` playback usage from live voice path. Remove only after Step 2 device QA passes.

4. **Device QA** — full §16 acceptance matrix; gapless, barge-in, long call.

5. **No Option B.** No dual-module fallback in production.

---

## 16. Testing

### Unit tests (Jest)

**`audioResample.test.ts`** (`src/utils/audioResample.ts`):
- Known 24 kHz sine burst (48 samples / 1 ms) → output is 32 samples (2:3 ratio)
- Output length = `floor(input_sample_count * 2/3) * 2` bytes (16-bit LE)
- Silence in → silence out (no DC offset introduced)
- Odd-length input does not throw

**`twoWayAudioAdapter.test.ts`**:
- Valid base64 → `atob` decode → `resample24to16` called with correct byte count
- Malformed base64 does not throw; logs warning
- `playChunk` calls module `playPCMData` with 16000 sample rate

**`useLiveAudioIO.test.tsx`** (mock adapter):
- `startRecording` registers callback; chunks fan out to `onAudioChunk` subscribers
- `playChunk` forwards base64 to adapter
- `clearPlaybackQueue` calls adapter clear/stop
- `playbackState` reflects `isPlaying()` mock

### Manual device acceptance (required — physical devices)

| # | Scenario | Pass criteria |
|---|---|---|
| **0** | **Echo loop (P0)** | Agent speaks 30 s at ~70% speaker volume, user **silent** — **no self-interruption**, no phantom user turns in transcript, no echo in uplink |
| 1 | Continuous agent speech 30 s | Gapless subjectively; no crash |
| 2 | Real barge-in | User speech stops agent < 200 ms; mic still live |
| 3 | False barge-in | Must **not** trigger when user is silent during agent speech |
| 4 | End call / remount | Clean teardown; no leaked audio |
| 5 | Full-duplex | User speaks while agent speaks; uplink reaches server |
| 6 | Silent mode (iOS) | Agent audible |
| 7 | Bluetooth headset | Routes correctly; AEC acceptable |
| 8 | Long call (5+ min) | No memory growth / crash |
| 9 | Avatar glow | Tracks speech end within 500 ms |

### Regression

```bash
npx jest __tests__/liveVoiceMachine.test.ts __tests__/useLiveAudioIO.test.tsx __tests__/useLiveVoiceChat.test.tsx --no-coverage
```

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Stock module license / provenance** | `@speechmatics/expo-two-way-audio` is MIT, Speechmatics-maintained — verify with `npm info @speechmatics/expo-two-way-audio license` before first build |
| Stock module API incompatible with Expo 56 | Check peer deps at install time; `expo install` version resolution; fallback to Option C if blocked |
| Resample quality unacceptable on headphones | 2:3 linear interp is wideband-grade — sufficient for voice. If rejected: upgrade to sinc or fall back to Option C (24 kHz fork) |
| AEC spike fails (§15 Step 1) | Evaluate Option C (24 kHz fork — fallback) before full refactor |
| Option C fork unmaintained / supply-chain | Only vendor if C′ spike fails; audit license + last commit date before vendoring |
| `setAudioModeAsync` conflicts | Let module own session; remove duplicate config |
| AEC insufficient at max volume | Document max recommended volume; headset fallback UX (future) |
| iOS simulator misleading | Physical device sign-off only |

---

## 18. Future Work (Out of Scope)

1. **`react-native-audio-api`** when gapless queue + AEC path matures — potential web API convergence.
2. **Native metrics** — underrun / AEC effectiveness telemetry to Crashlytics.
3. **Sinc resample** if 2:3 linear interpolation quality rejected on premium headphones.
4. **Upstream PR to Speechmatics** — expose 24 kHz playback on stock module, removing resample need.

---

## 19. Acceptance Criteria

- [ ] **Spike:** `@speechmatics/expo-two-way-audio` (stock) builds on Android + iOS dev client
- [ ] **P0 echo test passes** on Android physical device (speakerphone, user silent, 30 s) — spike gate
- [ ] **P0 echo test passes** on iOS physical device — spike gate
- [ ] `resample24to16` unit tests pass in Jest (no device)
- [ ] Gapless agent speech; no WAV files or `createAudioPlayer` in hot path
- [ ] Real barge-in works; false barge-in from echo does **not**
- [ ] Avatar glow tracks speech end within 500 ms
- [ ] `UseLiveAudioIOReturn` unchanged
- [ ] Web talk regression unchanged
- [ ] `react-native-live-audio-stream` removed from live voice path
- [ ] `@speechmatics/expo-two-way-audio` license verified (MIT) before merge
- [ ] `docs/real-time-voice-chat.md` updated

---

## 20. Decision Log

| Date | Decision |
|---|---|
| 2026-06-27 | Spec v1 recommended Option B (`pcm-player-lite`) with adapter pattern |
| 2026-06-27 | **Spec v2: Option B rejected.** Dual-module cannot satisfy Android session-linked AEC or iOS `VoiceProcessingIO`. **Option C (24 kHz fork) adopted.** No AEC spike. Unified duplex in one PR. |
| 2026-06-27 | **Spec v3: Option C superseded by Option C′.** 24 kHz hobbyist forks carry supply-chain risk and fork maintenance burden. Stock `@speechmatics/expo-two-way-audio` (MIT, officially maintained) + 24→16 kHz linear resample in adapter layer achieves same AEC correctness with zero fork overhead. Resample is wideband-grade (16 kHz), acceptable for agent speech. **Thin AEC spike added as P0 gate before full hook refactor.** |

---

## 21. Next Step

After spec approval → invoke **writing-plans** to produce `docs/superpowers/plans/2026-06-27-native-live-voice-playback.md` with TDD task breakdown for Option C′ implementation. Plan must include:

1. **Spike task** (§15 Step 1) as first and blocking task — P0 echo gate before any hook refactor
2. `audioResample.ts` TDD (unit tests first, no device)
3. `TwoWayAudioAdapter` TDD
4. `useLiveAudioIO.ts` refactor
5. Device QA checklist (§16 full matrix)
