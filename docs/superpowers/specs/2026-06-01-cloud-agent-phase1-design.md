# Cloud Agent — Phase 1: Backend Scaffolding

**Date:** 2026-06-01
**Status:** Implemented
**Epic:** Epic 2 — Cloud Agent
**Goal:** Initialize a production-ready, self-contained Node.js container for the ADK Cloud Agent on Cloud Run. Fully isolated from the existing Firebase Functions.

---

## 1. Context & Motivation

The edge agent (Epic 1) runs on-device in Expo and escalates to Firebase `generateReply` for chat. The Cloud Agent is a parallel path — not a replacement — that owns new stateful capabilities: cloud-persisted tasks and wiki memory. Expo calls Cloud Run directly via HTTP (Firebase ID token auth). Firebase Functions are untouched.

---

## 2. Directory Structure

```
clanker/
├── cloud-agent/
│   ├── src/
│   │   ├── index.ts          # Express app, auth middleware, /health, /agent/run
│   │   ├── agent.ts          # ADK LlmAgent factory (buildAgent)
│   │   ├── tools/
│   │   │   ├── tasks.ts      # create_task, list_tasks ADK tool factories
│   │   │   └── wiki.ts       # wiki_read, wiki_write ADK tool factories
│   │   └── db/
│   │       ├── client.ts     # Cloud SQL connector + drizzle instance
│   │       └── schema.ts     # Minimal subset mirror of functions/src/db/schema.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── functions/                # Untouched
└── ...
```

---

## 3. Package Configuration

ESM, Node 22. Dep versions aligned with `functions/` semver ranges.

```json
{
  "name": "clanker-cloud-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@google/adk": "^1.1.0",
    "@google/genai": "^1.50.1",
    "@google-cloud/cloud-sql-connector": "^1.10.0",
    "drizzle-orm": "^0.45.2",
    "express": "^4.19.2",
    "firebase-admin": "^13.8.0",
    "pg": "^8.20.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/pg": "^8.20.0",
    "tsx": "^4.9.3",
    "typescript": "^6.0.3"
  }
}
```

`drizzle-kit` is intentionally absent — migrations run from `functions/` only.

---

## 4. Schema (Minimal Subset)

`src/db/schema.ts` mirrors only the bounded context the Cloud Agent operates within. Billing, subscription, and Stripe tables are excluded.

**Mirror of:** `functions/src/db/schema.ts`
**Kept tables:** `users`, `characters`, `tasks` (new — see §4.1), `llm_wiki_events`

If an adjacent table is needed in a future phase, add it then.

### 4.1 New Cloud SQL `tasks` Table (Migration Required)

The local SQLite `tasks` table (migration v19, edge app) has no Cloud SQL counterpart yet. Phase 1 requires adding it so the Cloud Agent can persist tasks to Cloud SQL and the `unsyncedHistory` sync has a target.

**Migration lives in `functions/src/db/`** (not `cloud-agent/`) — per project convention. The `cloud-agent/src/db/schema.ts` defines the matching Drizzle table export.

Proposed schema (mirrors local SQLite `tasks` table, adapted to Cloud SQL types):

```sql
CREATE TABLE tasks (
  id          TEXT        PRIMARY KEY,
  character_id UUID       NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_character_user ON tasks(character_id, user_id);
```

Note: `user_id` is added to the Cloud SQL version (absent in local SQLite) to support the security model WHERE clause filtering.

**Status mapping:** The local SQLite `tasks` table uses `status DEFAULT 'pending'`, but Cloud SQL `tasks` only allows `('open', 'done', 'abandoned')`. During `unsyncedHistory` sync, `'pending'` is mapped to `'open'` in application code.

---

## 5. Dockerfile

Multi-stage build. Debian-slim Node 22. Exposes port 8080 (Cloud Run standard).

```dockerfile
FROM node:22-bullseye-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bullseye-slim
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["npm", "start"]
```

Cloud Run is set to **Allow unauthenticated** at the infra level. Application-layer auth (Firebase ID token) handles security. No API Gateway.

---

## 6. Auth Middleware

Every route except `GET /health` passes through `requireFirebaseAuth`:

```typescript
// Reads: Authorization: Bearer <firebase-id-token>
// On success: attaches req.uid, calls next()
// On failure: 401 { error: 'Unauthorized' }
async function requireFirebaseAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.uid = decoded.uid
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
```

---

## 7. Express Routes

### `GET /health`
Unauthenticated. Returns `200 { status: 'ok' }`. Used by Cloud Run container probes.

### `POST /agent/run`
Protected by `requireFirebaseAuth`.

