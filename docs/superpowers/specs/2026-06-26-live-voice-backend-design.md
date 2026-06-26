# Live Voice Backend — Phase 2 Specification

**Date:** 2026-06-26  
**Status:** Ready for implementation  
**Project:** Clanker Cloud Agent  
**Feature:** Gemini Live API WebSocket Proxy (`/agent/live`)  
**Scope:** Cloud Run backend handler, tool adapter, voice resolution, frontend voice list update  
**Depends on:** `docs/superpowers/specs/2026-06-26-real-time-voice-chat-design.md` (Phase 1 frontend)

---

## Overview

Phase 1 delivered the client-side contract: `useLiveVoiceChat` hook, `liveVoiceMachine` XState machine, and `useLiveAudioIO` hardware layer. The WebSocket protocol is locked.

Phase 2 builds the Cloud Run `/agent/live` WebSocket proxy. It authenticates the connection, opens a bi-directional Gemini Live API session, routes audio in and out, intercepts tool calls and executes them server-side, and runs a continuous 60-second credit billing loop.

---

## 1. New Files & Minimal Existing Changes

### New files

| File | Role |
|------|------|
| `cloud-agent/src/handlers/wsLiveAgentHandler.ts` | Main handler — auth, Gemini Live bridge, tool intercept, billing loop |
| `cloud-agent/src/services/liveToolAdapter.ts` | `buildLiveTools()` — extracts declarations + executors from ADK FunctionTool factories |

### Updated files

| File | Change |
|------|--------|
| `cloud-agent/src/index.ts` | Replace two separate upgrade listeners with single centralized `attachWebSocketRoutes()` router; remove `else { socket.destroy() }` from stream handler |
| `src/constants/geminiVoices.ts` | Replace 30-voice TTS list with 5 Live API voices |
| `app/(drawer)/(tabs)/characters/[id]/edit.tsx` | Update voice picker to use new `GEMINI_LIVE_VOICES` constant |

No changes to `wsAgentHandler.ts`, `creditService.ts`, or any existing tool files.

---

## 2. Architecture & Data Flow

```
Mobile client (Expo)
  │
  │── { type: 'auth', token, characterId } ──────────────────────▶ /agent/live (WS)
  │◀─ { type: 'session_ready', remainingCredits }
  │
  │── { type: 'audio_input', data: '<base64 16kHz PCM>' } ───────▶ handler
  │                                                                     │ decode → Blob
  │                                                                     │ sendRealtimeInput()
  │                                                                     ▼
  │                                                           Gemini Live API (bidi WS)
  │                                                                     │
  │                                                      LiveServerMessage.serverContent
  │                                                                     ├─ audio → audio_output
  │                                                                     ├─ text → transcript_token (model)
  │                                                                     └─ inputTranscript → transcript_token (user)
  │                                                      LiveServerMessage.toolCall
  │                                                                     ├─ tool_start → client
  │                                                                     ├─ executors.get(name)(args)
  │                                                                     ├─ sendToolResponse()
  │                                                                     └─ tool_end → client
  │◀─ audio_output / transcript_token / tool_start / tool_end / usage_snapshot ──────
  │
  │── { type: 'end_session' } ─────────────────────────────────▶ clearAndClose()
  │◀─ { type: 'session_ended' }
```

**Lifecycle difference from `/agent/stream`:** `/agent/stream` is a one-shot ADK runner — it resolves a single prompt and closes. `/agent/live` is a long-lived stateful bidi pipe that stays open until an explicit `end_session`, credit exhaustion, or network error. No `hasRun` guard.

---

## 3. WebSocket Protocol Additions

Phase 1 defined the core payload contract. Phase 2 adds one new server→client event:

### New: `session_ready`

```json
{ "type": "session_ready", "remainingCredits": 42 }
```

Sent after Firebase auth, Cloud SQL user lookup, credit check, and `ai.live.connect()` all complete. The client must not send `audio_input` before receiving this event — Gemini is not listening until then. This replaces the implicit "socket open = ready" assumption from Phase 1.

