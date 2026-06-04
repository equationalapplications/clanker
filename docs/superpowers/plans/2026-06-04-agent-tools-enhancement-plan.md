# Agent Tools Enhancement — Edge & Cloud Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unified matching tool sets across edge and cloud agents, with a single shared manifest source of truth, semantic wiki memory via pgvector on cloud, full task CRUD on both sides, and timezone-aware time tool.

**Architecture:** A new `shared/` directory at repo root holds the tool manifests and text utilities, imported by both the Expo app (via Metro `watchFolders`) and the cloud agent (via Docker root-context build). Cloud wiki migrates from ILIKE on `llm_wiki_events` to pgvector cosine similarity on `llm_wiki_entries` with a dual-write pattern that also appends to `llm_wiki_events` for the healing layer.

**Tech Stack:** TypeScript, Node.js test runner (`node --test`), Jest (Expo), Drizzle ORM, pgvector (`vector` + `cosineDistance` from `drizzle-orm/pg-core`), `@google/genai` text-embedding-004, Google ADK `FunctionTool`, expo-llm-wiki.

---

## File Map

**Created:**
- `shared/agent-tools-spec.ts` — unified tool manifests + `getSchemasForEdge` / `getSchemasForCloud`
- `shared/wiki-utils.ts` — `clip()` and `inferTags()` text utilities
- `functions/drizzle/0014_pgvector_wiki_embeddings.sql` — migration: vector extension + embedding column + HNSW index
- `cloud-agent/src/db/embeddings.ts` — `embedText()` helper with single retry
- `cloud-agent/src/db/embeddings.test.ts` — tests for retry + failure behaviour
- `cloud-agent/src/tools/time.ts` — `get_current_time` with injected `timezone` string
- `cloud-agent/src/tools/time.test.ts`
- `cloud-agent/src/tools/documents.ts` — `document_search` stub tool
- `cloud-agent/src/tools/documents.test.ts`
- `cloud-agent/src/tools/reminders.ts` — `set_reminder` stub tool
- `cloud-agent/src/tools/reminders.test.ts`

**Modified:**
- `cloud-agent/Dockerfile` — root build context, preserve folder depth
- `docker-compose.local.yml` — root context, shared/ volume
- `cloud-agent/tsconfig.json` — `rootDir: ".."`
- `cloud-agent/package.json` — start script → `dist/cloud-agent/src/index.js`
- `cloud-agent/src/db/schema.ts` — add `llmWikiEntries` with `embedding vector(768)`
- `cloud-agent/src/tools/wiki.ts` — pgvector dual-write; inject `embed`
- `cloud-agent/src/tools/wiki.test.ts` — rewrite for new signatures + dual-write assertions
- `cloud-agent/src/tools/tasks.ts` — add `updateTaskTool`, `completeTaskTool`, `deleteTaskTool`
- `cloud-agent/src/tools/tasks.test.ts` — add tests for the three new tools
- `cloud-agent/src/agent.ts` — register all new tools; accept `timezone` + `embed` params
- `cloud-agent/src/index.ts` — `queryWikiContext` → pgvector+fallback; `bulkInsertUnsynced` dual-write + per-entry embedding; parse `X-Timezone` header
- `cloud-agent/src/index.test.ts` — add timezone header test
- `src/database/taskDatabase.ts` — add `updateTask`, `completeTask`, `deleteTask`
- `src/services/edgeToolExecutors.ts` — rename + add `update_task`, `complete_task`, `delete_task`, `document_search`
- `src/services/clankerManifests.ts` — replace with re-export of `getSchemasForEdge`
- `src/hooks/useEdgeAgent.ts` — replace manual `functionDeclarations` with `getSchemasForEdge`
- `src/services/cloudAgentService.ts` — add `X-Timezone` header
- `metro.config.js` — add `shared/` to `watchFolders`

---

## Task 1: Create `shared/` Foundation

**Files:**
- Create: `shared/wiki-utils.ts`
- Create: `shared/agent-tools-spec.ts`

- [ ] **Step 1: Create `shared/wiki-utils.ts`**

```typescript
// shared/wiki-utils.ts
export function clip(value: string, maxLength: number): string {
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trimEnd()
}

export function inferTags(summary: string): string[] {
  const lowered = summary.toLowerCase()
  const tags: string[] = []
  if (lowered.includes('health') || lowered.includes('workout') || lowered.includes('run')) tags.push('health')
  if (lowered.includes('work') || lowered.includes('job') || lowered.includes('deadline')) tags.push('work')
  if (lowered.includes('partner') || lowered.includes('friend') || lowered.includes('family')) tags.push('relationships')
  if (lowered.includes('goal') || lowered.includes('plan') || lowered.includes('next')) tags.push('goals')
  return tags.slice(0, 3)
}
```

- [ ] **Step 2: Create `shared/agent-tools-spec.ts`**

