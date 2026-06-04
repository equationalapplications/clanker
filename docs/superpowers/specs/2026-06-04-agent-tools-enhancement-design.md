# Agent Tools Enhancement — Edge & Cloud Parity

**Date:** 2026-06-04
**Status:** Approved
**Epic:** Epic 3 — Enhanced Agent Tools
**Goal:** Unified, matching tool sets across edge and cloud agents. Single source of truth for all manifests. Full task CRUD, semantic wiki memory on both sides, document search, and cloud-only reminders.

---

## 1. Context & Motivation

The current edge and cloud agents have diverged in both tool naming and capability:

| Gap | Current state |
|---|---|
| Cloud missing `get_current_time` | Only on edge |
| Name mismatch | Edge: `search_memory`/`write_observation` → Cloud: `wiki_read`/`wiki_write` |
| Cloud wiki uses ILIKE on `llm_wiki_events` | No semantic search; targets wrong table |
| `queryWikiContext` pre-fetch also ILIKE | Split-brain: keyword-primed context, semantic mid-flight tool calls |
| Cloud agent schema mirror missing `llm_wiki_entries` | Agent can't reach structured memory table; only has `llm_wiki_events` |
| Tasks are CRUD on edge but create+list only on cloud | Incomplete parity |
| No document search on either agent | Planned capability missing |
| No reminders tool | Planned capability missing |

The codebase has two wiki table families. The legacy tables (`wiki_entries`, `agent_tasks`, `memory_events`) are marked for retirement in `functions/src/db/schema.ts`. The active LWW system is `llm_wiki_entries` / `llm_wiki_tasks` / `llm_wiki_events`. The cloud agent currently targets only `llm_wiki_events` (simple text log). This spec migrates it to the correct tables.

Text utilities `clip()` and `inferTags()` currently live in `functions/src/memoryFunctions.ts`. `cloud-agent/` is a separate deployment package — the Cloud Run container has no access to `functions/` at runtime. Both utilities move to `shared/wiki-utils.ts` so they are accessible to both Expo and the cloud agent without crossing microservice boundaries.

---

## 2. Tool Inventory

All tools defined in `shared/agent-tools-spec.ts`. `tier` controls registration and execution path.

| Tool | Tier | Edge executor | Cloud executor |
|---|---|---|---|
| `get_current_time` | `both` | local `Date` | local `Date` |
| `wiki_read` | `both` | `expo-llm-wiki` semantic | pgvector on `llm_wiki_entries` |
| `wiki_write` | `both` | `expo-llm-wiki` write | dual-write to `llm_wiki_entries` + `llm_wiki_events` |
| `create_task` | `both` | local SQLite | Cloud SQL `tasks` |
| `list_tasks` | `both` | local SQLite | Cloud SQL `tasks` |
| `update_task` | `both` | local SQLite | Cloud SQL `tasks` |
| `complete_task` | `both` | local SQLite | Cloud SQL `tasks` |
| `delete_task` | `both` | local SQLite | Cloud SQL `tasks` |
| `document_search` | `both` | local document index | Cloud SQL (stub — implementation deferred) |
| `set_reminder` | `cloud-only` | _(not registered)_ | Cloud SQL + scheduler |
| `escalate_to_cloud_agent` | `edge-only` | triggers handoff | _(not registered)_ |

**Naming change from current:** `search_memory` → `wiki_read`, `write_observation` → `wiki_write`. Both agents adopt unified names.

**Escalation model — explicit (Option A):** `cloud-only` tools are not registered with the edge LLM. The `escalate_to_cloud_agent` description must retain broad wording — narrowing it to reminders-only causes regression where edge LLM attempts long writing tasks locally instead of escalating.

---

## 3. Shared Manifest File

### 3.1 Location & Files

Two files at repo root:

- `shared/agent-tools-spec.ts` — tool manifests and schema helpers
- `shared/wiki-utils.ts` — `clip()` and `inferTags()` utilities; used by cloud agent `wiki_write` and `bulkInsertUnsynced`

Both Expo and cloud-agent import from `shared/`. No npm publish required. `functions/src/memoryFunctions.ts` continues to use its own local copies of `clip()` and `inferTags()` until that file is retired — no changes to functions/ in this spec.

