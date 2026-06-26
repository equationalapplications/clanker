# Real-Time Voice Chat Specification

**Date:** 2026-06-26  
**Status:** Implemented
**Project:** Clanker Cloud Agent  
**Feature:** Gemini Live API Voice Chat Integration  
**Scope:** Frontend `useLiveVoiceChat` hook architecture (client-side only; server `/agent/live` handler is separate task)

---

## Overview

Replace the existing `useVoiceChat` hook (expo-speech-recognition, walkie-talkie model) with a continuous, bi-directional Gemini Live API audio stream. The new system supports:

- **Uninterrupted voice calls** with barge-in (user interrupts AI mid-speech)
- **Real-time tool execution** (wiki_read, create_task, etc.) over the same WebSocket
- **Text transcript extraction** while discarding raw audio to prevent database bloat
- **Memory context** via pre-call sync using existing `wikiSync` pipeline (no WebSocket overhead)
- **Credit-aware streaming** with per-chunk billing snapshots
- **XState v5 orchestration** for bulletproof session lifecycle management

---

## 1. Interface Boundary — WebSocket Payloads

The frontend communicates with Cloud Run `/agent/live` endpoint via WebSocket. All payloads are JSON; binary audio is base64-encoded.

### Client → Server (Frontend Sends)

| Event | Payload | Purpose |
|-------|---------|---------|
| **Auth Handshake** | `{ "type": "auth", "token": "<firebase-id-token>" }` | Authenticate WebSocket connection |
| **Audio Input** | `{ "type": "audio_input", "data": "<base64-16kHz-PCM>" }` | Stream user's voice from microphone (20ms chunks); server detects VAD/barge-in |
| **Session End** | `{ "type": "end_session" }` | Gracefully close connection |

### Server → Client (Backend Sends)

| Event | Payload | Purpose |
|-------|---------|---------|
| **Audio Output** | `{ "type": "audio_output", "data": "<base64-24kHz-PCM>" }` | Stream AI's synthesized voice to speaker (20ms chunks) |
| **Transcript Token** | `{ "type": "transcript_token", "role": "user" \| "model", "text": "<incremental-text>" }` | Live transcript word-by-word (accumulate in UI) |
| **Tool Start** | `{ "type": "tool_start", "name": "<tool-name>" }` | Show UI banner "⏳ Reading your memory..." |
| **Tool End** | `{ "type": "tool_end", "name": "<tool-name>" }` | Clear tool banner (server executed tool, returned result to Gemini internally) |
| **Audio Interrupted** | `{ "type": "audio_interrupted" }` | Acknowledge user barge-in; flush local playback queue |
| **Usage Snapshot** | `{ "type": "usage_snapshot", "remainingCredits": <number> }` | Billing state update (per 1000 tokens or chunk) |
| **Session Error** | `{ "type": "error", "message": "<reason>", "code": "<code>" }` | Connection error (network, auth, credits) |
| **Session End Ack** | `{ "type": "session_ended" }` | Server acknowledges graceful shutdown |

### Constraints

- Binary audio sent as base64 strings (JSON-compatible, no custom framing protocol)
- Single concurrent tool execution (no parallel calls)
- Transcript tokens stream continuously; client concatenates same-role tokens into single message
- Audio chunks are atomic; playback queue handles buffering and order
- Pre-call memory sync happens **before** WebSocket opens (via existing `wikiSync` pipeline, not over socket)

---

## 2. State Machine — `liveVoiceMachine.ts`

XState v5 machine orchestrates the entire voice session lifecycle: pre-call sync, socket management, transcript accumulation, tool state, and database persistence.

### States

```
┌─────────────────────────────────────────────────┐
│                    idle                         │
│ (no active session)                             │
└───────────────┬─────────────────────────────────┘
                │ START_CALL
                ▼
┌─────────────────────────────────────────────────┐
│             syncing_memory                      │
│ (invoke wiki.exportDump → wikiSync Firebase)    │
└───────────────┬─────────────────────────────────┘
                │ sync success
                ▼
┌─────────────────────────────────────────────────┐
│             connecting                          │
│ (WebSocket open, send auth payload)             │
└───────────────┬─────────────────────────────────┘
                │ SOCKET_OPENED
                ▼
┌─────────────────────────────────────────────────┐
│                live                             │
│ (streaming audio, receiving transcript/tools)   │
└─────────────┬───────────────────────────────────┘
              │ END_CALL
              ▼
┌─────────────────────────────────────────────────┐
│            saving_to_db                         │
│ (persist transcript, await session_ended ack)   │
└───────────────┬─────────────────────────────────┘
                │ transcript saved
                ▼
              idle

Any state → error (via SOCKET_ERROR, SOCKET_CLOSED, etc.)
error → connecting (retry with exponential backoff)
```