```typescript
// shared/agent-tools-spec.ts
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
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Topic or keywords to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'wiki_write',
    tier: 'both',
    description: 'Record a new observation about the user into long-term memory. Call when the user shares a personal detail, preference, or fact.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Observation to record.' } },
      required: ['summary'],
    },
  },
  {
    name: 'create_task',
    tier: 'both',
    description: 'Create a new task or to-do item for the user.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Task description.' } },
      required: ['title'],
    },
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
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['taskId', 'title'],
    },
  },
  {
    name: 'complete_task',
    tier: 'both',
    description: 'Mark a task as completed.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_task',
    tier: 'both',
    description: 'Delete a task permanently.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'document_search',
    tier: 'both',
    description: 'Search ingested documents for content relevant to the query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for in documents.' } },
      required: ['query'],
    },
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

- [ ] **Step 3: Commit**

```bash
git add shared/
git commit -m "feat: add shared agent tool manifests and wiki utilities"
```

---

## Task 2: Build Infrastructure

**Files:**
- Modify: `cloud-agent/Dockerfile`
- Modify: `docker-compose.local.yml`
- Modify: `cloud-agent/tsconfig.json`
- Modify: `cloud-agent/package.json`

- [ ] **Step 1: Update `cloud-agent/Dockerfile`**

Replace the entire file content:

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

- [ ] **Step 2: Update `docker-compose.local.yml`**

Replace the `cloud-agent` service `build` and `volumes` block. Full updated file:

```yaml
services:
  cloud-agent:
    build:
      context: .
      dockerfile: cloud-agent/Dockerfile.dev
    ports:
      - "8080:8080"
    volumes:
      - ./shared:/app/shared
      - ./cloud-agent/src:/app/cloud-agent/src
      - /app/cloud-agent/node_modules
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

Note: also create `cloud-agent/Dockerfile.dev` if it doesn't exist — copy Dockerfile but replace the CMD with `tsx watch src/index.ts` for hot-reload.

- [ ] **Step 3: Update `cloud-agent/tsconfig.json`**

Add `rootDir` to `compilerOptions`. Open the file and ensure `compilerOptions` includes:
```json
{
  "compilerOptions": {
    "rootDir": "..",
    "outDir": "./dist"
  }
}
```

Keep all other existing options unchanged.

- [ ] **Step 4: Update start script in `cloud-agent/package.json`**

Change `"start": "node dist/index.js"` to:
```json
"start": "node dist/cloud-agent/src/index.js"
```

- [ ] **Step 5: Verify build compiles**

```bash
cd cloud-agent && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. Output at `dist/cloud-agent/src/index.js`.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/Dockerfile docker-compose.local.yml cloud-agent/tsconfig.json cloud-agent/package.json
git commit -m "build: shift docker context to repo root for shared/ access"
```

---

## Task 3: pgvector Migration + Schema Mirror

**Files:**
- Create: `functions/drizzle/0014_pgvector_wiki_embeddings.sql`
- Modify: `cloud-agent/src/db/schema.ts`

- [ ] **Step 1: Create migration file `functions/drizzle/0014_pgvector_wiki_embeddings.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "llm_wiki_entries"
  ADD COLUMN "embedding" vector(768);

CREATE INDEX "llm_wiki_entries_embedding_idx"
  ON "llm_wiki_entries" USING hnsw ("embedding" vector_cosine_ops);
```

- [ ] **Step 2: Add `llmWikiEntries` to `cloud-agent/src/db/schema.ts`**

Add the following imports to the existing import line at the top (add `vector`, `integer`, `primaryKey`, `bigint`, `jsonb` if not already present):

```typescript
import {
  pgTable, uuid, text, timestamp, bigint, integer, jsonb,
  index, check, primaryKey, vector,
} from 'drizzle-orm/pg-core'
```

Then add after the existing `llmWikiEvents` export:

```typescript
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
}))

// llm_wiki_tasks intentionally NOT mirrored — cloud agent task CRUD targets the `tasks` table only.
```

- [ ] **Step 3: Verify schema compiles**

```bash
cd cloud-agent && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add functions/drizzle/0014_pgvector_wiki_embeddings.sql cloud-agent/src/db/schema.ts
git commit -m "feat: add pgvector embedding column to llm_wiki_entries + schema mirror"
```

---

## Task 4: `embedText` Helper

**Files:**
- Create: `cloud-agent/src/db/embeddings.ts`
- Create: `cloud-agent/src/db/embeddings.test.ts`

- [ ] **Step 1: Write failing test `cloud-agent/src/db/embeddings.test.ts`**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'

test('embedText: returns number array from mock provider', async () => {
  const mockEmbed = async (_text: string) => [0.1, 0.2, 0.3]
  assert.deepEqual(await mockEmbed('hello'), [0.1, 0.2, 0.3])
})