**Auth payload (client→server) carries `characterId`:**

```json
{ "type": "auth", "token": "<firebase-id-token>", "characterId": "<uuid>" }
```

Character must be fetched at auth time so the voice name is known before `ai.live.connect()`.

---

## 4. Auth & Session Initialization Sequence

```
Client opens WS to /agent/live
  │
  ├─ Wait for { type: 'auth', token, characterId }  [5s timeout → 4001]
  │
  ├─ verifyToken(token) → firebase uid
  ├─ db: SELECT id FROM users WHERE firebase_uid = uid  [not found → 4001]
  │
  ├─ creditService.getBalance(userId)
  │   └─ balance <= 0 → error INSUFFICIENT_CREDITS, close 4402
  │
  ├─ db: SELECT * FROM characters WHERE id = characterId AND user_id = userId
  │   └─ not found → error CHARACTER_NOT_FOUND, close 4404
  │
  ├─ resolveVoice(character.voice) → validated Live API voice name
  ├─ buildLiveTools(db, userId, characterId, embedText, timezone)
  ├─ ai.live.connect({ model, config: { systemInstruction, speechConfig, tools } })
  │
  ├─ start billing timer (setInterval 60s)
  └─ ws.send({ type: 'session_ready', remainingCredits: balance })
```

**Auth schema (zod):**

```typescript
const liveAuthSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
  characterId: z.string().uuid(),
})
```

**Gemini session config:**

```typescript
await ai.live.connect({
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  callbacks: { onmessage: handleGeminiMessage, onclose: handleGeminiClose },
  config: {
    systemInstruction: assembleSystemInstruction(character, ''),
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: resolveVoice(character.voice) }
      }
    },
    tools: [{ functionDeclarations: declarations }, { googleSearch: {} }],
    responseModalities: ['AUDIO'],   // Live API supports one modality; transcripts come via inputAudioTranscription/outputAudioTranscription
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  },
})
```

`systemInstruction` uses empty `wikiContext` — the client's pre-call `wikiSync` already pushed memory to Cloud SQL before opening the socket. `wikiReadTool` retrieves context on demand during the call.

---

## 5. Tool Adapter (`liveToolAdapter.ts`)

### Interface

```typescript
interface LiveToolSet {
  declarations: FunctionDeclaration[]
  executors: Map<string, (args: unknown) => Promise<unknown>>
}

export function buildLiveTools(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  embed: (text: string) => Promise<number[]>,
  timezone: string,
): LiveToolSet
```

### Implementation

Instantiate each existing ADK tool factory (preserving closure-based `userId`/`characterId` security), then extract declaration + executor:

```typescript
const adkTools = [
  getCurrentTimeTool(timezone),
  wikiReadTool(db, userId, characterId, embed),
  wikiWriteTool(db, userId, characterId, embed),
  wikiGetOntologyManifestTool(db, userId, characterId),
  wikiTraverseGraphTool(db, userId, characterId),
  createTaskTool(db, userId, characterId),
  listTasksTool(db, userId, characterId),
  updateTaskTool(db, userId, characterId),
  completeTaskTool(db, userId, characterId),
  deleteTaskTool(db, userId, characterId),
  documentSearchTool(db, userId, characterId),
  setReminderTool(db, userId, characterId),
]

const declarations = adkTools.map(t => t._getDeclaration())
const executors = new Map(
  adkTools.map(t => [
    t.name,
    // FunctionTool.execute is private; cast matches existing test patterns in the codebase
    (t as unknown as { execute: (args: unknown) => Promise<unknown> }).execute.bind(t),
  ])
)
```

> **Why `_getDeclaration()` not `zodToFunctionDeclaration`:** `FunctionTool._getDeclaration()` is the ADK-native path — it produces exactly the `FunctionDeclaration` the model already receives via ADK, so schema output is guaranteed consistent. `FunctionTool.execute` is `private`; the cast is the same pattern used by existing tool tests. No `zod-to-json-schema` dependency needed.

