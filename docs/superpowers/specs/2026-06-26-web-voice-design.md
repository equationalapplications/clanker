# Web Voice Support — Phase 3 Specification

**Date:** 2026-06-26
**Status:** Implemented
**Project:** Clanker Cloud Agent
**Feature:** Real-time voice support on web via Web Audio API
**Scope:** `src/hooks/useLiveAudioIO.web.ts` only
**Depends on:** `docs/superpowers/specs/2026-06-26-real-time-voice-chat-design.md` (Phase 1), `docs/superpowers/specs/2026-06-26-live-voice-backend-design.md` (Phase 2)

---

## Overview

Phase 1 delivered the XState machine and controller hook for native iOS/Android voice calls. Phase 2 delivered the Cloud Run WebSocket proxy. The `useLiveAudioIO.web.ts` file currently exports a stub that returns `WEB_UNSUPPORTED` and no-ops all methods.

Phase 3 replaces that stub with a real implementation using the Web Audio API. The constraint is not the web platform itself — it fully supports raw PCM capture and playback — but that `expo-audio` and `react-native-live-audio-stream` (the native abstractions used in `useLiveAudioIO.ts`) do not run on web. The fix is a web-specific implementation that satisfies the same `UseLiveAudioIOReturn` interface using browser-native APIs.

**No other files change.** `liveVoiceMachine.ts`, `useLiveVoiceChat.ts`, the Talk tab UI, and the cloud agent backend are all platform-agnostic and untouched.

---

## 1. Approach

**Single file:** `src/hooks/useLiveAudioIO.web.ts`

The hook signature is identical to the native version:

```typescript
export function useLiveAudioIO(): UseLiveAudioIOReturn
```

The implementation splits into two independent sub-systems:

- **Input pipeline** — microphone → AudioWorklet (16kHz PCM) → base64 → `onAudioChunk` listeners → WebSocket → Gemini
- **Output pipeline** — base64 PCM (24kHz) from Gemini → `AudioBufferSourceNode` queue → gapless playback

```
getUserMedia(mono, echoCancellation)
      │
  MediaStreamSource (AudioContext @ 16kHz)
      │
  AudioWorkletNode  [Float32 → Int16 @ 16kHz, 20ms chunks]
      │ postMessage(Int16Array)
  main thread → btoa() → onAudioChunk callbacks → WS → Gemini

Gemini → WS → base64 PCM (24kHz) → playChunk()
      │
  decode → AudioBuffer (Float32, 24kHz)
      │
  AudioBufferSourceNode.start(nextStartTime)   ← gapless scheduling
      │
  AudioContext.destination
```

**AudioWorklet loading:** The worklet processor is inlined as a JavaScript string and loaded via `URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))`. This requires zero bundler configuration and avoids the CORS/MIME issues that arise when serving static `.js` files from Metro's local dev server.

---

## 2. Secure Context Requirement

`navigator.mediaDevices.getUserMedia` and `AudioWorklet` both require a **secure context**. This means:

- **Production (HTTPS):** Works.
- **Local dev on `localhost`:** Works — browsers treat `localhost` as secure.
- **Local dev over LAN (e.g. `http://192.168.1.5:8081`):** **Blocked.** The browser treats non-`localhost` HTTP as insecure and silently returns `undefined` for `navigator.mediaDevices`. Testing on a physical device over Wi-Fi requires a reverse proxy with a valid TLS cert (e.g., `ngrok`).

Document this for any developer who tests web builds on a physical device over a local network.

---

## 3. Input Pipeline

### AudioContext

```typescript
const audioCtx = new AudioContext({ sampleRate: 16000 })
```

Created lazily inside `startRecording()` — browsers require a user gesture before `AudioContext` can be created. Closed in `stopRecording()` and on hook unmount.

If the browser ignores the `sampleRate: 16000` hint (rare on modern desktop browsers), the worklet will still run but send audio at the wrong sample rate. Gemini's VAD may still function but audio quality will degrade. This is an acceptable known limitation documented in the hook's JSDoc.