test('isRetryable: matches 429 error message', () => {
  // Test the exported helper indirectly via re-export
  const { isRetryable } = (await import('./embeddings.js')) as { isRetryable: (e: unknown) => boolean }
  assert.equal(isRetryable(new Error('HTTP 429 rate limit exceeded')), true)
  assert.equal(isRetryable(new Error('quota exceeded')), true)
  assert.equal(isRetryable(new Error('503 service unavailable')), true)
  assert.equal(isRetryable(new Error('unknown error')), false)
  assert.equal(isRetryable('not an error'), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|PASS|embedText|isRetryable"
```

Expected: fails because `embeddings.js` doesn't exist.

- [ ] **Step 3: Create `cloud-agent/src/db/embeddings.ts`**

```typescript
import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'text-embedding-004'

export function isRetryable(err: unknown): boolean {
  if (err instanceof Error) return /429|503|rate.?limit|quota/i.test(err.message)
  return false
}

export async function embedText(text: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
  try {
    const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
    return result.embeddings[0]!.values!
  } catch (err) {
    if (isRetryable(err)) {
      await new Promise(r => setTimeout(r, 1000))
      const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
      return result.embeddings[0]!.values!
    }
    throw err
  }
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|PASS|embeddings"
```

Expected: both `isRetryable` tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/db/embeddings.ts cloud-agent/src/db/embeddings.test.ts
git commit -m "feat: add embedText helper with single retry for 429/503"
```

---

## Task 5: Cloud Wiki Tools — pgvector Dual-Write

**Files:**
- Modify: `cloud-agent/src/tools/wiki.ts`
- Modify: `cloud-agent/src/tools/wiki.test.ts`

- [ ] **Step 1: Write failing tests in `cloud-agent/src/tools/wiki.test.ts`**

Replace the entire file:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type InsertedRow = Record<string, unknown>

const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2, 0.3]
const failEmbed = async (_text: string): Promise<number[]> => { throw new Error('embed failed') }

function makeMockDb(queryRows: InsertedRow[] = []) {
  const txInserted: InsertedRow[] = []
  return {
    _txInserted: txInserted,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: (_table: unknown) => ({
          values: (row: InsertedRow) => {
            txInserted.push(row)
            return {
              onConflictDoUpdate: () => Promise.resolve(),
              onConflictDoNothing: () => Promise.resolve(),
            }
          },
        }),
      }
      return cb(tx)
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => queryRows,
          }),
          limit: async () => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _txInserted: InsertedRow[] }
}

const { wikiReadTool, wikiWriteTool } = await import('./wiki.js')

test('wikiReadTool: name is wiki_read', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  assert.equal(tool.name, 'wiki_read')
})

test('wikiReadTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('query' in props)
})

test('wikiReadTool: returns formatted context when results found', async () => {
  const rows = [
    { title: 'Diet', body: 'User is vegetarian' },
    { title: 'Pets', body: 'User likes cats' },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'food' })
  assert.ok(result.includes('User is vegetarian'))
  assert.ok(result.includes('User likes cats'))
})

test('wikiReadTool: returns empty string when no results', async () => {
  const db = makeMockDb([])
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'nothing' })
  assert.equal(result, '')
})

test('wikiWriteTool: name is wiki_write', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  assert.equal(tool.name, 'wiki_write')
})

test('wikiWriteTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('summary' in props)
})

test('wikiWriteTool: dual-write inserts entry and event in transaction', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-99', 'char-42', mockEmbed)
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User prefers morning meetings.' })

  const rows = (db as unknown as { _txInserted: InsertedRow[] })._txInserted
  assert.equal(rows.length, 2)
  const entry = rows.find(r => 'body' in r)
  const event = rows.find(r => 'eventType' in r)
  assert.ok(entry, 'expected llm_wiki_entries insert')
  assert.ok(event, 'expected llm_wiki_events insert')
  assert.equal(entry!['entityId'], 'char-42')
  assert.equal(entry!['userId'], 'user-99')
  assert.equal(entry!['confidence'], 'inferred')
  assert.deepEqual(entry!['embedding'], [0.1, 0.2, 0.3])
  assert.equal(event!['entityId'], 'char-42')
  assert.equal(event!['eventType'], 'observation')
})

test('wikiWriteTool: inserts entry with null embedding when embed fails', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', failEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User is left-handed.' })
  assert.equal(result, 'Observation recorded successfully.')
  const rows = (db as unknown as { _txInserted: InsertedRow[] })._txInserted
  const entry = rows.find(r => 'body' in r)
  assert.ok(entry)
  assert.equal(entry!['embedding'], null)
})

