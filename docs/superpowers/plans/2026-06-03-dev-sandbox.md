# Dev Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a local hot-reloading dev environment — Expo web → Docker cloud-agent → local Postgres — with Firebase Auth bypassed at the frontend boundary and real credit SQL running against real Postgres.

**Architecture:** Two env-flag gates (`MOCK_FIREBASE_AUTH` on backend, `EXPO_PUBLIC_USE_MOCK_AUTH` on frontend) intercept at exactly four boundaries: `verifyToken`, `onAuthStateChanged`, `bootstrapSession`, and `generateChatReply`. The DB client gains a `DATABASE_URL` branch that uses standard `pg.Pool` instead of the Google Cloud SQL Connector. Everything else is unchanged production code.

**Tech Stack:** Docker Compose, Postgres 15, Node 22, tsx, Express, Drizzle ORM, Expo web, XState, React Native Firebase (native) / Firebase Web SDK (web)

**Spec:** `docs/superpowers/specs/2026-06-03-dev-sandbox-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `docker-compose.local.yml` | Create | Orchestrate cloud-agent + postgres_db containers |
| `cloud-agent/Dockerfile.dev` | Create | Dev image with hot-reload via `npm run dev` |
| `cloud-agent/src/db/client.ts` | Modify | Add `DATABASE_URL` pg.Pool branch before Cloud SQL path |
| `cloud-agent/src/index.ts` | Modify | Skip firebase-admin init + use mock `verifyToken` when `MOCK_FIREBASE_AUTH=true` |
| `cloud-agent/scripts/seedLocal.ts` | Create | Create all tables + seed test user/character/credits |
| `.env.local` | Create | Frontend env vars (gitignored — no commit) |
| `src/config/firebaseConfig.ts` | Modify | Mock `onAuthStateChanged` for native |
| `src/config/firebaseConfig.web.ts` | Modify | Mock `onAuthStateChanged` for web |
| `src/auth/bootstrapSession.ts` | Modify | Mock return before `getCurrentUser()` guard |
| `src/services/chatReplyService.ts` | Modify | Mock return before `await appCheckReady` |

**Key constants used throughout:**
- Test user `firebase_uid`: `local_test_user_123`
- Test user Postgres `id` (UUID): `11111111-1111-1111-1111-111111111111`
- Test character `id` (UUID): `22222222-2222-2222-2222-222222222222`
- Mock bearer token: `mock_token_123`

---

## Task 1: Docker Infrastructure

**Files:**
- Create: `docker-compose.local.yml`
- Create: `cloud-agent/Dockerfile.dev`

- [ ] **Step 1: Create `docker-compose.local.yml` in the repo root**

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

- [ ] **Step 2: Create `cloud-agent/Dockerfile.dev`**

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
CMD ["npm", "run", "dev"]
```

Note: `package.json` already has `"dev": "tsx watch src/index.ts"` and `tsx` in devDependencies — no changes needed there.

- [ ] **Step 3: Validate compose file syntax**

Run: `docker compose -f docker-compose.local.yml config`

Expected: YAML echoed back with no errors.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.local.yml cloud-agent/Dockerfile.dev
git commit -m "feat(sandbox): add docker-compose.local.yml and Dockerfile.dev"
```

---

## Task 2: DB Client — Local Postgres Branch

**Files:**
- Modify: `cloud-agent/src/db/client.ts`

The current `createDb()` immediately calls `assertCloudSqlEnv()` which throws if `CLOUD_SQL_*` vars are absent. Add a `DATABASE_URL` branch before it.

- [ ] **Step 1: Add the `DATABASE_URL` branch to `createDb()`**

In `cloud-agent/src/db/client.ts`, replace the `createDb` function body (keeping the `isTestEnv` guard at the top, adding the new branch between it and `assertCloudSqlEnv()`):

```typescript
async function createDb(): Promise<DrizzleClient> {
  if (isTestEnv) {
    throw new Error(
      'Direct database access not allowed in test environment. ' +
      'Tests must inject a mock DrizzleClient.'
    )
  }

  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
    registerShutdownHandlers()
    return drizzle(pool, { schema })
  }

  assertCloudSqlEnv()

  connector = new Connector()
  const clientOpts = await connector.getOptions({
    instanceConnectionName: getRequiredEnv('CLOUD_SQL_CONNECTION_NAME'),
    ipType: IpAddressTypes.PUBLIC,
  })

  pool = new pg.Pool({
    ...clientOpts,
    user: getRequiredEnv('CLOUD_SQL_DB_USER'),
    password: getRequiredEnv('CLOUD_SQL_DB_PASS'),
    database: getRequiredEnv('CLOUD_SQL_DB_NAME'),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  })

  registerShutdownHandlers()
  return drizzle(pool, { schema })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd cloud-agent && npm run typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/db/client.ts