### Context

```typescript
interface LiveVoiceMachineContext {
  // Session metadata
  characterId: string
  userId: string
  firebaseToken: string
  
  // Conversational state
  transcript: IMessage[]  // Accumulated { user._id, text, createdAt }
  activeTool: string | null  // e.g., "wiki_read", cleared on tool_end
  remainingCredits: number  // Updated per usage_snapshot
  
  // Network state
  socketError: string | null
  retryCount: number
  maxRetries: number
  
  // Hardware reference (non-serializable, kept for cleanup)
  wsConnection: WebSocket | null
}
```

### Events

```typescript
type LiveVoiceEvent =
  // User-initiated
  | { type: 'START_CALL' }
  | { type: 'AUDIO_INPUT'; data: string }  // base64-encoded PCM
  | { type: 'END_CALL' }

  // Server-originated (forwarded by controller hook)
  | { type: 'SOCKET_OPENED' }
  | { type: 'AUDIO_OUTPUT'; data: string }  // base64
  | { type: 'TRANSCRIPT_TOKEN'; role: 'user' | 'model'; text: string }
  | { type: 'TOOL_START'; name: string }
  | { type: 'TOOL_END'; name: string }
  | { type: 'USAGE_SNAPSHOT'; remainingCredits: number }
  | { type: 'AUDIO_INTERRUPTED' }
  | { type: 'SESSION_ENDED' }

  // Error handling
  | { type: 'SOCKET_ERROR'; message: string }
  | { type: 'SOCKET_CLOSED' }
  | { type: 'RETRY' }
  | { type: 'SEND_END_SESSION' }
```

### Key Transitions

**idle → syncing_memory (on START_CALL)**
- Invoke `wiki.exportDump([characterId])`
- Pass result to `wikiSync` Firebase callable
- On success → transition to `connecting`
- On error → transition to `error`

**connecting → live (on SOCKET_OPENED)**
- Send `{ type: 'auth', token: firebaseToken }` over WebSocket
- Begin accepting `AUDIO_INPUT` events from mic
- Begin buffering incoming `AUDIO_OUTPUT` for playback

**live (on TRANSCRIPT_TOKEN)**
- Assign action: concatenate token to last message if same role, or create new `IMessage` if role changed
- Update transcript array in context

**live (on TOOL_START / TOOL_END)**
- `TOOL_START`: set `activeTool` to tool name
- `TOOL_END`: clear `activeTool` to null

**live (on USAGE_SNAPSHOT)**
- Update `remainingCredits` in context
- If `remainingCredits <= 0`, transition to `saving_to_db` with `socketError: 'credit_exhausted'`

**live → saving_to_db (on END_CALL)**
- WebSocket actor cleanup: send `{ type: 'end_session' }` and close socket
- Stop recording (controller hook responsibility)
- Preserve transcript in context; transition immediately to `saving_to_db`

**saving_to_db → idle (actor completes)**
- Fire-and-forget: `saveAIMessage` / `sendMessage` per transcript entry (no await)
- Reset transcript, activeTool, socketError, retryCount on transition to idle

**Any state → error (on SOCKET_ERROR or SOCKET_CLOSED)**
- Capture error message in context
- Preserve transcript (never discard)

**error → syncing_memory (on RETRY)**
- Exponential backoff: 0.5s, 1s, 2s, 4s, 8s (max)
- Increment `retryCount`; re-enter full pre-call sync before reconnecting
- If `retryCount >= maxRetries`, stay in error (manual retry only)
- `retryCount` resets to 0 on successful entry to `live` or after `saving_to_db`

### Injected Actions

The controller hook injects these actions directly into the machine:

```typescript
actions: {
  playIncomingAudio: ({ event }) => {
    // AUDIO_OUTPUT received; immediately play it via audioIO.playChunk()
    if (event.type === 'AUDIO_OUTPUT') {
      audioIO.playChunk(event.data)  // base64 → decode → play
    }
  },
  
  flushAudioPlayback: () => {
    // AUDIO_INTERRUPTED received; flush the playback queue
    audioIO.clearPlaybackQueue()
  }
}
```

These actions run synchronously without triggering React re-renders.

---

## 3. Audio Hook — `useLiveAudioIO.ts`

Pure React hook managing hardware audio I/O (microphone and speaker). Isolated from business logic; provides primitives for recording/playback.

### Hook Signature

```typescript
interface UseLiveAudioIOReturn {
  // State
  recordingState: 'idle' | 'recording' | 'error'
  playbackState: 'idle' | 'playing' | 'buffering'
  error: string | null
  
  // Actions
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  playChunk: (base64PCM: string) => Promise<void>
  clearPlaybackQueue: () => void
  
  // Listener for outgoing audio
  onAudioChunk: (cb: (chunk: Uint8Array) => void) => () => void  // Returns unsubscribe
}

export function useLiveAudioIO(): UseLiveAudioIOReturn
```

### Initialization (on Mount)

1. Call `setAudioModeAsync`:
   ```typescript
   await Audio.setAudioModeAsync({
     playsInSilentMode: true,
     allowsRecording: true,
     shouldPlayInBackground: true,
     interruptionMode: 'mixWithOthers'
   })
   ```

2. Request permissions:
   - Native: `requestRecordingPermissionsAsync()` + `ExpoSpeechRecognitionModule.requestPermissionsAsync()`
   - Web: Browser microphone permission prompt

### Recording Configuration (16kHz Input)

```typescript
const recorder = await Audio.Recording.createAsync({
  isMeteringEnabled: false,
  pcmEncoding: true,  // Raw 16-bit PCM, not MP3/AAC
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,    // 16-bit * 16kHz * 1 channel
  android: { audioSource: AndroidAudioSource.MIC }
})

// Emit 20ms chunks (320 samples @ 16kHz)
// Listener: onAudioChunk(Uint8Array)
```

**Implementation detail:** `expo-audio` doesn't natively expose streaming callbacks. Use `react-native-live-audio-stream` or implement file-tailing via `expo-file-system` to access raw PCM buffers.

### Playback Configuration (24kHz Output)

```typescript
const player = createAudioPlayer({
  // Configured for 24kHz PCM playback
})

playChunk(base64PCM):
  1. Decode base64 → Uint8Array
  2. Push to internal Ring Buffer (e.g., shared.push(chunk))
  3. If buffer was empty and player not playing, start playback
  4. Player reads from buffer synchronously
  5. On playback end, pop next chunk from queue
  6. If queue empty, stop player

clearPlaybackQueue():
  - Flush all pending chunks from buffer
  - Stop player immediately
  - Called when audio_interrupted event received
```

**Implementation detail:** To avoid audio stutters between chunks without introducing latency, use a native streaming library (like `react-native-live-audio-stream`) that supports continuous, appendable PCM buffers on the native side. If forced to concatenate in JS, keep the buffer tight: 100-200ms maximum (avoid >500ms latency that destroys natural conversation flow).

### Error Handling

- **Permission denied:** Set `recordingState = 'error'`, expose error message to controller hook
- **Hardware unavailable:** Set `playbackState = 'error'`, gracefully fail `startRecording()` / `playChunk()`
- **Cleanup on unmount:** Stop recorder, flush playback queue, release all resources

---

## 4. Controller Hook — `useLiveVoiceChat.ts`

Thin React hook that wires the XState machine and audio hardware together. Exposes clean, derived state for the Talk tab UI. Manages lifecycle and error recovery.

### Hook Signature

```typescript
interface UseLiveVoiceChatReturn {
  // Session state
  isConnecting: boolean
  isLive: boolean
  error: string | null
  
  // UI state (derived from machine + audio hook)
  transcript: IMessage[]
  activeTool: string | null
  remainingCredits: number
  
  // Audio playback state
  isPlayingAudio: boolean
  
  // Actions
  startCall: () => Promise<void>
  endCall: () => Promise<void>
  cancelCall: () => void
}

export function useLiveVoiceChat(characterId: string): UseLiveVoiceChatReturn
```