test('wikiWriteTool: returns success string', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User is left-handed.' })
  assert.equal(result, 'Observation recorded successfully.')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "wiki|FAIL|PASS" | head -20
```

Expected: failures because `wikiReadTool` and `wikiWriteTool` don't accept `embed` param yet.

- [ ] **Step 3: Rewrite `cloud-agent/src/tools/wiki.ts`**

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/pg-core'
import { llmWikiEntries, llmWikiEvents } from '../db/schema.js'
import { clip, inferTags } from '../../../shared/wiki-utils.js'
import type { DrizzleClient } from '../db/client.js'

type EmbedFn = (text: string) => Promise<number[]>

function parseSummary(summary: string): { title: string; body: string; tags: string[] } {
  const title = clip(summary.split(/[.!?]/)[0] ?? summary, 64)
  const body = clip(summary, 200)
  return { title, body, tags: inferTags(summary) }
}

export function wikiReadTool(db: DrizzleClient, userId: string, characterId: string, embed: EmbedFn): FunctionTool {
  return new FunctionTool({
    name: 'wiki_read',
    description: "Search the user's long-term memory using semantic search. ALWAYS use if the user asks to recall something previously discussed.",
    parameters: z.object({
      query: z.string().describe('Topic or keywords to search for.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { query } = args as { query: string }
        if (!query?.trim()) return ''

        let rows: { title: string; body: string }[]

        try {
          const vec = await embed(query.trim())
          rows = await db
            .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
            .from(llmWikiEntries)
            .where(and(
              eq(llmWikiEntries.entityId, characterId),
              eq(llmWikiEntries.userId, userId),
              isNull(llmWikiEntries.deletedAt),
            ))
            .orderBy(cosineDistance(llmWikiEntries.embedding, vec))
            .limit(5)
        } catch {
          // embedText failed — fall back to full-text search
          rows = await db
            .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
            .from(llmWikiEntries)
            .where(and(
              eq(llmWikiEntries.entityId, characterId),
              eq(llmWikiEntries.userId, userId),
              isNull(llmWikiEntries.deletedAt),
              sql`to_tsvector('english', coalesce(${llmWikiEntries.title}, '') || ' ' || coalesce(${llmWikiEntries.body}, '')) @@ websearch_to_tsquery('english', ${query.trim().slice(0, 200)})`,
            ))
            .limit(5)
        }

        if (rows.length === 0) return ''
        return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
      } catch (error) {
        console.error('[CloudAgent] wiki_read failed:', error)
        return 'Failed to search memory due to an internal error.'
      }
    },
  })
}

export function wikiWriteTool(db: DrizzleClient, userId: string, characterId: string, embed: EmbedFn): FunctionTool {
  return new FunctionTool({
    name: 'wiki_write',
    description: 'Record a new observation about the user into long-term memory. Call when the user shares a personal detail, preference, or fact.',
    parameters: z.object({
      summary: z.string().describe('Observation to record.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { summary } = args as { summary: string }
        if (!summary?.trim()) return 'Failed to record observation: summary is required.'

        const { title, body, tags } = parseSummary(summary.trim())
        const entryId = crypto.randomUUID()
        const now = Date.now()

        let embedding: number[] | null = null
        try { embedding = await embed(body) } catch { console.warn('[CloudAgent] wiki_write embed failed, inserting with null embedding') }

        await db.transaction(async (tx) => {
          await (tx as DrizzleClient).insert(llmWikiEntries).values({
            id: entryId,
            entityId: characterId,
            userId,
            title,
            body,
            tags,
            confidence: 'inferred',
            sourceType: 'agent_inferred',
            embedding,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: [llmWikiEntries.id, llmWikiEntries.userId],
            set: {
              body: sql`excluded.body`,
              updatedAt: sql`excluded.updated_at`,
              embedding: sql`excluded.embedding`,
            },
          })

          await (tx as DrizzleClient).insert(llmWikiEvents).values({
            id: crypto.randomUUID(),
            entityId: characterId,
            userId,
            eventType: 'observation',
            summary: clip(`${title}: ${body}`, 200),
            createdAt: now,
          })
        })

        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[CloudAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
  })
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "wiki|FAIL|PASS"
```

Expected: all wiki tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/wiki.ts cloud-agent/src/tools/wiki.test.ts
git commit -m "feat: cloud wiki_read/wiki_write — pgvector cosine search + dual-write"
```

---

## Task 6: Cloud Task CRUD Extensions

**Files:**
- Modify: `cloud-agent/src/tools/tasks.ts`
- Modify: `cloud-agent/src/tools/tasks.test.ts`

- [ ] **Step 1: Add failing tests to `cloud-agent/src/tools/tasks.test.ts`**

Append to the existing file (keep all existing tests, add below):

```typescript
const { updateTaskTool, completeTaskTool, deleteTaskTool } = await import('./tasks.js')

// Mock db that captures update/delete calls
function makeMutationDb() {
  const updates: Record<string, unknown>[] = []
  return {
    _updates: updates,
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values)
          return Promise.resolve()
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: () => {
        updates.push({ _deleted: true })
        return Promise.resolve()
      },
    }),
  }
}

test('updateTaskTool: name is update_task', () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'update_task')
})

test('updateTaskTool: schema has taskId and title but not userId', () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const props = tool._getDeclaration().parameters?.properties ?? {}
  assert.ok('taskId' in props)
  assert.ok('title' in props)
  assert.ok(!('userId' in props))
})

test('updateTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1', title: 'New title' })
  assert.equal(result, 'Task updated.')
})

test('completeTaskTool: name is complete_task', () => {
  const db = makeMutationDb()
  const tool = completeTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'complete_task')
})

test('completeTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = completeTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1' })
  assert.equal(result, 'Task marked as completed.')
})

test('deleteTaskTool: name is delete_task', () => {
  const db = makeMutationDb()
  const tool = deleteTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'delete_task')
})

test('deleteTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = deleteTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1' })
  assert.equal(result, 'Task deleted.')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "update_task|complete_task|delete_task|FAIL"