### 3.2 File

```typescript
export type ToolTier = 'both' | 'cloud-only' | 'edge-only'

export interface ToolManifest {
  name: string
  tier: ToolTier
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

export const agentToolSpec: ToolManifest[] = [
  {
    name: 'get_current_time',
    tier: 'both',
    description: 'CRITICAL: ALWAYS call this tool if the user asks for the current time, date, day of week, or uses relative temporal words (today, tomorrow). Do not guess.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'wiki_read',
    tier: 'both',
    description: "Search the user's long-term memory using semantic search. ALWAYS use if the user asks to recall something previously discussed.",
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Topic or keywords to search for.' } }, required: ['query'] },
  },
  {
    name: 'wiki_write',
    tier: 'both',
    description: 'Record a new observation about the user into long-term memory. Call when the user shares a personal detail, preference, or fact.',
    parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Observation to record.' } }, required: ['summary'] },
  },
  {
    name: 'create_task',
    tier: 'both',
    description: 'Create a new task or to-do item for the user.',
    parameters: { type: 'object', properties: { title: { type: 'string', description: 'Task description.' } }, required: ['title'] },
  },
  {
    name: 'list_tasks',
    tier: 'both',
    description: "List the user's current open tasks.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_task',
    tier: 'both',
    description: 'Update the title of an existing task.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' }, title: { type: 'string' } },
      required: ['taskId', 'title'],
    },
  },
  {
    name: 'complete_task',
    tier: 'both',
    description: 'Mark a task as completed.',
    parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'delete_task',
    tier: 'both',
    description: 'Delete a task permanently.',
    parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'document_search',
    tier: 'both',
    description: 'Search ingested documents for content relevant to the query.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for in documents.' } }, required: ['query'] },
  },
  {
    name: 'set_reminder',
    tier: 'cloud-only',
    description: 'Schedule a reminder for the user at a specific future time.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime.' },
      },
      required: ['message', 'remind_at'],
    },
  },
  {
    name: 'escalate_to_cloud_agent',
    tier: 'edge-only',
    description: 'Escalate complex workflows, writing tasks, reminders, or scheduling to the cloud agent. Do NOT use for casual chat, time checks, memory reads/writes, or task create/list.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
]

export function getSchemasForEdge(hasWiki: boolean, isCloudSynced: boolean) {
  return agentToolSpec
    .filter(t => t.tier === 'both' || t.tier === 'edge-only')
    .filter(t => hasWiki || !['wiki_read', 'wiki_write'].includes(t.name))
    .filter(t => isCloudSynced || t.name !== 'escalate_to_cloud_agent')
    .map(({ name, description, parameters }) => ({ name, description, parameters }))
}

export function getSchemasForCloud() {
  return agentToolSpec
    .filter(t => t.tier === 'both' || t.tier === 'cloud-only')
    .map(({ name, description, parameters }) => ({ name, description, parameters }))
}
```

### 3.3 Edge Import

`src/services/clankerManifests.ts` is replaced by `getSchemasForEdge`. Relative import:

```typescript
import { getSchemasForEdge } from '../../../shared/agent-tools-spec'
```

`metro.config.js` adds `shared/` to `watchFolders` — Metro ignores files outside its root by default:

```javascript
const path = require('path')
config.watchFolders = [
  ...existing,
  path.resolve(__dirname, '../../shared'), // adjust depth to repo root
]
```

### 3.4 Cloud Import

```typescript
import { getSchemasForCloud } from '../../shared/agent-tools-spec.js'
```

---

## 4. Docker & TypeScript Build

### 4.1 Dockerfile

Build context shifts to **repo root**. Folder depth preserved inside the container so `../shared` resolves correctly from `cloud-agent/`.

```dockerfile
FROM node:22-bullseye-slim AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY cloud-agent/ ./cloud-agent/
WORKDIR /app/cloud-agent
RUN npm ci
RUN npm run build

FROM node:22-bullseye-slim
WORKDIR /app/cloud-agent
COPY --from=builder /app/cloud-agent/package*.json ./
COPY --from=builder /app/cloud-agent/node_modules ./node_modules
COPY --from=builder /app/cloud-agent/dist ./dist
EXPOSE 8080
CMD ["npm", "start"]
```

