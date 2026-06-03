# Containers — Clanker

_Manually maintained. Update when a new container is added or a relationship changes._

```mermaid
C4Container
  title Container Diagram — Clanker

  Person(user, "User", "Mobile or web user")

  System_Boundary(clanker_b, "Clanker") {
    Container(app, "Clanker App", "Expo React Native (shared mobile/web)", "Chat, characters, wiki, payments UI. 90%+ shared code across mobile and web.")
    Container(sqlite, "Local SQLite", "expo-sqlite", "Offline-first on-device store for messages, characters, and tasks.")
  }

  System_Boundary(firebase_b, "Firebase") {
    Container(auth, "Firebase Auth", "Firebase Auth", "Identity and session tokens. Supports Google Sign-In and email.")
    Container(functions, "Cloud Functions", "Firebase Functions (Node.js)", "Backend logic: AI chat orchestration, wiki sync, purchase webhooks.")
    Container(firestore, "Firestore", "Firebase Firestore", "Real-time sync. App reads directly; Functions write on events.")
    Container(cloudsql, "Cloud SQL", "PostgreSQL (accessed via Functions)", "Relational store for user records and subscription state.")
  }

  System_Ext(openai, "OpenAI", "LLM completions")
  System_Ext(revenuecat, "RevenueCat", "Mobile IAP validation")
  System_Ext(stripe, "Stripe", "Web subscription payments")

  Rel(user, app, "Uses", "HTTPS / native")
  Rel(app, auth, "Sign-in and token refresh")
  Rel(app, functions, "Callable functions: chat, purchases, wiki sync")
  Rel(app, firestore, "Real-time reads")
  Rel(app, sqlite, "All local reads and writes")
  Rel(app, stripe, "Checkout session redirect (web)")
  Rel(functions, cloudsql, "User data and subscription records")
  Rel(functions, openai, "LLM calls for chat and wiki")
  Rel(functions, revenuecat, "Subscription validation (mobile)")
```