### Notes

- `wikiWriteTool` is intentionally included — the agent can commit memory entries mid-call ("Remember that I prefer afternoons for meetings").
- `GOOGLE_SEARCH` is excluded from the tool list — Gemini Live handles it natively via `{ googleSearch: {} }` in `config.tools`. It does not emit a `toolCall` event and requires no `tool_start`/`tool_end` banner.
- High-latency tools (`wikiTraverseGraphTool`, `documentSearchTool`) are included; the `tool_start` banner on the client prevents dead-air confusion.

---

## 6. Gemini Live Bridge

### Audio input routing

```typescript
case 'audio_input': {
  geminiSession.sendRealtimeInput({
    media: { data: payload.data, mimeType: 'audio/pcm;rate=16000' }
  })
  break
}
```

> **`sendRealtimeInput()` confirmed** in `@google/genai` v1.50.1 type definitions (line 9953). Pass `payload.data` (base64 string) directly — `BlobImageUnion.data` is typed as `string`, so decoding to `Buffer` first is both wrong and wasteful.

### `handleGeminiMessage(msg: LiveServerMessage)`

```
msg.serverContent.modelTurn.parts
  └─ inlineData (audio bytes)
      └─ base64-encode → ws.send({ type: 'audio_output', data })

msg.serverContent.outputTranscription.text
  └─ ws.send({ type: 'transcript_token', role: 'model', text })

msg.serverContent.inputTranscription.text
  └─ ws.send({ type: 'transcript_token', role: 'user', text })

msg.serverContent.interrupted === true
  └─ ws.send({ type: 'audio_interrupted' })

msg.toolCall
  └─ tool execution interceptor (Section 7)
```

> **Transcript field names:** `@google/genai` v1.50.1 (genai.d.ts lines 7679/7684) uses `inputTranscription` / `outputTranscription` (type `Transcription { text: string }`). The field `inputTranscript` does not exist. With `native-audio-dialog`, model spoken text arrives via `outputTranscription`, not `modelTurn.parts` text — those parts carry audio `inlineData` only.

### `handleGeminiClose()`

```typescript
function handleGeminiClose() {
  ws.send(JSON.stringify({ type: 'error', code: 'GEMINI_DISCONNECTED', message: 'Upstream connection lost' }))
  clearAndClose()
}
```

### `end_session` from client

```typescript
case 'end_session': {
  ws.send(JSON.stringify({ type: 'session_ended' }))
  clearAndClose()
  break
}
```

---

## 7. Tool Execution Interceptor

```typescript
if (msg.toolCall?.functionCalls?.length) {
  for (const call of msg.toolCall.functionCalls) {
    ws.send(JSON.stringify({ type: 'tool_start', name: call.name }))

    let result: unknown
    try {
      const executor = executors.get(call.name)
      if (!executor) throw new Error(`Unknown tool: ${call.name}`)
      result = await executor(call.args ?? {})
    } catch (err) {
      result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
    }

    geminiSession.sendToolResponse({
      functionResponses: [{
        id: call.id,
        name: call.name,
        response: { output: result },
      }]
    })

    ws.send(JSON.stringify({ type: 'tool_end', name: call.name }))
  }
}
```

> **Implementation note:** `sendToolResponse()` is confirmed in `@google/genai` v1.50.1 type definitions (line 9968). If the installed version differs, use `session.send({ toolResponse: { functionResponses: [...] } })`.

**Constraints:**
- `for...of` (sequential), not `Promise.all` — Gemini Live queues tool calls one at a time; concurrent sends corrupt response order.
- Tool errors return `{ error: '...' }` as the function response so Gemini voices the failure rather than crashing the session.
- Gemini automatically pauses audio output while awaiting `sendToolResponse`.

---

## 8. Continuous Billing Loop

### Timer lifecycle

Billing timer starts immediately after `session_ready` is sent. First deduction fires at T+60s — the first minute is effectively free within the opened connection.

