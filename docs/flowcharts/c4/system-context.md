# System Context — Clanker

_Manually maintained. Update when external system integrations change._

```mermaid
C4Context
  title System Context — Clanker

  Person(user, "User", "Mobile or web user")

  System(clanker, "Clanker", "AI character chat app. On-device edge agent orchestrates chat; server backends own all LLM access.")

  System_Ext(firebase, "Firebase", "Auth and Cloud Functions — generateReply BYOI proxy, bootstrap, wiki LLM/sync, media callables, payment webhooks")
  System_Ext(cloudagent, "Cloud Agent", "Stateless ADK agent on Cloud Run. Escalated chat for cloud-synced characters via POST /agent/run")
  System_Ext(google, "Google Sign-In", "OAuth identity provider (via Firebase Auth)")
  System_Ext(gemini, "Vertex AI (Gemini)", "LLM completions. Called only by Cloud Functions and Cloud Agent — never by the client")
  System_Ext(stripe, "Stripe", "Web subscription payments and checkout")
  System_Ext(revenuecat, "RevenueCat", "Mobile in-app purchases (native SDK)")
  System_Ext(crashlytics, "Crashlytics", "Error and crash reporting (native only; web stub)")

  Rel(user, clanker, "Uses", "HTTPS / native")
  Rel(clanker, firebase, "Auth, callable functions, App Check")
  Rel(clanker, cloudagent, "Escalated chat for cloud-synced characters", "HTTPS POST /agent/run + Bearer token")
  Rel(clanker, google, "OAuth sign-in via Firebase Auth")
  Rel(clanker, stripe, "Checkout session (web)")
  Rel(clanker, revenuecat, "Native IAP (SDK)")
  Rel(clanker, crashlytics, "Error events (native)")
  Rel(stripe, firebase, "Purchase webhooks")
  Rel(revenuecat, firebase, "Purchase webhooks")
```

## Chat routing (summary)

The client never calls Gemini directly. After the user sends a message:

1. **Edge agent** (in-app) — multi-turn tool loop; each iteration calls `generateReply` (Firebase callable BYOI proxy). Local wiki/tasks run against SQLite.
2. **Cloud Agent** — cloud-synced character with `cloud_id` when `EXPO_PUBLIC_CLOUD_AGENT_URL` is set.
3. **Firebase fallback** — `sendMessageWithAIResponse`, which also calls `generateReply` (with optional unsynced history batch).

See [Edge Agent](../../EDGE_AGENT.md) and [AI & Chat](../../ai-and-chat.md).