### 4.2 docker-compose.local.yml

The local sandbox compose file must also shift build context to repo root. The `cloud-agent` service context and volume mounts reference the old path — without this update the local hot-reload loop fails to find `shared/` at startup.

```yaml
services:
  cloud-agent:
    build:
      context: ../         # was: .  (was relative to cloud-agent/)
      dockerfile: cloud-agent/Dockerfile
    volumes:
      - ../shared:/app/shared          # mount shared/ into container
      - ./src:/app/cloud-agent/src     # existing hot-reload mount
```

### 4.3 tsc Output Nesting

When `tsc` compiles files importing from outside `rootDir`, it hoists the output tree to the common ancestor. With `rootDir: ".."` the compiled output is:

- `dist/cloud-agent/src/index.js` (not `dist/index.js`)
- `dist/shared/agent-tools-spec.js`

`cloud-agent/tsconfig.json`:
```json
{
  "compilerOptions": {
    "rootDir": "..",
    "outDir": "./dist"
  }
}
```

`cloud-agent/package.json` start script:
```json
"start": "node dist/cloud-agent/src/index.js"
```

---

## 5. Cloud Agent Timezone Handling

`get_current_time` on edge returns the user's device local time. On Cloud Run, a bare `new Date()` returns UTC — incorrect for any user not in UTC.

**Fix:** Expo sends the device timezone in a request header: `X-Timezone: America/New_York`. The cloud agent reads it in `get_current_time` and formats the response accordingly:

```typescript
// cloud-agent/src/tools/time.ts
export function getCurrentTimeTool(timezone: string): FunctionTool {
  return new FunctionTool({
    name: 'get_current_time',
    // ...
    execute: async () => new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: timezone || 'UTC',
    }),
  })
}
```

The `timezone` string is parsed from `req.headers['x-timezone']` in the `/agent/run` handler and injected into `buildAgent(...)`. Falls back to `'UTC'` if header absent or invalid (non-crashing — IANA lookup failure caught, fallback applied).

Expo passes it via `cloudAgentService.ts`:
```typescript
headers: { 'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone }
```

---

## 6. Cloud Wiki — pgvector on `llm_wiki_entries`

### 6.1 Target Tables

| Operation | Table | Reason |
|---|---|---|
| `wiki_read` | `llm_wiki_entries` | Structured facts; embedding column lives here |
| `wiki_write` (fact) | `llm_wiki_entries` | Upsert structured hot fact with vector |
| `wiki_write` (log) | `llm_wiki_events` | Append audit event for heal/sync layers |
| `queryWikiContext` pre-fetch | `llm_wiki_entries` | Same retrieval as tool; no split-brain |
| `bulkInsertUnsynced` wiki items | `llm_wiki_entries` + `llm_wiki_events` | Mirror dual-write for edge-originated items |

### 6.2 Schema Migration

New migration in `functions/src/db/` (all migrations live there only):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE llm_wiki_entries
  ADD COLUMN embedding vector(768);

CREATE INDEX llm_wiki_entries_embedding_idx
  ON llm_wiki_entries USING hnsw (embedding vector_cosine_ops);
```

768 dimensions = `text-embedding-004` output. HNSW chosen over IVFFlat: builds on empty tables, grows dynamically as rows are inserted, no accuracy degradation requiring manual REINDEX.

`cloud-agent/src/db/schema.ts` adds `llm_wiki_entries` (currently only has `llm_wiki_events`). `llm_wiki_tasks` is intentionally excluded — the cloud agent performs all task CRUD against the `tasks` table, not the LWW wiki task table. Adding the mirror with no executor writing to it would create a misleading dead export.

```typescript
// llm_wiki_entries — add to existing schema mirror
export const llmWikiEntries = pgTable('llm_wiki_entries', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: jsonb('tags').notNull().default([]),
  confidence: text('confidence').notNull().default('inferred'),
  sourceType: text('source_type').notNull().default('agent_inferred'),
  sourceRef: text('source_ref'),
  sourceHash: text('source_hash'),
  lastAccessedAt: bigint('last_accessed_at', { mode: 'number' }),
  accessCount: integer('access_count').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  deletedAt: bigint('deleted_at', { mode: 'number' }),
  embedding: vector('embedding', { dimensions: 768 }),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityUserIdx: index('llm_wiki_entries_entity_user_idx').on(table.entityId, table.userId),
  embeddingIdx: index('llm_wiki_entries_embedding_idx').on(table.embedding), // hnsw created in migration
}))