```typescript
let billingTimer: ReturnType<typeof setInterval> | null = null

billingTimer = setInterval(async () => {
  try {
    await cs.spendCredit(userId)
    const balance = await cs.getBalance(userId)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'usage_snapshot', remainingCredits: balance }))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'INSUFFICIENT_CREDITS') {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'usage_snapshot', remainingCredits: 0 }))
        ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
      }
      clearAndClose()
    } else {
      // Transient DB error — log but don't kill the session
      console.error('[live billing] unexpected spendCredit error:', err)
    }
  }
}, 60_000)
```

**Transient DB errors** do not terminate the session. A brief Cloud SQL hiccup should not drop a voice call mid-sentence. Only `INSUFFICIENT_CREDITS` terminates.

If `getBalance` fails after a successful `spendCredit`, skip the snapshot. Client retains last-known balance — consistent with `/agent/run` behavior.

### `clearAndClose()` — all termination paths

```typescript
function clearAndClose() {
  if (billingTimer) {
    clearInterval(billingTimer)
    billingTimer = null
  }
  // Session.close() returns void (synchronous) in @google/genai v1.50.1
  try { geminiSession.close() } catch { /* ignore */ }
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Session ended')
  } catch { /* ignore */ }
}
```

Called from:
1. `end_session` message from client (graceful)
2. `INSUFFICIENT_CREDITS` in billing loop
3. `handleGeminiClose()` (unexpected Gemini disconnect)
4. `ws.on('close')` (client dropped — lost cell service, app backgrounded, etc.)

---

## 9. Error Handling

| Scenario | Close code | Client payload |
|---|---|---|
| Auth timeout (5s) | 4001 | `{ type: 'error', code: 'UNAUTHORIZED' }` |
| Invalid token | 4001 | `{ type: 'error', code: 'UNAUTHORIZED' }` |
| User not in DB | 4001 | `{ type: 'error', code: 'UNAUTHORIZED' }` |
| Character not found | 4404 | `{ type: 'error', code: 'CHARACTER_NOT_FOUND' }` |
| Zero credits at open | 4402 | `{ type: 'error', code: 'INSUFFICIENT_CREDITS' }` |
| Credits exhausted mid-call | 1000 | `usage_snapshot(0)` + `error INSUFFICIENT_CREDITS` |
| `ai.live.connect()` fails | 1011 | `{ type: 'error', code: 'GEMINI_UNAVAILABLE' }` |
| Gemini drops mid-call | 1000 | `{ type: 'error', code: 'GEMINI_DISCONNECTED' }` |
| Tool executor throws | — | none (Gemini voices the failure) |
| Unknown client message type | — | ignore silently |
| Client drops unexpectedly | — | `clearAndClose()` internally |

---

## 10. Voice Resolution

### `resolveVoice(raw: string | null): string`

```typescript
const LIVE_VOICES = new Set(['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'])
const LIVE_VOICE_FALLBACK = 'Aoede'

export function resolveVoice(raw: string | null | undefined): string {
  if (raw && LIVE_VOICES.has(raw)) return raw
  return LIVE_VOICE_FALLBACK
}
```

Legacy TTS voice names (e.g. `'Umbriel'` — the default for characters created before Phase 2) map to `'Aoede'` in memory for the duration of the call. No DB writes. Users can explicitly select a Live API voice from the updated character edit screen.

---

## 11. Frontend Finishing Touches

### `src/constants/geminiVoices.ts`

Replace the existing 30-voice standard TTS list with the 5 voices supported by Gemini Live:

```typescript
export const GEMINI_LIVE_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'] as const
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]
```

### `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

Update the voice picker to iterate `GEMINI_LIVE_VOICES`. No migration needed — existing DB rows with legacy voice names are handled by backend `resolveVoice()`.

---

## 12. `index.ts` Registration

> **Upgrade listener conflict:** The existing `attachAgentStreamWebSocket` currently has an `else { socket.destroy() }` branch that destroys any non-`/agent/stream` socket — meaning a naively separate `server.on('upgrade')` listener for `/agent/live` would never fire. Both routes must be handled inside **one shared upgrade listener**.

