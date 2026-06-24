# Containers — Clanker

_Manually maintained. Update when a new container is added or a relationship changes._

```mermaid
C4Container
  title Container Diagram — Clanker

  Person(user, "User", "Mobile or web user")

  System_Boundary(clanker_b, "Clanker") {
    Container(app, "Clanker App", "Expo React Native (shared mobile/web)", "UI plus edge agent orchestration (useEdgeAgent): local tool loop, generateReply proxy calls, escalation routing. 90%+ shared code across mobile and web.")
    Container(sqlite, "Local SQLite", "expo-sqlite", "Offline-first store: messages, characters, wiki/memory (expo-llm-wiki), and tasks. Messages never leave device.")
  }

  System_Boundary(firebase_b, "Firebase") {
    Container(auth, "Firebase Auth", "Firebase Auth", "Identity and session tokens. Google Sign-In and email.")
    Container(functions, "Cloud Functions", "Firebase Functions (Node.js)", "generateReply BYOI proxy, exchangeToken, summarizeText, wikiLlm/wikiSync, generateImage, character sync. HTTP webhooks: Stripe and RevenueCat.")
  }

  System_Boundary(gcp_b, "Google Cloud") {
    Container(cloudsql, "Cloud SQL", "PostgreSQL", "Users, credits, subscriptions; cloud character backup; wiki/task mirror for save_to_cloud characters.")
    Container(cloudagent, "Cloud Agent", "Cloud Run (Node.js/Express + Google ADK)", "Stateless ADK agent. Escalated chat for cloud-synced characters. Verified via Firebase ID tokens.")
  }

  System_Ext(gemini, "Vertex AI (Gemini)", "LLM completions (model selected server-side)")
  System_Ext(revenuecat, "RevenueCat", "Mobile IAP (native SDK)")
  System_Ext(stripe, "Stripe", "Web subscription payments")

  Rel(user, app, "Uses", "HTTPS / native")
  Rel(app, auth, "Sign-in and token refresh")
  Rel(app, functions, "generateReply (edge agent + fallback), bootstrap, wiki, media, character sync")
  Rel(app, cloudagent, "Escalated chat for cloud-synced characters", "HTTPS POST /agent/run + Bearer token")
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

## Chat routing (summary)

Priority order in `useAIChat` after send:

1. **Edge resolved** — `useEdgeAgent` loop returns text; each iteration billed via `generateReply`.
2. **Cloud Agent** — `callCloudAgent` when character is cloud-synced (or dev sandbox) and `EXPO_PUBLIC_CLOUD_AGENT_URL` is set.
3. **Firebase fallback** — `sendMessageWithAIResponse` → `generateReply` with optional unsynced history.

See [Edge Agent](../../EDGE_AGENT.md) and [AI & Chat](../../ai-and-chat.md).