// llm_wiki_tasks intentionally NOT mirrored — cloud agent task CRUD targets the `tasks` table only.
```

### 6.3 `embedText` Helper

`cloud-agent/src/db/embeddings.ts` — injectable for tests:

```typescript
import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'text-embedding-004'

export async function embedText(text: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  try {
    const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
    return result.embeddings[0].values
  } catch (err) {
    if (isRetryable(err)) {
      await new Promise(r => setTimeout(r, 1000))
      const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
      return result.embeddings[0].values
    }
    throw err
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) return /429|503|rate.?limit|quota/i.test(err.message)
  return false
}
```

### 6.4 Error Fallback Strategy

`embedText` retries once on `429`/`5xx`, then throws. Callers degrade gracefully — chat turns never fail due to embedding errors:

| Caller | On throw |
|---|---|
| `wiki_read` | Fall back to `to_tsvector` full-text search on `llm_wiki_entries` |
| `wiki_write` | Insert entry with `embedding: null`; log warning |
| `queryWikiContext` pre-fetch | Fall back to full-text search |
| `bulkInsertUnsynced` | Per-entry try/catch; insert with `embedding: null`; continue batch |

Rows with `embedding: null` are invisible to cosine similarity but searchable via full-text fallback. A scheduled backfill job (`WHERE embedding IS NULL`) keeps null state temporary — tracked as a follow-up, out of scope here.

### 6.5 `wiki_write` Input Parsing

Tool schema stays `{ summary: string }` on both edge and cloud — preserves tool parity. Cloud derives structured fields via heuristic (no extra LLM call; calling LLM already wrote a well-formed summary sentence):

```typescript
function parseSummary(summary: string): { title: string; body: string; tags: string[] } {
  const title = clip(summary.split(/[.!?]/)[0] ?? summary, 64)
  const body = clip(summary, 200)
  const tags = inferTags(summary) // keyword heuristic from memoryFunctions.ts
  return { title, body, tags }
}
```

`confidence` is always `'inferred'`; `sourceType` always `'agent_inferred'`.

### 6.6 `wiki_write` Dual-Write Pattern

Both inserts wrapped in a DB transaction:

```typescript
await db.transaction(async (tx) => {
  const entryId = crypto.randomUUID()
  const { title, body, tags } = parseSummary(summary)
  let embedding: number[] | null = null
  try { embedding = await embed(body) } catch { /* log, continue */ }

  await tx.insert(llmWikiEntries).values({
    id: entryId, entityId: characterId, userId,
    title, body, tags,
    confidence: 'inferred', sourceType: 'agent_inferred',
    embedding,
    createdAt: Date.now(), updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: [llmWikiEntries.id, llmWikiEntries.userId],
    set: { body: sql`excluded.body`, updatedAt: sql`excluded.updated_at`, embedding: sql`excluded.embedding` },
  })

  await tx.insert(llmWikiEvents).values({
    id: crypto.randomUUID(), entityId: characterId, userId,
    eventType: 'observation',
    summary: clip(`${title}: ${body}`, 200),
    createdAt: Date.now(),
  })
})
```

### 6.7 `wiki_read` — pgvector Query

```typescript
import { cosineDistance } from 'drizzle-orm/pg-core'

// Happy path: pgvector cosine similarity
const vec = await embed(query)
const rows = await db.select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
  .from(llmWikiEntries)
  .where(and(eq(llmWikiEntries.entityId, characterId), eq(llmWikiEntries.userId, userId), isNull(llmWikiEntries.deletedAt)))
  .orderBy(cosineDistance(llmWikiEntries.embedding, vec))
  .limit(5)