Replace the two separate `attachAgent*WebSocket` calls with a single centralized router:

```typescript
// Replace attachAgentStreamWebSocket body — remove its else-destroy branch.
// Both WSS instances are created once, routing happens in one shared listener.

const streamWss = new WebSocketServer({ noServer: true })
const liveWss   = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname

  if (pathname === '/agent/stream') {
    streamWss.handleUpgrade(req, socket, head, (ws) => {
      void handleWsUpgrade(ws, req, { db, verifyToken, creditService, ...wsHandlerOptions })
    })
  } else if (pathname === '/agent/live') {
    liveWss.handleUpgrade(req, socket, head, (ws) => {
      void handleLiveWsUpgrade(ws, req, { db, verifyToken, creditService })
    })
  } else {
    socket.destroy()
  }
})
```

This replaces both `attachAgentStreamWebSocket` and the new `attachLiveAgentWebSocket` — the routing logic lives in one place. **`attachAgentStreamWebSocket` must be updated (not left unchanged) to remove its own `upgrade` listener and `else destroy` branch.**

Call site in entry point:

```typescript
// Single call replaces both attachAgent*WebSocket invocations
attachWebSocketRoutes(server, appOptions)
```

---

## 13. Testing Strategy

### Unit — `liveToolAdapter.test.ts`
- `buildLiveTools()` returns declaration count matching tool list length
- `_getDeclaration()` produces a valid `FunctionDeclaration` with `{ name, description, parameters }` for each tool
- `executors` map contains every declared tool name
- `resolveVoice('Umbriel')` → `'Aoede'`
- `resolveVoice('Puck')` → `'Puck'`
- `resolveVoice(null)` → `'Aoede'`

### Integration — `wsLiveAgentHandler.test.ts`

Inject mock Gemini session via handler options (same pattern as `mockStreamReply` in `wsAgentHandler.ts`):

- Auth timeout → 4001
- Bad `characterId` → 4404
- Zero-credit user at open → 4402
- Valid auth → `session_ready` with balance
- `audio_input` → `sendRealtimeInput` called with `mimeType: 'audio/pcm;rate=16000'`
- Mock `toolCall` event → `tool_start` sent, executor called, `sendToolResponse` called, `tool_end` sent
- Mock `INSUFFICIENT_CREDITS` from billing tick → `usage_snapshot(0)` + error + session closed
- `end_session` from client → `session_ended` ack + socket closed
- Client WS close → billing timer cleared (spy on `clearInterval`)
- Gemini close callback → `GEMINI_DISCONNECTED` error + session closed
- Upgrade router: simultaneous `WS` connections to `/agent/stream` and `/agent/live` both succeed (neither socket destroyed)

---

## 14. Acceptance Criteria

- [ ] `/agent/live` rejects unauthenticated connections within 5 seconds
- [ ] Zero-credit users receive 4402 before Gemini session is opened
- [ ] `session_ready` is sent only after Gemini bidi connection is established
- [ ] 16kHz PCM audio from client reaches Gemini with correct MIME type
- [ ] 24kHz PCM audio from Gemini reaches client as base64 `audio_output`
- [ ] User and model transcripts stream as `transcript_token` events
- [ ] Barge-in: `audio_interrupted` forwarded immediately on `serverContent.interrupted`
- [ ] Tool calls intercepted: `tool_start` → execute → `sendToolResponse` → `tool_end` in order
- [ ] 1 credit deducted per 60 seconds; client receives `usage_snapshot` after each deduction
- [ ] Credit exhaustion terminates session gracefully with `usage_snapshot(0)` before close
- [ ] Billing timer cleared on all close paths (end_session, credit exhaustion, Gemini disconnect, client drop)
- [ ] Legacy voice names (e.g. `'Umbriel'`) resolve to `'Aoede'` without DB writes
- [ ] Character edit voice picker shows only 5 Live API voices
- [ ] Existing `/agent/stream` and `/agent/run` endpoints unaffected
