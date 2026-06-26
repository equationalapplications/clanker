# Real-Time Voice Chat (Talk Tab)

## Overview

The **Talk** tab provides continuous voice calls with your character via the **Gemini Live API**. Unlike the old walkie-talkie flow (`expo-speech-recognition` + one-shot replies), the user starts a call, speaks naturally, and hears streamed AI audio in real time—with barge-in, live transcript, tool execution, and credit tracking over a single WebSocket session.

The client never calls Gemini directly. Audio and model access go through the **Cloud Agent** at WebSocket `/agent/live` (Firebase ID token auth). Pre-call memory uses the existing `wikiSync` callable before the socket opens.

> **Server note:** The `/agent/live` Cloud Agent handler is deployed separately from the Expo client. Text chat continues to use `/agent/stream` and `/agent/run`.

For C4-level routing diagrams, see [Architecture Charts — C4](flowcharts/c4/system-context.md).

---

## User Requirements

Before a call starts, `useLiveVoiceChat` enforces:

| Requirement | Why |
|---|---|
| Character has a **voice** configured | Gemini Live needs a voice profile |
| **`save_to_cloud` enabled** | Wiki/memory must sync so the agent can read cloud-backed memory |
| **≥ 2 credits** remaining | Live sessions bill via usage snapshots on the socket |

If any check fails, the user sees an alert with a shortcut to character edit or subscribe.

---

## Session Flow

```
Talk tab: Start Call
    → Pre-flight checks (voice, credits, cloud sync)
    → Mic permission + 16 kHz PCM capture (native)
    → liveVoiceMachine: syncing_memory (wiki.exportDump → wikiSync)
    → WebSocket connect to …/agent/live + auth token
    → Live: bidirectional audio, transcript tokens, tools, credit snapshots
    → End call / background / navigate away
    → Transcript saved to SQLite (fire-and-forget)
```

**Teardown triggers:** user taps End Call, navigation blur, or app background while live.

---

## Client Architecture

| Module | Role |
|---|---|
| `useLiveVoiceChat` | Controller: pre-flight checks, wires machine + audio, exposes Talk tab state |
| `liveVoiceMachine` | XState v5 lifecycle: sync → connect → live → save → idle; WebSocket actor |
| `useLiveAudioIO` | Hardware: 16 kHz mic uplink (`react-native-live-audio-stream`), 24 kHz PCM playback queue (`expo-audio`), barge-in flush |

**Key files:**

- `src/hooks/useLiveVoiceChat.ts`
- `src/machines/liveVoiceMachine.ts`
- `src/hooks/useLiveAudioIO.ts`
- `app/(drawer)/(tabs)/talk/index.tsx`

---

## WebSocket Protocol (summary)

JSON payloads; audio is base64-encoded PCM.

**Client → server:** `auth`, `audio_input`, `end_session`  
**Server → client:** `audio_output`, `transcript_token`, `tool_start` / `tool_end`, `audio_interrupted`, `usage_snapshot`, `error`, `session_ended`

Transcript tokens with the same role are concatenated into one message. `usage_snapshot` with `remainingCredits: 0` ends the session and persists the transcript.

---

## Audio

| Direction | Format | Library |
|---|---|---|
| Mic uplink | 16 kHz, mono, 16-bit PCM | `react-native-live-audio-stream` |
| Speaker downlink | 24 kHz PCM chunks | `expo-audio` playback queue |

`react-native-live-audio-stream` is a **native module**. OTA updates are not enough after install—rebuild the dev client or production app (`npm run build:dev-a`, `build:dev-i`, or EAS equivalent).

---

## Testing

Unit tests cover the machine, audio hook, and controller (no device required):

```bash
npx jest __tests__/liveVoiceMachine.test.ts __tests__/useLiveAudioIO.test.tsx __tests__/useLiveVoiceChat.test.tsx --no-coverage
```

Set `EXPO_PUBLIC_CLOUD_AGENT_URL` for runtime WebSocket URL derivation (see `liveVoiceMachine.ts`).

---

## Related Docs

- **[AI & Chat](ai-and-chat.md)** — Text chat pipeline, wiki memory, Cloud Agent text paths
- **[Edge Agent](edge-agent.md)** — On-device text tool loop (separate from voice)
- **[Billing & Credits](billing-and-credits.md)** — Credit ledger and subscriptions