**Request body:**
```typescript
{
  message: string           // user's current message
  characterId: string       // which character context to use
  history?: Content[]       // prior turns (same @google/genai Content[] shape)
  unsyncedHistory?: any[]   // offline delta — bulk-inserted into Cloud SQL before ADK session
}
```

**Response:**
```typescript
{
  reply: string             // agent's final text response
  toolCalls?: string[]      // names of tools invoked (for client-side logging)
}
```

**Handler execution order:**

1. `requireFirebaseAuth` → `req.uid` (Firebase UID)
2. Look up `users.id` (UUID) by `users.firebase_uid = req.uid` → `userId`; return 401 if no match
3. Fetch character profile (`name`, `appearance`, `traits`, `emotions`, `context`) with `WHERE characters.id = characterId AND characters.user_id = userId`; return 404 if no match
4. Bulk insert `unsyncedHistory` into Cloud SQL (tasks + `llm_wiki_events`) — after ownership verified
5. Direct DB query: full-text search `llm_wiki_events` for `message` → relevant background facts (zero-latency RAG pre-fetch; happens before ADK session exists, not via ADK tool)
6. Assemble `systemInstruction` string from character profile + RAG facts
7. `buildAgent(db, userId, characterId, systemInstruction)`
8. `new Runner(agent).run({ message, history })` — seeds session with prior turns if `history` provided
9. Return `{ reply: result.text, toolCalls: result.toolCallNames }`

Each request is stateless. No session stored server-side. Cloud Run scales horizontally.

---

## 8. ADK Agent (`src/agent.ts`)

```typescript
export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.0-flash',
    systemInstruction,
    tools: [
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      wikiReadTool(db, characterId),
      wikiWriteTool(db, userId, characterId),
    ],
  })
}
```

`userId` and `characterId` are injected into tool closures at build time. The ADK tool schemas expose neither field as a parameter — the LLM cannot provide or override them. This prevents prompt injection and cross-user data access.

---

## 9. Tools

### `src/tools/tasks.ts`

| Tool | LLM-visible params | Closure-injected | Action |
|---|---|---|---|
| `create_task` | `{ title: string }` | `userId`, `characterId` | Insert into `tasks`; return stable `taskId` |
| `list_tasks` | _(none)_ | `userId`, `characterId` | Select open tasks for character; return array |

### `src/tools/wiki.ts`

| Tool | LLM-visible params | Closure-injected | Action |
|---|---|---|---|
| `wiki_read` | `{ query: string }` | `characterId` | Full-text / embedding search against `llm_wiki_events` in Cloud SQL |
| `wiki_write` | `{ summary: string }` | `userId`, `characterId` | Insert `{ event_type: 'observation', summary }` into `llm_wiki_events` |

All executors return strings. No executor throws — errors return a failure string to prevent unhandled rejections from triggering unintended escalation paths.

---

## 10. Security Model

| Threat | Mitigation |
|---|---|
| Unauthenticated request | `requireFirebaseAuth` returns 401 before reaching agent |
| LLM hallucinating a different `userId` | `userId` never in tool schema; injected via closure only |
| LLM hallucinating a different `characterId` | Same — closure-only |
| Cross-user data read | All DB queries include `userId` from closure in WHERE clause |
| Prompt injection via `unsyncedHistory` | Bulk insert sanitizes to schema columns only (`tasks`, `llm_wiki_events`); raw text never executed as SQL |

---

## 11. Non-Goals (Phase 1)

- No streaming / SSE (Phase 2 enhancement)
- No Drizzle migrations from `cloud-agent/` — run from `functions/` only
- No credits deduction — metered billing deferred to Phase 2
- No admin or internal tooling routes
- No integration tests — unit tests for tool factories cover Phase 1

---

## 12. Acceptance Criteria

| Scenario | Expected |
|---|---|
| `GET /health` | `200 { status: 'ok' }` with no auth header |
| `POST /agent/run` with no token | `401 { error: 'Unauthorized' }` |
| `POST /agent/run` with invalid token | `401 { error: 'Unauthorized' }` |
| `POST /agent/run` with valid token, `create_task` intent | Task inserted with `userId` from token, not from request body |
| `POST /agent/run` with valid token, `list_tasks` intent | Returns only tasks for `req.uid` |
| `unsyncedHistory` provided | Bulk-inserted into Cloud SQL before ADK session starts |
| `unsyncedHistory` empty or absent | Sync step skipped; agent runs normally |
| `docker build` from `cloud-agent/` | Succeeds with no reference to `../functions/` |
| `npm run build` | TypeScript compiles with no errors |