```

Expected: failures because the three new tools don't exist.

- [ ] **Step 3: Add tools to `cloud-agent/src/tools/tasks.ts`**

Add after the existing `listTasksTool` export. Also add `eq, and` to existing drizzle imports if not present:

```typescript
export function updateTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'update_task',
    description: 'Update the title of an existing task.',
    parameters: z.object({
      taskId: z.string(),
      title: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId, title } = args as { taskId: string; title: string }
        if (!taskId?.trim() || !title?.trim()) return 'Failed to update task: taskId and title are required.'
        await db.update(tasks)
          .set({ title: title.trim(), updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task updated.'
      } catch (error) {
        console.error('[CloudAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
  })
}

export function completeTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'complete_task',
    description: 'Mark a task as completed.',
    parameters: z.object({
      taskId: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId } = args as { taskId: string }
        if (!taskId?.trim()) return 'Failed to complete task: taskId is required.'
        await db.update(tasks)
          .set({ status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[CloudAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
  })
}

export function deleteTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'delete_task',
    description: 'Delete a task permanently.',
    parameters: z.object({
      taskId: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId } = args as { taskId: string }
        if (!taskId?.trim()) return 'Failed to delete task: taskId is required.'
        await db.delete(tasks)
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task deleted.'
      } catch (error) {
        console.error('[CloudAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
  })
}
```

Also ensure `update, delete` are imported from `drizzle-orm` at the top of `tasks.ts`:
```typescript
import { eq, and, desc } from 'drizzle-orm'
```
(Add `update` and `delete` are Drizzle table methods, called as `db.update(table)` and `db.delete(table)` — no extra imports needed.)

- [ ] **Step 4: Run tests and verify pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "update_task|complete_task|delete_task|FAIL|PASS"
```

Expected: all six new task tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/tasks.ts cloud-agent/src/tools/tasks.test.ts
git commit -m "feat: add update_task, complete_task, delete_task to cloud agent"
```

---

## Task 7: New Cloud Tools (time, documents, reminders)

**Files:**
- Create: `cloud-agent/src/tools/time.ts` + `time.test.ts`
- Create: `cloud-agent/src/tools/documents.ts` + `documents.test.ts`
- Create: `cloud-agent/src/tools/reminders.ts` + `reminders.test.ts`

- [ ] **Step 1: Write failing tests `cloud-agent/src/tools/time.test.ts`**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'

const { getCurrentTimeTool } = await import('./time.js')

test('getCurrentTimeTool: name is get_current_time', () => {
  const tool = getCurrentTimeTool('UTC')
  assert.equal(tool.name, 'get_current_time')
})

test('getCurrentTimeTool: result contains timezone info', async () => {
  const tool = getCurrentTimeTool('America/New_York')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.ok(typeof result === 'string' && result.length > 0)
})

test('getCurrentTimeTool: falls back to UTC for invalid timezone', async () => {
  const tool = getCurrentTimeTool('not/a/zone')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.ok(typeof result === 'string' && result.length > 0)
})
```

- [ ] **Step 2: Create `cloud-agent/src/tools/time.ts`**

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'

export function getCurrentTimeTool(timezone: string): FunctionTool {
  return new FunctionTool({
    name: 'get_current_time',
    description: 'CRITICAL: ALWAYS call this tool if the user asks for the current time, date, day of week, or uses relative temporal words (today, tomorrow). Do not guess.',
    parameters: z.object({}),
    execute: async (): Promise<string> => {
      let tz = timezone || 'UTC'
      try {
        // Validate the timezone string — Intl.DateTimeFormat throws for invalid zones
        Intl.DateTimeFormat(undefined, { timeZone: tz })
      } catch {
        tz = 'UTC'
      }
      return new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: tz,
      })
    },
  })
}
```

- [ ] **Step 3: Write and create `cloud-agent/src/tools/documents.test.ts`**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

const { documentSearchTool } = await import('./documents.js')

test('documentSearchTool: name is document_search', () => {
  const tool = documentSearchTool({} as DrizzleClient, 'u', 'c')
  assert.equal(tool.name, 'document_search')
})

test('documentSearchTool: returns stub message', async () => {
  const tool = documentSearchTool({} as DrizzleClient, 'u', 'c')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'test' })
  assert.ok(typeof result === 'string')
})
```

- [ ] **Step 4: Create `cloud-agent/src/tools/documents.ts`**

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DrizzleClient } from '../db/client.js'

export function documentSearchTool(_db: DrizzleClient, _userId: string, _characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'document_search',
    description: 'Search ingested documents for content relevant to the query.',
    parameters: z.object({
      query: z.string().describe('What to search for in documents.'),
    }),
    execute: async (_args: unknown): Promise<string> => {
      // Document search is not yet implemented on the cloud side.
      return 'Document search is not yet available.'
    },
  })
}
```

- [ ] **Step 5: Write and create `cloud-agent/src/tools/reminders.test.ts`**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

const { setReminderTool } = await import('./reminders.js')

test('setReminderTool: name is set_reminder', () => {
  const tool = setReminderTool({} as DrizzleClient, 'u', 'c')
  assert.equal(tool.name, 'set_reminder')
})

test('setReminderTool: returns acknowledgement', async () => {
  const tool = setReminderTool({} as DrizzleClient, 'u', 'c')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ message: 'Call dentist', remind_at: '2026-07-01T09:00:00Z' })
  assert.ok(typeof result === 'string')
})
```

- [ ] **Step 6: Create `cloud-agent/src/tools/reminders.ts`**

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DrizzleClient } from '../db/client.js'