git commit -m "feat(sandbox): add DATABASE_URL branch to db client for local pg"
```

---

## Task 3: Backend Auth Bypass

**Files:**
- Modify: `cloud-agent/src/index.ts`

The entry point currently calls `admin.initializeApp()` unconditionally and hardcodes `verifyToken` to use firebase-admin. Without Google credentials in Docker, `admin.initializeApp()` will fail. When `MOCK_FIREBASE_AUTH=true`, skip the admin init and inject a mock `verifyToken`.

- [ ] **Step 1: Update the entry point block in `cloud-agent/src/index.ts`**

Replace the existing entry-point block at the bottom of the file (starting at `if (process.env.NODE_ENV !== 'test') {`):

```typescript
if (process.env.NODE_ENV !== 'test') {
  const isMockAuth = process.env.MOCK_FIREBASE_AUTH === 'true'
  if (!isMockAuth && !admin.apps.length) admin.initializeApp()

  const db = await getDb()
  const app = createApp({
    verifyToken: isMockAuth
      ? async (_token: string) => ({ uid: 'local_test_user_123' })
      : (token) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })),
    db,
    runAgentFn: runAgentReal,
  })

  const port = process.env.PORT ?? '8080'
  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd cloud-agent && npm run typecheck`

Expected: No errors.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

Run: `cd cloud-agent && npm test`

Expected: All tests pass. (Tests inject a mock DrizzleClient and mock verifyToken — this change only affects the entry point block which is skipped in `NODE_ENV=test`.)

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/index.ts
git commit -m "feat(sandbox): mock verifyToken and skip firebase-admin init when MOCK_FIREBASE_AUTH=true"
```

---

## Task 4: Seed Script

**Files:**
- Create: `cloud-agent/scripts/seedLocal.ts`

This script creates all required tables (Drizzle-schema tables + the two non-schema tables used by `creditService.ts`) and inserts one test user, character, subscription, and credit grant. Run inside the Docker container after `docker compose up`.

- [ ] **Step 1: Create `cloud-agent/scripts/seedLocal.ts`**

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const CHARACTER_ID = '22222222-2222-2222-2222-222222222222'