// Fallback: full-text search
const rows = await db.select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
  .from(llmWikiEntries)
  .where(and(
    eq(llmWikiEntries.entityId, characterId),
    eq(llmWikiEntries.userId, userId),
    isNull(llmWikiEntries.deletedAt),
    sql`to_tsvector('english', ${llmWikiEntries.title} || ' ' || ${llmWikiEntries.body}) @@ websearch_to_tsquery('english', ${query})`,
  ))
  .limit(5)

return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
```

### 6.8 `queryWikiContext` Pre-Fetch (index.ts)

Existing ILIKE on `llm_wiki_events` at `index.ts:127–144` is replaced with the same pgvector + full-text fallback pattern as `wiki_read`. Both paths use identical retrieval — no split-brain context.

---

## 6. `bulkInsertUnsynced` — Embedding Backfill on Ingestion

Edge-originated wiki events arrive as raw text with no embeddings. The ingestion bridge generates embeddings before inserting, or those rows are invisible to semantic search.

Incoming item types expand: `wiki_event` (existing) → `llm_wiki_events`; new `wiki_entry` type → `llm_wiki_entries` (with embedding).

```typescript
// For wiki_entry items — generate embeddings in parallel, per-entry error isolation
const entryRowsWithEmbeddings = await Promise.all(
  entryRows.map(async (row) => {
    let embedding: number[] | null = null
    try { embedding = await embedText(row.body) } catch { /* log */ }
    return { ...row, embedding }
  })
)
await db.insert(llmWikiEntries).values(entryRowsWithEmbeddings).onConflictDoNothing()