### Implementation

1. **Instantiate XState machine with injected actions:**
   ```typescript
   const audioIO = useLiveAudioIO()
   const [state, send, actor] = useMachine(liveVoiceMachine, {
     actions: {
       playIncomingAudio: ({ event }) => {
         if (event.type === 'AUDIO_OUTPUT') {
           audioIO.playChunk(event.data)
         }
       },
       flushAudioPlayback: () => {
         audioIO.clearPlaybackQueue()
       }
     }
   })
   ```

2. **Wire microphone → WebSocket:**
   ```typescript
   useEffect(() => {
     const unsubscribe = audioIO.onAudioChunk((chunk) => {
       send({ type: 'AUDIO_INPUT', data: chunk })
     })
     return unsubscribe
   }, [send, audioIO])
   ```

3. **Forward server events to machine:**
   ```typescript
   // In controller hook's useEffect listening to WebSocket
   ws.onmessage = (event) => {
     const payload = JSON.parse(event.data)
     send({
       type: payload.type.toUpperCase(),
       ...payload
     })
   }
   ```

4. **Derive clean state for UI:**
   ```typescript
   const isConnecting = state.matches('connecting')
   const isLive = state.matches('live')
   const transcript = state.context.transcript
   const activeTool = state.context.activeTool
   const remainingCredits = state.context.remainingCredits
   const isPlayingAudio = audioIO.playbackState === 'playing'
   const error = state.matches('error') ? state.context.socketError : null
   ```

### Lifecycle: startCall()

```
1. Check character.voice exists
   ↓ if missing → error: "No voice selected"
2. Check remainingCredits >= 2
   ↓ if low → error: "Insufficient credits"
3. Check character.save_to_cloud === 1
   ↓ if false → error: "Voice chat requires cloud sync"
4. Request recording permissions via audioIO.startRecording()
   ↓ if denied → error: "Microphone permission required"
5. send({ type: 'START_CALL' })
   ↓ machine: idle → syncing_memory
6. await wiki.exportDump([characterId]) + wikiSync()
   ↓ machine: syncing_memory → connecting
7. Open WebSocket, send auth
   ↓ machine: connecting → live (on SOCKET_OPENED)
```

### Lifecycle: endCall()

```
1. send({ type: 'END_CALL' })
   ↓ machine: live → saving_to_db
2. Stop recording
3. Send { type: 'end_session' } over WebSocket
4. Await SESSION_ENDED from server
5. Call saveAIMessage(characterId, userId, transcript)
6. machine: saving_to_db → idle
```

### Lifecycle: cancelCall()

```
1. Immediately stop recording
2. Close WebSocket
3. Clear playback queue
4. machine: [any] → idle (via error → idle or direct)
```

### AppState Listener (Critical for Mobile)

```typescript
useEffect(() => {
  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState.match(/inactive|background/) && state.matches('live')) {
      endCall()  // Gracefully close socket, save transcript
    }
  })
  return () => subscription.remove()
}, [state, endCall])
```

Ensures that backgrounding the app immediately closes the WebSocket and microphone, preventing resource leaks and OS-level permission revocation.

---

## 5. Error Handling & Edge Cases

### Network Drops During Live Session

```
Event: SOCKET_ERROR or SOCKET_CLOSED (unexpected)

Action:
  - Stop recording
  - Clear playback queue
  - Preserve transcript (never discard)
  - Set error state
  
Recovery:
  - Show "Connection lost" error
  - Exponential backoff retry: 0.5s, 1s, 2s, 4s, 8s (max)
  - Max 5 retries
  - After max retries, show "Manual retry" button
  - User can tap to restart session
```

### Credit Exhaustion

```
Event: USAGE_SNAPSHOT { remainingCredits: 0 }

Action:
  - Transition live → error (code: 'credit_exhausted')
  - Stop recording
  - Send END_CALL gracefully
  - Save transcript to DB
  
UI:
  - Show "Out of credits" message
  - Button: "Get More Credits" → router.push('/subscribe')
```