### Worklet Processor (inlined as Blob)

The processor accumulates incoming `Float32Array` frames into a 320-sample buffer (= 20ms at 16kHz), then converts and posts:

```javascript
// Inlined as a template string — loaded via Blob URL
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Int16Array(320)
    this._offset = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true

    for (let i = 0; i < input.length; i++) {
      // Float32 [-1, 1] → Int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, input[i]))
      this._buffer[this._offset++] = s < 0 ? s * 32768 : s * 32767

      if (this._offset === 320) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer])
        this._buffer = new Int16Array(320)
        this._offset = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
```

**Note on btoa encoding:** The main thread encodes received chunks as:
```typescript
btoa(String.fromCharCode(...new Uint8Array(buffer)))
```
The spread operator pushes arguments onto the JS call stack. At 20ms chunks (640 bytes = 320 samples × 2 bytes), this is well within browser limits (~65,535 args). If chunk size is ever increased significantly (e.g., 1s = 32,000 bytes), replace with a `for` loop to avoid `Maximum call stack size exceeded`.

### getUserMedia

```typescript
await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    // No sampleRate constraint — AudioContext handles rate
  }
})
```

On denial, set `recordingState = 'error'` and `error = 'Microphone permission required.'`

### Cleanup on stopRecording / unmount

```typescript
stream.getTracks().forEach(t => t.stop())
workletNode.disconnect()
sourceNode.disconnect()
await audioCtx.close()
```

**Critical:** Stopping tracks releases the browser's microphone lock and removes the red "recording" indicator in the browser tab. Missing this is a visible privacy regression.

---

## 4. Output Pipeline

### Gapless Scheduling

```typescript
let nextStartTime = 0  // seconds in AudioContext timeline

async function playChunk(base64PCM: string): Promise<void> {
  // 1. Decode base64 → ArrayBuffer
  const binary = atob(base64PCM)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  // 2. Int16 → Float32 (divide by 32768.0 for mathematically correct bounds)
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0

  // 3. Create AudioBuffer at 24kHz
  const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000)
  audioBuffer.getChannelData(0).set(float32)

  // 4. Schedule node
  const node = audioCtx.createBufferSource()
  node.buffer = audioBuffer
  node.connect(audioCtx.destination)

  // 5. Clamp to current time to handle network jitter / tool-execution gaps
  if (nextStartTime < audioCtx.currentTime) {
    nextStartTime = audioCtx.currentTime
  }
  node.start(nextStartTime)
  nextStartTime += audioBuffer.duration

  // 6. Track node; remove on end to prevent Set memory leak
  scheduledNodes.add(node)
  node.onended = () => {
    scheduledNodes.delete(node)
    if (scheduledNodes.size === 0) {
      setPlaybackState('idle')
    }
  }

  setPlaybackState('playing')
}
```

**Why divide by 32768.0:** Signed 16-bit integers range from -32768 to +32767. Dividing -32768 by 32767 produces ~-1.00003, which exceeds the Web Audio API's expected [-1.0, 1.0] float range. Dividing by 32768.0 guarantees strict bounds.

**Why clamp `nextStartTime`:** If the server pauses audio (e.g., during tool execution), the next chunk arrives after `nextStartTime` has fallen behind `audioCtx.currentTime`. Without the clamp, the node would be scheduled in the past and the browser would drop it silently.

### Barge-in: clearPlaybackQueue

```typescript
function clearPlaybackQueue(): void {
  scheduledNodes.forEach(node => {
    try { node.stop() } catch { /* defensive — node may have already ended */ }
  })
  scheduledNodes.clear()
  nextStartTime = 0
  setPlaybackState('idle')
}
```

The try/catch is defensive. In modern browsers, calling `.stop()` on an already-ended node is a no-op, not an error. A node throws `InvalidStateError` only if `.stop()` is called before `.start()` — which cannot happen here since `start()` is always called synchronously before the node enters `scheduledNodes`.

---

## 5. State Transitions