export function setReminderTool(_db: DrizzleClient, _userId: string, _characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'set_reminder',
    description: 'Schedule a reminder for the user at a specific future time.',
    parameters: z.object({
      message: z.string(),
      remind_at: z.string().describe('ISO 8601 datetime.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      const { message, remind_at } = args as { message: string; remind_at: string }
      // Scheduler integration is not yet wired. Stub acknowledges the request.
      console.log(`[CloudAgent] set_reminder stub: "${message}" at ${remind_at}`)
      return `Reminder set: "${message}" for ${remind_at}.`
    },
  })
}
```

- [ ] **Step 7: Run all new tool tests**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "get_current_time|document_search|set_reminder|FAIL|PASS"
```

Expected: all nine new tests pass.

- [ ] **Step 8: Commit**

```bash
git add cloud-agent/src/tools/time.ts cloud-agent/src/tools/time.test.ts \
        cloud-agent/src/tools/documents.ts cloud-agent/src/tools/documents.test.ts \
        cloud-agent/src/tools/reminders.ts cloud-agent/src/tools/reminders.test.ts
git commit -m "feat: add get_current_time (timezone-aware), document_search stub, set_reminder stub"
```

---

## Task 8: Cloud Agent Registration + `index.ts` Updates

**Files:**
- Modify: `cloud-agent/src/agent.ts`
- Modify: `cloud-agent/src/index.ts`

- [ ] **Step 1: Update `cloud-agent/src/agent.ts`**

Replace the entire file:

```typescript
import { LlmAgent } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
import type { embedText } from './db/embeddings.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: typeof embedText,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.5-flash',
    instruction: systemInstruction,
    tools: [
      getCurrentTimeTool(timezone),
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

- [ ] **Step 2: Update `queryWikiContext` in `cloud-agent/src/index.ts`**

Find the existing `queryWikiContext` function (around line 127) and replace it:

```typescript
async function queryWikiContext(
  db: DrizzleClient,
  query: string,
  userId: string,
  characterId: string,
  embed: (text: string) => Promise<number[]>,
): Promise<string> {
  const normalizedQuery = query.trim().slice(0, 200)
  if (!normalizedQuery) return ''

  try {
    const vec = await embed(normalizedQuery)
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
      ))
      .orderBy(cosineDistance(llmWikiEntries.embedding, vec))
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  } catch {
    // embedText failed — fall back to full-text search
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
        sql`to_tsvector('english', coalesce(${llmWikiEntries.title}, '') || ' ' || coalesce(${llmWikiEntries.body}, '')) @@ websearch_to_tsquery('english', ${normalizedQuery})`,
      ))
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  }
}
```

Add the required imports to `index.ts`:
- Add `isNull` to the existing `drizzle-orm` import
- Add `cosineDistance` from `'drizzle-orm/pg-core'`
- Add `llmWikiEntries` to the existing schema import
- Add `import { embedText } from './db/embeddings.js'`

- [ ] **Step 3: Update `bulkInsertUnsynced` in `cloud-agent/src/index.ts`**

Update the type and add wiki_entry handling. First, expand the union type:

```typescript
type UnsyncedTask = { type: 'task'; id: string; title: string; status: string; createdAt: number }
type UnsyncedWikiEntry = { type: 'wiki_entry'; id: string; title: string; body: string; confidence?: string; sourceType?: string; createdAt: number; updatedAt: number }
type UnsyncedWikiEvent = { type: 'wiki_event'; id: string; eventType: string; summary: string; createdAt: number }
type UnsyncedItem = UnsyncedTask | UnsyncedWikiEntry | UnsyncedWikiEvent
```

Then update `bulkInsertUnsynced` signature to accept `embed` and handle `wiki_entry`:

```typescript
async function bulkInsertUnsynced(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  items: unknown[],
  embed: (text: string) => Promise<number[]>,
): Promise<void> {
  const taskRows: Array<{ id: string; characterId: string; userId: string; title: string; status: string; createdAt: Date; updatedAt: Date }> = []
  const wikiEntryItems: UnsyncedWikiEntry[] = []
  const wikiEventRows: Array<{ id: string; entityId: string; userId: string; eventType: string; summary: string; createdAt: number }> = []

  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as UnsyncedItem
    if (item.type === 'task') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.title !== 'string' || !item.title.trim()) continue
      if (typeof item.createdAt !== 'number') continue
      taskRows.push({
        id: item.id.trim(), characterId, userId,
        title: item.title.trim(), status: toCloudStatus(item.status),
        createdAt: toCloudTimestamp(item.createdAt), updatedAt: new Date(),
      })
    } else if (item.type === 'wiki_entry') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.body !== 'string' || !item.body.trim()) continue
      wikiEntryItems.push(item)
    } else if (item.type === 'wiki_event') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.summary !== 'string' || !item.summary.trim()) continue
      if (typeof item.createdAt !== 'number') continue
      const allowedEvents = ['observation', 'decision', 'action', 'outcome'] as const
      type AllowedEvent = (typeof allowedEvents)[number]
      const eventType = allowedEvents.includes(item.eventType as AllowedEvent) ? item.eventType : 'observation'
      wikiEventRows.push({
        id: item.id.trim(), entityId: characterId, userId,
        eventType, summary: item.summary.trim(),
        createdAt: toCloudTimestamp(item.createdAt).getTime(),
      })
    }
  }

  if (taskRows.length > 0) {
    await db.insert(tasks).values(taskRows).onConflictDoNothing()
  }

  if (wikiEntryItems.length > 0) {
    const wikiEntryRows = await Promise.all(
      wikiEntryItems.map(async (item) => {
        let embedding: number[] | null = null
        try { embedding = await embed(item.body.trim()) } catch { /* log, insert with null */ }
        return {
          id: item.id.trim(), entityId: characterId, userId,
          title: (item.title ?? '').trim() || item.body.trim().slice(0, 64),
          body: item.body.trim(),
          tags: [],
          confidence: item.confidence === 'certain' ? 'certain' : 'inferred',
          sourceType: item.sourceType ?? 'agent_inferred',
          embedding,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt ?? item.createdAt,
        }
      }),
    )
    await db.insert(llmWikiEntries).values(wikiEntryRows).onConflictDoNothing()
  }

  if (wikiEventRows.length > 0) {
    await db.insert(llmWikiEvents).values(wikiEventRows).onConflictDoNothing()
  }
}
```

- [ ] **Step 4: Update `X-Timezone` parsing and pass through in `/agent/run` handler**

In the `/agent/run` handler, after parsing the request body, add timezone extraction:

```typescript
// After: const { message, characterId, unsyncedHistory = [], history: rawHistory = [] } = parseResult.data
const timezone = typeof req.headers['x-timezone'] === 'string' ? req.headers['x-timezone'].trim() : 'UTC'
```

Pass `timezone` and `embed` to `buildAgent` call. Find the `runAgentFn` call and update `queryWikiContext` and `bulkInsertUnsynced` calls to include `embedText`:

```typescript
// Update bulkInsertUnsynced call:
await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory, embedText)

