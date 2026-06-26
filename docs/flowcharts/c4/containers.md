# Containers — Clanker

_Manually maintained. Update when a new container is added or a relationship changes._

```mermaid
C4Container
  title Container Diagram — Clanker

  Person(user, "User", "Mobile or web user")

  System_Boundary(clanker_b, "Clanker") {
    Container(app, "Clanker App", "Expo React Native (shared mobile/web)", "UI plus edge agent orchestration (useEdgeAgent) for text chat; Talk tab live voice via XState + WebSocket /agent/live. 90%+ shared code across mobile and web.")
    Container(sqlite, "Local SQLite", "expo-sqlite", "Offline-first store: messages, characters, wiki/memory (expo-llm-wiki), and tasks. Messages never leave device.")
  }

  System_Boundary(firebase_b, "Firebase") {
    Container(auth, "Firebase Auth", "Firebase Auth", "Identity and session tokens. Google Sign-In and email.")
    Container(functions, "Cloud Functions", "Firebase Functions (Node.js)", "generateReply BYOI proxy, exchangeToken, summarizeText, wikiLlm/wikiSync, generateImage, character sync. HTTP webhooks: Stripe and RevenueCat.")
  }

  System_Boundary(gcp_b, "Google Cloud") {
    Container(cloudsql, "Cloud SQL", "PostgreSQL", "Users, credits, subscriptions; cloud character backup; wiki/task mirror for save_to_cloud characters.")
    Container(cloudagent, "Cloud Agent", "Cloud Run (Node.js/Express + Google ADK)", "Stateless ADK agent. Text: WebSocket /agent/stream (token + tool streaming) with HTTP /agent/run fallback. Voice: WebSocket /agent/live (Gemini Live API). Verified via Firebase ID tokens.")
  }

  System_Ext(gemini, "Vertex AI (Gemini)", "LLM completions (model selected server-side)")
  System_Ext(revenuecat, "RevenueCat", "Mobile IAP (native SDK)")
  System_Ext(stripe, "Stripe", "Web subscription payments")

  Rel(user, app, "Uses", "HTTPS / native")
  Rel(app, auth, "Sign-in and token refresh")
  Rel(app, functions, "generateReply (edge agent + fallback), bootstrap, wiki, media, character sync")
  Rel(app, cloudagent, "Escalated text chat and live voice (cloud-synced characters)", "WebSocket /agent/stream or /agent/live (HTTP /agent/run text fallback) + Bearer token")
  Rel(app, sqlite, "All local reads and writes")
  Rel(app, stripe, "Checkout session redirect (web)")
  Rel(app, revenuecat, "Native IAP (SDK)")
  Rel(stripe, functions, "Checkout/subscription webhooks")
  Rel(revenuecat, functions, "Purchase webhooks")
  Rel(functions, cloudsql, "Users, credits, subscriptions, wiki cloud mirror")
  Rel(functions, gemini, "LLM calls (generateReply, wikiLlm, summarizeText, generateImage, …)")
  Rel(cloudagent, auth, "Verify Firebase ID token")
  Rel(cloudagent, cloudsql, "Character data, tasks, wiki events (Drizzle ORM)")
  Rel(cloudagent, gemini, "LLM calls via Google ADK")
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

> **Note:** The `/agent/live` Cloud Agent handler is deployed separately from the client.

See [Edge Agent](../../edge-agent.md) and [AI & Chat](../../ai-and-chat.md).