| Action | `recordingState` | `playbackState` |
|---|---|---|
| Hook mounts | `idle` | `idle` |
| `startRecording()` starts | `idle` | — |
| Permission denied | `error` | — |
| AudioWorklet ready | `recording` | — |
| `stopRecording()` | `idle` | — |
| `playChunk()` called | — | `playing` |
| Queue drains | — | `idle` |
| `clearPlaybackQueue()` | — | `idle` |
| Hook unmounts | cleanup | cleanup |

`playbackState = 'buffering'` is not used on web — `AudioBufferSourceNode` scheduling is synchronous, so there is no observable buffering phase.

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| `getUserMedia` permission denied | `recordingState = 'error'`, `error = 'Microphone permission required.'` |
| `getUserMedia` unavailable (non-HTTPS) | `recordingState = 'error'`, `error = 'Microphone access requires a secure connection (HTTPS).'` |
| `AudioContext` construction fails | `recordingState = 'error'`, propagate error message |
| `audioWorklet.addModule()` fails (old browser) | `recordingState = 'error'`, `error = 'Browser does not support AudioWorklet. Use Chrome, Firefox, or Safari 15+.'` |
| Malformed base64 in `playChunk` | `console.warn`, skip chunk — 20ms drop sounds like a faint pop, far better than crashing the session |
| Hook unmounts mid-call | cleanup: stop all tracks, close AudioContext, stop all scheduled nodes |

---

## 7. Testing Strategy

The Web Audio API has no implementation in Node.js/jsdom. Tests mock the constructors and assert on call arguments.

### Unit — `useLiveAudioIO.web.test.ts`

**Setup:** Mock `window.AudioContext`, `navigator.mediaDevices.getUserMedia`, and `AudioWorkletNode` before each test.

**Input tests:**
- `startRecording()` creates AudioContext at 16kHz
- `startRecording()` calls `getUserMedia` with `channelCount: 1` and `echoCancellation: true`
- `startRecording()` loads worklet via Blob URL
- Simulated worklet `postMessage` triggers `onAudioChunk` callback with a base64 string
- `getUserMedia` rejection → `recordingState = 'error'`, correct error message
- `audioWorklet.addModule` rejection → `recordingState = 'error'`, correct error message
- `stopRecording()` calls `track.stop()` and closes AudioContext

**Output tests:**
- `playChunk()` creates `AudioBuffer` at 24kHz
- `playChunk()` calls `node.start(nextStartTime)` — first chunk at `audioCtx.currentTime`
- Second `playChunk()` schedules at `firstStartTime + firstDuration` (gapless)
- `node.onended` calls `scheduledNodes.delete(node)` (leak prevention)
- `clearPlaybackQueue()` calls `.stop()` on all tracked nodes and resets `nextStartTime`
- Malformed base64 in `playChunk()` logs warning, does not throw

---

## 8. Files Changed

| File | Change |
|---|---|
| `src/hooks/useLiveAudioIO.web.ts` | Replace stub with full Web Audio API implementation |

No other files change.

---

## 9. Acceptance Criteria

- [ ] `startRecording()` returns `true` after mic permission granted in browser
- [ ] `recordingState` transitions `idle → recording` on successful mic start
- [ ] `onAudioChunk` callbacks fire with base64-encoded 20ms PCM chunks
- [ ] `stopRecording()` releases mic lock; browser tab no longer shows recording indicator
- [ ] `playChunk()` produces gapless audio across sequential chunks
- [ ] Barge-in: `clearPlaybackQueue()` immediately silences playback
- [ ] Permission denied → `error` message shown in Talk tab status text
- [ ] Non-HTTPS context → explicit error message (not a silent hang)
- [ ] Old browser without AudioWorklet → explicit error message
- [ ] Hook unmount during active call → no memory leaks, no zombie MediaStreamTracks
- [ ] Talk tab on web renders and functions identically to native (same `UseLiveVoiceChatReturn` shape)
- [ ] Native iOS/Android builds unaffected (file is `.web.ts`, not loaded on native)
