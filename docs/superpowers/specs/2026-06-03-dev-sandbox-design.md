# Dev Sandbox Design

**Date:** 2026-06-03  
**Status:** Implemented
**Scope:** Local hot-reloading environment for cloud-agent ↔ Expo UI bridge. No Firebase Emulator. No production cloud resources consumed.

---

## Goal

Run the full chat loop locally: Expo web frontend → Docker cloud-agent → local Postgres. Firebase Auth is bypassed at the frontend boundary. Real credit SQL logic (`SELECT FOR UPDATE` saga) executes against a real local Postgres engine.

---

## What This Sandbox Is (and Is Not)

**In scope:**
- Cloud agent `/agent/run` endpoint with real credit deduction
- Expo web frontend (`npx expo start -w`) hot-reloading
- Mock auth bypass through both frontend paths (cloud agent + Firebase callable fallback)

**Out of scope:**
- Firebase Emulator
- `generateImage`, `generateVoiceReply`, or any other Firebase callable
- Staging/production databases
- iOS/Android native builds (web only for sandbox)

---

## Architecture

```
[Expo Web :8081]
    │  EXPO_PUBLIC_USE_MOCK_AUTH=true
    │  EXPO_PUBLIC_CLOUD_AGENT_URL=http://localhost:8080
    │
    ├─ onAuthStateChanged (mocked) ──→ USER_FOUND → bootstrapping
    ├─ bootstrapSession() (mocked) ──→ signedIn with fake UserSnapshot
    │
    ├─ /agent/run ──→ [cloud-agent :8080] ──→ [postgres_db :5432]
    │     Authorization: Bearer mock_token_123      real credit SQL
    │     verifyToken (mocked) → uid: local_test_user_123
    │
    └─ generateChatReply fallback (mocked) ──→ static reply string
```

---

## Backend (cloud-agent)

### `cloud-agent/src/db/client.ts`

Add a `DATABASE_URL` branch before the Cloud SQL Connector path:

```typescript
if (process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, ... })
  return drizzle(pool, { schema })
}
// existing Cloud SQL Connector logic unchanged
```

No schema changes. Existing tests unaffected (they inject mock DrizzleClient).

### `cloud-agent/src/index.ts` entry point

When `MOCK_FIREBASE_AUTH=true`, pass a mock `verifyToken` to `createApp()`:

```typescript
const verifyToken = process.env.MOCK_FIREBASE_AUTH === 'true'
  ? async (_token: string) => ({ uid: 'local_test_user_123' })
  : (token: string) => admin.auth().verifyIdToken(token).then(d => ({ uid: d.uid }))
```

`creditService` is **not** mocked — real `createCreditService(db)` runs against local Postgres.

### `cloud-agent/scripts/seedLocal.ts`

Creates all required tables and seeds one test user + character. Tables not in `schema.ts` are created via raw SQL.

Tables created:
- `users` — via drizzle schema
- `characters` — via drizzle schema
- `tasks` — via drizzle schema
- `llm_wiki_events` — via drizzle schema
- `subscriptions` — raw SQL (not in cloud-agent schema.ts)
- `credit_transactions` — raw SQL (not in cloud-agent schema.ts)

Seeded data:
- `users`: `id = 11111111-1111-1111-1111-111111111111`, `firebase_uid = 'local_test_user_123'`, `email = 'dev@localhost.com'`
- `characters`: one row linked to above user (provides a valid `characterId` for testing)
- `subscriptions`: one row for the user
- `credit_transactions`: one row, `remaining_balance = 100`, `expires_at = NULL`

### `cloud-agent/Dockerfile.dev`

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
CMD ["npm", "run", "dev"]
```

Note: `tsx` and the `dev` script already exist in `cloud-agent/package.json`. No install needed.

### `docker-compose.local.yml` (repo root)

```yaml
version: '3.8'
services:
  cloud-agent:
    build:
      context: ./cloud-agent
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    volumes:
      - ./cloud-agent:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - MOCK_FIREBASE_AUTH=true
      - DATABASE_URL=postgres://clanker_dev:local_pass@postgres_db:5432/clanker
      - CORS_ORIGIN=http://localhost:8081,http://localhost:8082
    depends_on:
      postgres_db:
        condition: service_healthy

  postgres_db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=clanker_dev
      - POSTGRES_PASSWORD=local_pass
      - POSTGRES_DB=clanker
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U clanker_dev"]
      interval: 5s
      timeout: 5s
      retries: 5
