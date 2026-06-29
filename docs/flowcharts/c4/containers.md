# Containers — Clanker

_Manually maintained. Update when a new container is added or a relationship changes._

```mermaid
C4Container
  title Container Diagram — Clanker

  Person(user, "User", "Mobile voice/text user; desktop Chrome user with paired extension")

  System_Boundary(clanker_b, "Clanker") {
    Container(app, "Clanker App", "Expo React Native (shared mobile/web)", "UI plus edge agent orchestration (useEdgeAgent) for text chat; Talk tab live voice via XState + WebSocket /agent/live. Expo Push receiver and approval UI (Phase 2+). 90%+ shared code across mobile and web.")
    Container(extension, "Desktop Bridge Extension", "MV3 Chrome extension", "Idle until FCM wake. Service worker opens /agent/browser WebSocket, dispatches Task DSL to content scripts. Firebase Auth via offscreen document; device pairing via register-device.")
    Container(sqlite, "Local SQLite", "expo-sqlite", "Offline-first store: messages, characters, wiki/memory (expo-llm-wiki), and tasks. Messages never leave device.")
  }

  System_Boundary(firebase_b, "Firebase") {
    Container(auth, "Firebase Auth", "Firebase Auth", "Identity and session tokens. Google Sign-In and email (mobile app and extension side panel).")
    Container(firestore, "Firestore", "Native mode", "Session/task/auth coordination bus for browser bridge. Tenant-scoped under users/{uid}/. Client read-only on tasks; server-owned writes via Admin SDK.")
    Container(functions, "Cloud Functions", "Firebase Functions (Node.js)", "generateReply BYOI proxy, exchangeToken, summarizeText, wikiLlm/wikiSync, generateImage, character sync. HTTP webhooks: Stripe and RevenueCat.")
  }

  System_Boundary(gcp_b, "Google Cloud") {
    Container(cloudsql, "Cloud SQL", "PostgreSQL", "Users, credits, subscriptions; cloud character backup; wiki/task mirror for save_to_cloud characters.")
    Container(cloudagent, "Cloud Agent", "Cloud Run (Node.js/Express + Google ADK)", "Stateless ADK agent per instance (INSTANCE_ID). Text: WebSocket /agent/stream + HTTP /agent/run. Voice: WebSocket /agent/live (Gemini Live API). Browser bridge: browser_action tool, /agent/browser WS, sessionBridge (same-instance shortcut), firestoreSession, fcmDispatcher. Verified via Firebase ID tokens.")
  }

  System_Ext(gemini, "Vertex AI (Gemini)", "LLM completions (model selected server-side)")
  System_Ext(expo_push, "Expo Push", "Mobile push — approval cards and async task completion (Phase 2+)")
  System_Ext(revenuecat, "RevenueCat", "Mobile IAP (native SDK)")
  System_Ext(stripe, "Stripe", "Web subscription payments")

  Rel(user, app, "Uses", "HTTPS / native")
  Rel(user, extension, "Pairs device, grants host permissions", "Chrome side panel")
  Rel(app, auth, "Sign-in and token refresh")
  Rel(app, firestore, "Read sessions/tasks; write auth approvals (Phase 2+)", "Firebase client SDK")
  Rel(app, functions, "generateReply (edge agent + fallback), bootstrap, wiki, media, character sync")
  Rel(app, cloudagent, "Escalated text chat and live voice", "WebSocket /agent/stream or /agent/live (HTTP /agent/run text fallback) + Bearer token")
  Rel(app, sqlite, "All local reads and writes")
  Rel(app, stripe, "Checkout session redirect (web)")
  Rel(app, revenuecat, "Native IAP (SDK)")
  Rel(extension, auth, "Sign-in via offscreen Firebase Auth SDK")
  Rel(extension, cloudagent, "Wake-and-Connect task execution", "WebSocket /agent/browser + POST /agent/browser/register-device + Bearer token")
  Rel(stripe, functions, "Checkout/subscription webhooks")
  Rel(revenuecat, functions, "Purchase webhooks")
  Rel(functions, cloudsql, "Users, credits, subscriptions, wiki cloud mirror")
  Rel(functions, gemini, "LLM calls (generateReply, wikiLlm, summarizeText, generateImage, …)")
  Rel(cloudagent, auth, "Verify Firebase ID token (mobile, extension, approval tokens)")
  Rel(cloudagent, firestore, "Session/task/device coordination", "Firebase Admin SDK")
  Rel(cloudagent, cloudsql, "Character data, tasks, wiki events, credits (Drizzle ORM)")
  Rel(cloudagent, gemini, "LLM calls via Google ADK (text, voice, browser_action)")
  Rel(cloudagent, extension, "FCM WAKE_AND_CONNECT silent push", "Firebase Admin messaging()")
  Rel(cloudagent, expo_push, "Approval cards, async task complete (Phase 2+)", "REST")
```