### Missing Voice Configuration

```
startCall() → character.voice is null

Action:
  - Error before opening WebSocket
  - error = "This character has no voice. Edit character settings."
  
UI:
  - Show alert with "Edit Character" button
```

### Recording Permission Denied

```
startCall() → audioIO.startRecording() fails

Action:
  - Set error immediately
  - error = "Microphone permission required"
  
UI:
  - Native: Show alert "Enable in Settings"
  - Web: Show alert "Allow in browser"
```

### Local-Only Character (save_to_cloud = 0)

```
startCall() → character.save_to_cloud === 0

Action:
  - Error before opening WebSocket
  - error = "Voice chat requires cloud sync enabled"
  
UI:
  - Show alert with "Enable Cloud Sync" button
  - Prevent streaming to cloud proxy (no memory access)
```

### User Navigates Away

```
Talk tab blur event (React Navigation)

Action:
  - Automatically call cancelCall()
  - Stop recording
  - Close WebSocket
  - Save transcript locally
  
XState cleanup on exit:
  - machine.stop()
  - All resources released
```

### User Backgrounds App (iOS/Android)

```
AppState change → 'inactive' or 'background'

Action:
  - Automatically call endCall()
  - WebSocket closed gracefully
  - Microphone turned off
  - Transcript saved to DB
  
Why necessary:
  - OS revokes microphone permission when app backgrounded
  - WebSocket connections sever automatically
  - Must clean up explicitly to avoid resource leaks
```

### Transcript Persistence Fails

```
saving_to_db → saveAIMessage() throws

Action:
  - Retry with exponential backoff (1 retry only)
  - If retry fails, persist transcript locally (SQLite fallback)
  - Error message: "Transcript saved locally, will sync later"
  
Recovery:
  - User can manually retry via Settings → "Sync Transcripts"
  - Prevents data loss
```

### Concurrent Tab/Window Closing

```
User closes Talk tab while live session active

Machine cleanup:
  - useEffect cleanup runs
  - cancelCall() called
  - WebSocket terminated
  - Transcript saved before cleanup complete
```

**Critical:** The `saveAIMessage` database call in the XState exit action must be fire-and-forget (does not await React state updates). Prevents memory leak warnings if component unmounts before async database write completes.

---

## Summary of Architecture

| Layer | Responsibility | Technology |
|-------|---|---|
| **Interface Boundary** | JSON payloads + base64 PCM | WebSocket contract |
| **XState Machine** | Session lifecycle, transcript accumulation, tool state | XState v5 |
| **Audio Hook** | Recording/playback primitives, 16kHz/24kHz PCM | expo-audio + react-native-live-audio-stream |
| **Controller Hook** | Machine ↔ Audio wiring, derived UI state, lifecycle management | React hooks + XState inject |
| **Talk Tab UI** | Render transcript, tool banners, status messages | React Native |

### Key Design Decisions

1. **Pre-call sync uses existing `wikiSync` pipeline** → no WebSocket overhead, LWW conflict resolution proven
2. **WebSocket is pure audio + events** → stateless, lean, scalable
3. **Injected XState actions for audio** → zero React re-renders per 20ms chunk, no missed audio
4. **Transcript never discarded** → local SQLite fallback ensures data safety
5. **AppState listener on mobile** → graceful shutdown when OS backgrounds app
6. **Credit-aware streaming** → per-chunk billing snapshot prevents surprise overage

---

## Acceptance Criteria

- [ ] Machine transitions are bulletproof; no race conditions between mic → socket → speaker
- [ ] Audio playback is smooth; no micro-stutters between 24kHz chunks
- [ ] Transcript accumulated correctly; same-role tokens concatenated, role-switch creates new message
- [ ] Barge-in works; user can interrupt mid-sentence and be heard immediately
- [ ] Network drops recover; exponential backoff with manual retry fallback
- [ ] Credits tracked in real-time; zero-credit state prevents further streaming
- [ ] Transcript persists locally if cloud save fails; zero data loss
- [ ] App backgrounding handled; AppState listener closes socket and mic
- [ ] Navigation away handled; blur event triggers cleanup
- [ ] Local-only characters blocked; prevents proxy confusion