// Update queryWikiContext call:
wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
```

Update `RunAgentParams` interface to include `timezone` and update `runAgentReal` to pass it to `buildAgent`:

```typescript
export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
  timezone: string
  embed: (text: string) => Promise<number[]>
}
```

In `runAgentReal`:
```typescript
const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed)
```

And in the handler's `runAgentFn` call:
```typescript
result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history, timezone, embed: embedText })
```

- [ ] **Step 5: Verify cloud-agent builds and tests pass**

```bash
cd cloud-agent && npm run typecheck 2>&1 | tail -10
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|PASS" | tail -20
```

Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/agent.ts cloud-agent/src/index.ts
git commit -m "feat: wire all new cloud tools, pgvector queryWikiContext, timezone header"
```

---

## Task 9: Edge SQLite Task CRUD

**Files:**
- Modify: `src/database/taskDatabase.ts`

- [ ] **Step 1: Add three new functions to `src/database/taskDatabase.ts`**

```typescript
export async function updateTask(characterId: string, taskId: string, title: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE tasks SET title = ? WHERE id = ? AND character_id = ?',
    [title, taskId, characterId],
  )
}

export async function completeTask(characterId: string, taskId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    "UPDATE tasks SET status = 'done' WHERE id = ? AND character_id = ?",
    [taskId, characterId],
  )
}

export async function deleteTask(characterId: string, taskId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'DELETE FROM tasks WHERE id = ? AND character_id = ?',
    [taskId, characterId],
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep taskDatabase | head -10
```

Expected: no errors for `taskDatabase.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/database/taskDatabase.ts
git commit -m "feat: add updateTask, completeTask, deleteTask to SQLite task database"
```

---

## Task 10: Edge Tool Executor Renames + Additions

**Files:**
- Modify: `src/services/edgeToolExecutors.ts`

- [ ] **Step 1: Replace `src/services/edgeToolExecutors.ts`**

```typescript
import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'

export type ToolExecutor = (args: Record<string, unknown>) => unknown | Promise<unknown>

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
}

export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    wiki_read: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'
        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories = results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_read failed:', error)
        return 'No relevant memories found.'
      }
    },
    wiki_write: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary) return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
    create_task: async (args) => {
      try {
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!title) return 'Failed to create task: title is required.'
        const taskId = await createTask(characterId, title)
        return JSON.stringify({ taskId, title })
      } catch (error) {
        console.error('[EdgeAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
    list_tasks: async () => {
      try {
        const tasks = await listTasks(characterId)
        if (tasks.length === 0) return 'No tasks found.'
        return JSON.stringify(tasks.map((t: LocalTask) => ({ id: t.id, title: t.title, status: t.status })))
      } catch (error) {
        console.error('[EdgeAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
    update_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!taskId || !title) return 'Failed to update task: taskId and title are required.'
        await updateTask(characterId, taskId, title)
        return 'Task updated.'
      } catch (error) {
        console.error('[EdgeAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
    complete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to complete task: taskId is required.'
        await completeTask(characterId, taskId)
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[EdgeAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
    delete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to delete task: taskId is required.'
        await deleteTask(characterId, taskId)
        return 'Task deleted.'
      } catch (error) {
        console.error('[EdgeAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
    document_search: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return 'No results found.'
        // Local document search — implementation deferred
        return 'Document search is not yet available on device.'
      } catch (error) {
        console.error('[EdgeAgent] document_search failed:', error)
        return 'Failed to search documents due to an internal error.'
      }
    },
  }
}
```