async function seed() {
  const db = await getDb()
  console.log('Creating tables...')

  // ── Tables mirrored from cloud-agent/src/db/schema.ts ─────────────────────

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_uid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS characters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      appearance TEXT,
      traits TEXT,
      emotions TEXT,
      context TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done', 'abandoned'))
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS llm_wiki_events (
      id TEXT NOT NULL,
      entity_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (id, user_id),
      CONSTRAINT llm_wiki_events_event_type_check
        CHECK (event_type IN ('observation', 'decision', 'action', 'outcome'))
    )
  `)

  // ── Tables NOT in cloud-agent schema (from functions/src/db/schema.ts) ─────
  // creditService.ts queries these via raw SQL.

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_tier TEXT NOT NULL DEFAULT 'free',
      plan_status TEXT NOT NULL DEFAULT 'active',
      current_credits INTEGER NOT NULL DEFAULT 0,
      terms_version TEXT,
      terms_accepted_at TIMESTAMP WITH TIME ZONE,
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      billing_cycle_start TIMESTAMP WITH TIME ZONE,
      billing_cycle_end TIMESTAMP WITH TIME ZONE,
      next_expiry_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
      documents_ingested_count INTEGER NOT NULL DEFAULT 0,
      documents_ingested_date TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT plan_tier_check
        CHECK (plan_tier IN ('free', 'monthly_20', 'monthly_50', 'payg')),
      CONSTRAINT plan_status_check
        CHECK (plan_status IN ('active', 'cancelled', 'expired'))
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      initial_amount INTEGER NOT NULL,
      remaining_balance INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT credit_transactions_transaction_type_check
        CHECK (transaction_type IN ('signup', 'subscription', 'one_time', 'legacy'))
    )
  `)

  console.log('Seeding test data...')

  await db.execute(sql`
    INSERT INTO users (id, firebase_uid, email, display_name)
    VALUES (${USER_ID}, 'local_test_user_123', 'dev@localhost.com', 'Dev User')
    ON CONFLICT (firebase_uid) DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO characters (id, user_id, name, traits)
    VALUES (${CHARACTER_ID}, ${USER_ID}, 'Dev Character', 'Friendly, helpful')
    ON CONFLICT (id) DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO subscriptions (user_id, plan_tier, plan_status, current_credits)
    VALUES (${USER_ID}, 'free', 'active', 100)
    ON CONFLICT (user_id) DO NOTHING
  `)

  // Only insert credit grant if this user has no transactions yet
  await db.execute(sql`
    INSERT INTO credit_transactions
      (user_id, delta, reason, initial_amount, remaining_balance, transaction_type, expires_at)
    SELECT ${USER_ID}, 100, 'local_dev_grant', 100, 100, 'legacy', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM credit_transactions WHERE user_id = ${USER_ID}
    )
  `)

  console.log('Seed complete!')
  console.log(`  User ID:      ${USER_ID}`)
  console.log(`  Character ID: ${CHARACTER_ID}`)
  console.log(`  firebase_uid: local_test_user_123`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `cd cloud-agent && npm run typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/scripts/seedLocal.ts
git commit -m "feat(sandbox): add seedLocal.ts script for local Postgres setup"
```

- [ ] **Step 4: Start the Docker stack**

Run: `docker compose -f docker-compose.local.yml up -d`

Expected: Both `cloud-agent` and `postgres_db` containers start. Check with:
```bash
docker compose -f docker-compose.local.yml ps
```
Both should show `running` / `healthy`.

- [ ] **Step 5: Run the seed script**

Run: `docker compose -f docker-compose.local.yml exec cloud-agent npx tsx scripts/seedLocal.ts`

Expected output:
```
Creating tables...
Seeding test data...
Seed complete!
  User ID:      11111111-1111-1111-1111-111111111111
  Character ID: 22222222-2222-2222-2222-222222222222
  firebase_uid: local_test_user_123
```

- [ ] **Step 6: Verify health endpoint**

Run: `curl http://localhost:8080/health`

Expected: `{"status":"ok"}`

---

## Task 5: Frontend Env File

**Files:**
- Create: `.env.local` (gitignored — do not commit)

- [ ] **Step 1: Create `.env.local` in the repo root**

```
EXPO_PUBLIC_CLOUD_AGENT_URL=http://localhost:8080
EXPO_PUBLIC_USE_MOCK_AUTH=true
```

Note: `.env.local` is already in `.gitignore`. Do not commit this file.

---

## Task 6: Frontend Auth Mock — `onAuthStateChanged`

**Files:**
- Modify: `src/config/firebaseConfig.ts` (native)
- Modify: `src/config/firebaseConfig.web.ts` (web)

When `EXPO_PUBLIC_USE_MOCK_AUTH=true`, `onAuthStateChanged` fires the callback synchronously with a fake user object instead of subscribing to Firebase. The auth machine receives `USER_FOUND` and flows naturally to `bootstrapping`.

- [ ] **Step 1: Modify `onAuthStateChanged` in `src/config/firebaseConfig.ts`**

Replace the existing `onAuthStateChanged` definition (line 44-45):

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

- [ ] **Step 2: Modify `onAuthStateChanged` in `src/config/firebaseConfig.web.ts`**

Replace the existing `onAuthStateChanged` definition (line 100-101):

```typescript
const onAuthStateChanged = (callback: (user: User | null) => void): Unsubscribe => {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    callback({
      uid: 'local_test_user_123',
      email: 'dev@localhost.com',
      getIdToken: async () => 'mock_token_123',
    } as unknown as User)
    return () => {}
  }
  return onAuthStateChangedInternal(auth, callback)
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: No new errors related to the changed files.

- [ ] **Step 4: Commit**

```bash
git add src/config/firebaseConfig.ts src/config/firebaseConfig.web.ts
git commit -m "feat(sandbox): mock onAuthStateChanged when EXPO_PUBLIC_USE_MOCK_AUTH=true"
```

---

## Task 7: Frontend Bootstrap Session Mock

**Files:**
- Modify: `src/auth/bootstrapSession.ts`

The real `bootstrapSession()` calls `getCurrentUser()` which returns `null` in mock mode (no real Firebase session), causing an immediate throw. The mock branch must come first.

- [ ] **Step 1: Add mock branch to `bootstrapSession()`**

In `src/auth/bootstrapSession.ts`, insert the mock guard as the very first statement inside `bootstrapSession()` — before the existing `const user = getCurrentUser()` line:

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
  const user = getCurrentUser()
  // ... rest of existing implementation unchanged
```

The `id` value `11111111-1111-1111-1111-111111111111` matches the UUID seeded in Task 4.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: No errors. `BootstrapResponse`, `UserSnapshot`, and `SubscriptionSnapshot` types are all satisfied exactly.

- [ ] **Step 3: Commit**

```bash
git add src/auth/bootstrapSession.ts
git commit -m "feat(sandbox): mock bootstrapSession return when EXPO_PUBLIC_USE_MOCK_AUTH=true"
```

---

## Task 8: Frontend Chat Reply Fallback Mock

**Files:**
- Modify: `src/services/chatReplyService.ts`

When `EXPO_PUBLIC_USE_MOCK_AUTH=true`, the `generateChatReply` fallback path must not call Firebase. The mock guard must come before `await appCheckReady` (which would fail in web/mock mode with no App Check credentials).

- [ ] **Step 1: Add mock branch to `generateChatReply()`**

In `src/services/chatReplyService.ts`, insert the mock guard as the very first statement inside `generateChatReply()` — before the existing `const trimmedPrompt = ...` line:

```typescript
export async function generateChatReply({
  prompt,
  contents,
  systemInstruction,
  referenceId,
  unsyncedHistory,
  characterId,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    return {
      reply: '[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: new Date().toISOString(),
    }
  }
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  // ... rest of existing implementation unchanged
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: No errors. All fields of `GenerateChatReplyResult` are present and correctly typed.

- [ ] **Step 3: Commit**

```bash
git add src/services/chatReplyService.ts
git commit -m "feat(sandbox): mock generateChatReply fallback when EXPO_PUBLIC_USE_MOCK_AUTH=true"
```

---

## Task 9: Smoke Test — Full Stack

Verify the complete sandbox works end to end.

- [ ] **Step 1: Confirm Docker stack is running**

Run: `docker compose -f docker-compose.local.yml ps`

Expected: `cloud-agent` and `postgres_db` both `running` / `healthy`. If not, run `docker compose -f docker-compose.local.yml up -d`.

- [ ] **Step 2: Confirm health endpoint**

Run: `curl http://localhost:8080/health`

Expected: `{"status":"ok"}`

- [ ] **Step 3: Smoke-test `/agent/run` directly with curl**

```bash
curl -X POST http://localhost:8080/agent/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock_token_123" \
  -d '{
    "message": "Hello",
    "characterId": "22222222-2222-2222-2222-222222222222"
  }'
```

Expected: JSON response with `reply`, `toolCalls`, and `usageSnapshot.remainingCredits` (99 after first spend).

- [ ] **Step 4: Start the frontend**

Run: `npx expo start -w`

Expected: Browser opens at `http://localhost:8081`.

- [ ] **Step 5: Verify auth flow in browser**

Open browser devtools console. Expected log sequence on load:
- No Firebase errors
- App transitions to signed-in state immediately (no login screen)
- Auth machine reaches `signedIn` state (verify via React DevTools or XState inspector if available)

- [ ] **Step 6: Send a chat message via the UI**

Send a message to Dev Character (`22222222-2222-2222-2222-222222222222`). Expected:
- Message routes to `http://localhost:8080/agent/run` (visible in Network tab)
- Response appears in the chat UI
- Credit balance decrements by 1

- [ ] **Step 7: Confirm credit deduction in DB**

Run: `docker compose -f docker-compose.local.yml exec postgres_db psql -U clanker_dev -d clanker -c "SELECT remaining_balance FROM credit_transactions WHERE user_id = '11111111-1111-1111-1111-111111111111';"`

Expected: `remaining_balance` decremented by 1 per message sent.

---

## Startup Reference (after initial setup)

```bash
# Backend
docker compose -f docker-compose.local.yml up -d

# Seed (first time only — idempotent if re-run)
docker compose -f docker-compose.local.yml exec cloud-agent npx tsx scripts/seedLocal.ts

# Frontend
npx expo start -w
```

## Hybrid Mode (Optional)

To log in as a real staging user while routing chat to local Docker:

```
# .env.local
EXPO_PUBLIC_CLOUD_AGENT_URL=http://localhost:8080
EXPO_PUBLIC_USE_MOCK_AUTH=false
```

With `EXPO_PUBLIC_USE_MOCK_AUTH=false`: real Firebase login, real staging bootstrapSession, but `/agent/run` still hits `localhost:8080`.