// For wiki_event items — existing behavior, no embedding needed on events table
await db.insert(llmWikiEvents).values(eventRows).onConflictDoNothing()
```

Per-entry try/catch ensures one failed embedding does not abort the entire sync batch.

---

## 7. Cloud Agent Tool Changes

### 7.1 New Files

| File | Purpose |
|---|---|
| `shared/agent-tools-spec.ts` | Unified manifest source of truth |
| `shared/wiki-utils.ts` | `clip()` and `inferTags()` — shared text utilities |
| `cloud-agent/src/db/embeddings.ts` | `embedText` helper, single retry, injectable |
| `cloud-agent/src/tools/time.ts` | `get_current_time` with injected `timezone` string |
| `cloud-agent/src/tools/documents.ts` | `document_search` tool factory (stub — returns empty with note) |
| `cloud-agent/src/tools/reminders.ts` | `set_reminder` tool factory (Cloud SQL insert + scheduler stub) |

### 7.2 Modified Files

| File | Change |
|---|---|
| `cloud-agent/src/db/schema.ts` | Add `llmWikiEntries`, `llmWikiTasks` mirrors; add `embedding` column to `llmWikiEntries` |
| `cloud-agent/src/tools/wiki.ts` | Replace ILIKE on events with pgvector on entries; dual-write; inject `embedText` |
| `cloud-agent/src/tools/tasks.ts` | Add `update_task`, `complete_task`, `delete_task` |
| `cloud-agent/src/agent.ts` | Register all new tools; use `getSchemasForCloud` for ADK tool name alignment |
| `cloud-agent/src/index.ts` | Replace `queryWikiContext` ILIKE with pgvector+fallback; expand `bulkInsertUnsynced` for `wiki_entry` items with embedding backfill; parse `X-Timezone` header; pass timezone to `buildAgent` |
| `src/services/cloudAgentService.ts` | Add `X-Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` header |
| `cloud-agent/docker-compose.local.yml` | Shift build context to repo root; add `shared/` volume mount |
| `cloud-agent/Dockerfile` | Root build context; folder depth preserved |
| `cloud-agent/tsconfig.json` | `rootDir: ".."` |
| `cloud-agent/package.json` | Update start script to `dist/cloud-agent/src/index.js` |

### 7.3 `agent.ts` Tool Registration

```typescript
export function buildAgent(db, userId, characterId, systemInstruction, embed) {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.5-flash',
    instruction: systemInstruction,
    tools: [
      getCurrentTimeTool(),
      wikiReadTool(db, userId, characterId, embed),
      wikiWriteTool(db, userId, characterId, embed),
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      updateTaskTool(db, userId, characterId),
      completeTaskTool(db, userId, characterId),
      deleteTaskTool(db, userId, characterId),
      documentSearchTool(db, userId, characterId),
      setReminderTool(db, userId, characterId),
    ],
  })
}
```

ADK tool `name` fields must match `agentToolSpec` names exactly.

---

## 8. Edge Agent Changes

### 8.1 Modified Files

| File | Change |
|---|---|
| `src/services/clankerManifests.ts` | Replace with re-export of `getSchemasForEdge` from shared spec, or delete and update callers |
| `src/services/edgeToolExecutors.ts` | Rename `search_memory`→`wiki_read`, `write_observation`→`wiki_write`; add `update_task`, `complete_task`, `delete_task`, `document_search` |
| `src/hooks/useEdgeAgent.ts` | Replace manual `functionDeclarations` array with `getSchemasForEdge(!!wiki, isCloudSynced)` |
| `metro.config.js` | Add `shared/` to `watchFolders` |

### 8.2 New Task Executors (edgeToolExecutors.ts)

```typescript
update_task: async (args) => {
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!taskId || !title) return 'Failed to update task: taskId and title are required.'
  await updateTask(characterId, taskId, title)
  return 'Task updated.'
},
complete_task: async (args) => {
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (!taskId) return 'Failed to complete task: taskId is required.'
  await completeTask(characterId, taskId)
  return 'Task marked as completed.'
},
delete_task: async (args) => {
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (!taskId) return 'Failed to delete task: taskId is required.'
  await deleteTask(characterId, taskId)
  return 'Task deleted.'
},
```

Local SQLite `taskDatabase.ts` must expose `updateTask`, `completeTask`, `deleteTask`.

---

## 9. Security Model (Unchanged)

| Threat | Mitigation |
|---|---|
| Cross-user data access | `userId` and `characterId` injected via closure — never in LLM-visible params |
| Prompt injection via sync payload | `bulkInsertUnsynced` maps to schema columns only |
| Embedding API key exposure | `GEMINI_API_KEY` env var only; never in response |

---

## 10. Non-Goals

- No changes to Firebase `generateReply` or legacy `memoryFunctions.ts` — retirement tracked separately
- No streaming changes
- Null-embedding backfill job — tracked separately
- `document_search` implementation on cloud side — stub for initial delivery; implementation deferred
- `set_reminder` scheduler wiring — stub insert only; Cloud Scheduler integration deferred

---

## 11. Acceptance Criteria

| Scenario | Expected |
|---|---|
| Edge agent calls `wiki_read` | Returns semantically relevant memories via `expo-llm-wiki` |
| Cloud agent calls `wiki_read` | Returns semantically relevant memories via pgvector on `llm_wiki_entries` |
| `queryWikiContext` pre-fetch and `wiki_read` tool | Both use identical retrieval method — no split-brain |
| `embedText` hits 429 during `wiki_read` | Retries once; falls back to full-text search; chat turn completes |
| `embedText` hits 429 during `wiki_write` | Entry inserted with `embedding: null`; event still appended; no user-visible error |
| `wiki_write` on cloud | Atomic dual-write to `llm_wiki_entries` (structured fact) and `llm_wiki_events` (audit log) |
| Edge sync sends `wiki_entry` items via `unsyncedHistory` | Embeddings generated per-entry before insert; per-entry failure does not abort batch |
| Edge LLM wants to set a reminder | `set_reminder` not in edge declarations; LLM calls `escalate_to_cloud_agent` instead |
| Cloud agent calls `set_reminder` | Tool registered; inserts to Cloud SQL |
| Edge calls `update_task` / `complete_task` / `delete_task` | Local SQLite updated correctly |
| Cloud calls `update_task` / `complete_task` / `delete_task` | Cloud SQL `tasks` updated correctly |
| `docker build` from repo root | Succeeds; `shared/` included in image at correct path |
| `tsc` compiles with `rootDir: ".."` | Output at `dist/cloud-agent/src/index.js` |
| `npm start` in cloud-agent container | Resolves `dist/cloud-agent/src/index.js` |
| All ADK tool factory names | Match `agentToolSpec` names exactly |