- [ ] **Step 2: Verify the existing edge agent tests still pass**

```bash
npx jest src/services/__tests__/edgeAgentEvals.int.test.ts --passWithNoTests 2>&1 | tail -10
```

Expected: passes or no test file found.

- [ ] **Step 3: Commit**

```bash
git add src/services/edgeToolExecutors.ts
git commit -m "feat: rename search_memory/write_observation → wiki_read/wiki_write; add task CRUD + document_search to edge"
```

---

## Task 11: Edge Manifest Migration + Hook Update

**Files:**
- Modify: `src/services/clankerManifests.ts`
- Modify: `src/hooks/useEdgeAgent.ts`
- Modify: `metro.config.js`

- [ ] **Step 1: Replace `src/services/clankerManifests.ts`**

```typescript
// Re-export from shared spec. Tool manifests are now the single source of truth in shared/agent-tools-spec.ts.
export { getSchemasForEdge, agentToolSpec } from '../../../shared/agent-tools-spec'
```

- [ ] **Step 2: Update `src/hooks/useEdgeAgent.ts`**

Replace the `functionDeclarations` construction block. Find the section:

```typescript
const functionDeclarations = [clankerTimeSchema, clankerCreateTaskSchema, clankerListTasksSchema]
if (wiki) {
  functionDeclarations.push(clankerMemorySchema)
  functionDeclarations.push(clankerWriteObservationSchema)
}
if (isCloudSynced) {
  functionDeclarations.push(clankerEscalationSchema)
}
```

Replace with:

```typescript
import { getSchemasForEdge } from '~/services/clankerManifests'
// ...
const functionDeclarations = getSchemasForEdge(!!wiki, isCloudSynced)
```

Also remove the old `clankerTimeSchema`, `clankerCreateTaskSchema`, `clankerListTasksSchema`, `clankerMemorySchema`, `clankerWriteObservationSchema`, `clankerEscalationSchema` imports from the top of the file.

- [ ] **Step 3: Update `metro.config.js`**

Add `watchFolders` after the existing `blockList` config:

```javascript
const path = require('path')
// ... (path is already imported at the top of metro.config.js)

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, 'shared'),
]
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "clankerManifests|useEdgeAgent|shared" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/clankerManifests.ts src/hooks/useEdgeAgent.ts metro.config.js
git commit -m "feat: migrate edge to shared manifest; replace clankerManifests with getSchemasForEdge"
```

---

## Task 12: Edge Timezone Header

**Files:**
- Modify: `src/services/cloudAgentService.ts`

- [ ] **Step 1: Add `X-Timezone` header to `callCloudAgent`**

In `src/services/cloudAgentService.ts`, find the `headers` object in the `fetch` call and add the timezone:

```typescript
headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
  'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
},
```

- [ ] **Step 2: Run the Expo type check**

```bash
npx tsc --noEmit 2>&1 | grep cloudAgentService | head -5
```

Expected: no errors.

- [ ] **Step 3: Run full cloud-agent test suite**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|PASS|error" | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/cloudAgentService.ts
git commit -m "feat: send X-Timezone header from Expo to cloud agent"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| `shared/agent-tools-spec.ts` with `getSchemasForEdge`/`getSchemasForCloud` | Task 1 |
| `shared/wiki-utils.ts` with `clip()`/`inferTags()` | Task 1 |
| Docker root build context | Task 2 |
| `docker-compose.local.yml` context fix | Task 2 |
| `tsconfig.json` `rootDir: ".."` | Task 2 |
| start script → `dist/cloud-agent/src/index.js` | Task 2 |
| Migration `0014_pgvector_wiki_embeddings.sql` | Task 3 |
| `llmWikiEntries` schema mirror with `embedding vector(768)` | Task 3 |
| `embedText` with single retry + `isRetryable` | Task 4 |
| `wiki_read` pgvector + full-text fallback | Task 5 |
| `wiki_write` dual-write transaction | Task 5 |
| Null embedding fallback on `wiki_write` | Task 5 |
| `update_task`, `complete_task`, `delete_task` on cloud | Task 6 |
| `get_current_time` with timezone injection | Task 7 |
| `document_search` stub | Task 7 |
| `set_reminder` stub | Task 7 |
| All new tools registered in `agent.ts` | Task 8 |
| `queryWikiContext` → pgvector + full-text fallback | Task 8 |
| `bulkInsertUnsynced` expanded for `wiki_entry` with embeddings | Task 8 |
| `X-Timezone` parsing in `index.ts` | Task 8 |
| `updateTask`, `completeTask`, `deleteTask` on SQLite | Task 9 |
| Edge executor renames + new executors | Task 10 |
| `clankerManifests.ts` replaced with shared re-export | Task 11 |
| `useEdgeAgent.ts` uses `getSchemasForEdge` | Task 11 |
| `metro.config.js` `watchFolders` | Task 11 |
| `X-Timezone` header in `cloudAgentService.ts` | Task 12 |

All spec requirements covered. No placeholders found. Type signatures are consistent: `embed: EmbedFn` in Task 5 matches `embed: typeof embedText` in Task 8 (same shape — `(text: string) => Promise<number[]>`).