```

CORS handled via `CORS_ORIGIN` env var — no code change to CORS logic needed.

---

## Frontend (Expo)

### `.env.local` (repo root, already covered by `.gitignore`)

```
EXPO_PUBLIC_CLOUD_AGENT_URL=http://localhost:8080
EXPO_PUBLIC_USE_MOCK_AUTH=true
```

### `src/config/firebaseConfig.ts` and `src/config/firebaseConfig.web.ts`

Add mock branch inside the existing `onAuthStateChanged` wrapper (both files):

```typescript
const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) => {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    callback({
      uid: 'local_test_user_123',
      email: 'dev@localhost.com',
      getIdToken: async () => 'mock_token_123',
    } as FirebaseAuthTypes.User)
    return () => {}
  }
  return onAuthStateChangedMod(auth, callback)
}
```

Effect: machine receives `USER_FOUND` → `bootstrapping`, identical to production flow.

### `src/auth/bootstrapSession.ts`

Add mock at top of `bootstrapSession()`, before the `getCurrentUser()` guard:

```typescript
export async function bootstrapSession(): Promise<BootstrapResponse> {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    return {
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        firebaseUid: 'local_test_user_123',
        email: 'dev@localhost.com',
        displayName: 'Dev User',
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      subscription: {
        planTier: 'free',
        planStatus: 'active',
        currentCredits: 100,
        termsVersion: null,
        termsAcceptedAt: null,
        nextExpiryDate: null,
      },
    }
  }
  // existing implementation unchanged below
  const user = getCurrentUser()
  ...
}
```

UUID `11111111-1111-1111-1111-111111111111` matches seed script — FK lookups succeed.

### `src/services/chatReplyService.ts`

Add mock at top of `generateChatReply()`, before `await appCheckReady`:

```typescript
export async function generateChatReply(input: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    return {
      reply: '[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: new Date().toISOString(),
    }
  }
  // existing implementation unchanged below
  ...
}
```

Returns exact `GenerateChatReplyResult` shape. No type issues downstream.

---

## Data Flow (end-to-end)

1. `npx expo start -w` → `EXPO_PUBLIC_USE_MOCK_AUTH=true` → `onAuthStateChanged` fires immediately with fake user
2. authMachine: `USER_FOUND` → `bootstrapping` → `bootstrapSession()` returns mock snapshot → `signedIn`
3. User sends chat message → cloud agent path:
   - Frontend sends `Authorization: Bearer mock_token_123` to `http://localhost:8080/agent/run`
   - `verifyToken('mock_token_123')` → `{ uid: 'local_test_user_123' }`
   - `SELECT id FROM users WHERE firebase_uid = 'local_test_user_123'` → UUID found
   - Real credit deduction via `SELECT FOR UPDATE` saga against local Postgres
   - ADK agent runs, returns reply
4. User sends chat message → fallback path (non-escalated):
   - `generateChatReply()` returns mock string immediately, no Firebase call

---

## Startup Commands

```bash
# 1. Start backend
docker compose -f docker-compose.local.yml up -d

# 2. Seed database (first time only)
docker compose -f docker-compose.local.yml exec cloud-agent npx tsx scripts/seedLocal.ts

# 3. Start frontend
npx expo start -w
```

---

## Hybrid Mode (Optional)

To test against real staging Firebase functions while routing chat to local Docker:

```
# .env.local
EXPO_PUBLIC_CLOUD_AGENT_URL=http://localhost:8080
EXPO_PUBLIC_USE_MOCK_AUTH=false   # real Firebase login
```

With `USE_MOCK_AUTH=false`: real Firebase login, real staging bootstrapSession, but chat still routes to local cloud-agent. Useful for LLM prompt iteration against a real user account.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `docker-compose.local.yml` | New |
| `cloud-agent/Dockerfile.dev` | New |
| `cloud-agent/scripts/seedLocal.ts` | New |
| `cloud-agent/src/db/client.ts` | Add `DATABASE_URL` branch |
| `cloud-agent/src/index.ts` | Mock `verifyToken` when `MOCK_FIREBASE_AUTH=true` |
| `src/config/firebaseConfig.ts` | Mock `onAuthStateChanged` |
| `src/config/firebaseConfig.web.ts` | Mock `onAuthStateChanged` |
| `src/auth/bootstrapSession.ts` | Mock return before `getCurrentUser()` |
| `src/services/chatReplyService.ts` | Mock return before `await appCheckReady` |
| `.env.local` | New (gitignored) |