## Text chat routing (summary)

Priority order in `useAIChat` after send:

1. **Edge resolved** — `useEdgeAgent` loop returns text; each iteration billed via `generateReply`.
2. **Cloud Agent** — `callCloudAgent` tries WebSocket `/agent/stream` first (streaming tokens and tool events); falls back to HTTP `POST /agent/run` on connection or auth failure. Used when character is cloud-synced (or dev sandbox) and `EXPO_PUBLIC_CLOUD_AGENT_URL` is set.
3. **Firebase fallback** — `sendMessageWithAIResponse` → `generateReply` with optional unsynced history.

## Voice routing (Talk tab)

`useLiveVoiceChat` on the Talk tab (native only for mic streaming):

1. **Pre-call wiki sync** — `wikiSync` callable via `liveVoiceMachine` before WebSocket connect.
2. **Live session** — WebSocket `/agent/live`: 16 kHz mic uplink, 24 kHz PCM downlink, transcript tokens, tool events, credit snapshots. Requires `save_to_cloud`, voice, and credits.
3. **Teardown** — transcript persisted to SQLite; session ends on hang-up, navigation blur, or app background.

## Browser bridge routing (Desktop Bridge extension)

Three-node async loop. Voice WS and browser WS may land on different Cloud Run instances; Firestore is the sole cross-instance routing bus.

| Node | Container | Connection |
|------|-----------|------------|
| Mobile | Clanker App | `/agent/live` or `/agent/run` (triggers `browser_action`) |
| Coordinator | Cloud Agent | In-memory `sessionBridge` per instance; Firestore writes + FCM dispatch |
| Desktop | Desktop Bridge Extension | Idle (FCM) → active (`/agent/browser` WS on wake) |

**Happy path:**

1. **Trigger** — `browser_action` ADK tool (`cloud-agent/src/tools/browserAction.ts`) creates `sessionId` + `taskId`, writes session/task docs to Firestore, calls `fcmDispatcher.wakeExtension`.
2. **Wake** — Extension service worker receives FCM `WAKE_AND_CONNECT`, mints ID token via offscreen auth, connects `/agent/browser` with auth frame.
3. **Execute** — Browser-side handler calls `markBrowserConnected`, sends `session_ready`, dispatches Task DSL to content scripts via `chrome.scripting.executeScript`.
4. **Result** — Extension returns `task_result` via WS; Cloud Agent writes to Firestore; voice-side `watchTask` listener delivers to Gemini Live (or text path `await`s with 30s cap).
5. **Teardown** — `session_end` frame; extension closes WS and offscreen auth doc; service worker suspends.

**Phase 2+ approval path:** Extension halts on destructive action → auth doc in Firestore → Expo Push approval card → mobile writes approval → FCM re-wake with `resume: true`.

> **Note:** `sessionBridge.voiceWs` / `browserWs` are same-instance shortcuts only. Primary result delivery is always the Firestore `watchTask` listener on the voice-side instance.

See [Edge Agent](../../edge-agent.md), [AI & Chat](../../ai-and-chat.md), and the [MV3 Browser Extension Bridge design spec](../../superpowers/specs/2026-06-29-mv3-browser-extension-bridge-design.md).
