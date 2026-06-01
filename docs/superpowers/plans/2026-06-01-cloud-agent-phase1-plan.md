# Cloud Agent Phase 1 — Backend Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a self-contained, production-ready Express + ADK Cloud Run container in `cloud-agent/` that accepts Firebase-auth'd requests from Expo and runs a stateless Gemini agent with `create_task`, `list_tasks`, `wiki_read`, and `wiki_write` tools backed by Cloud SQL.

**Architecture:** Expo calls `POST /agent/run` directly on Cloud Run (no Firebase Functions involved). `requireFirebaseAuth` middleware verifies the Firebase ID token and extracts `uid`. The handler bulk-inserts any offline delta, pre-fetches wiki context, assembles a system instruction, then runs an `InMemoryRunner` with an `LlmAgent` whose tools have `userId`/`characterId` injected via closure — the LLM never sees those values.

**Tech Stack:** Node 22, TypeScript 6, Express 4, `@google/adk` (LlmAgent + InMemoryRunner + FunctionTool + isFinalResponse), `drizzle-orm` (node-postgres), `@google-cloud/cloud-sql-connector`, `firebase-admin`, `node:test` (test runner), `tsx` (dev server).

**Spec:** `docs/superpowers/specs/2026-06-01-cloud-agent-phase1-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `functions/src/db/schema.ts` | Modify | Add `tasks` Drizzle table export |
| `functions/drizzle/0013_cloud_agent_tasks.sql` | Create | Cloud SQL migration for `tasks` table |
| `cloud-agent/package.json` | Create | ESM, Node 22, all deps |
| `cloud-agent/tsconfig.json` | Create | NodeNext, strict, dist/ output |
| `cloud-agent/Dockerfile` | Create | Multi-stage build for Cloud Run |
| `cloud-agent/src/db/schema.ts` | Create | Minimal Drizzle schema (users, characters, tasks, llm_wiki_events) |
| `cloud-agent/src/db/client.ts` | Create | Cloud SQL connector + drizzle singleton |
| `cloud-agent/src/tools/tasks.ts` | Create | `createTaskTool` + `listTasksTool` FunctionTool factories |
| `cloud-agent/src/tools/tasks.test.ts` | Create | Unit tests for task tools |
| `cloud-agent/src/tools/wiki.ts` | Create | `wikiReadTool` + `wikiWriteTool` FunctionTool factories |
| `cloud-agent/src/tools/wiki.test.ts` | Create | Unit tests for wiki tools |
| `cloud-agent/src/agent.ts` | Create | `buildAgent` factory (LlmAgent + tools) |
| `cloud-agent/src/agent.test.ts` | Create | Verify tool registration and instruction |
| `cloud-agent/src/index.ts` | Create | Express app, auth middleware, /health, /agent/run |
| `cloud-agent/src/index.test.ts` | Create | Unit tests for routes and middleware |

---

## Task 1: Cloud SQL `tasks` table migration

**Files:**
- Modify: `functions/src/db/schema.ts`
- Create: `functions/drizzle/0013_cloud_agent_tasks.sql`

The local SQLite `tasks` table (migration v19) has no Cloud SQL counterpart. The cloud agent needs it. `drizzle-kit` reads `functions/src/db/schema.ts` to generate migrations, so add the table there; also write the SQL migration manually (no live DB connection needed).

- [ ] **Step 1: Add `tasks` export to `functions/src/db/schema.ts`**

Append after the `llmWikiEvents` block at the end of the file:

```typescript
// Cloud Agent tasks — cloud-persisted version of the local SQLite tasks table.
// user_id added (absent in SQLite) to satisfy the security WHERE-clause filter.
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  characterUserIdx: index('tasks_character_user_idx').on(table.characterId, table.userId),
  statusCheck: check('tasks_status_check', sql`${table.status} IN ('open', 'done', 'abandoned')`),
}));
```

- [ ] **Step 2: Create the migration SQL file**

Create `functions/drizzle/0013_cloud_agent_tasks.sql`:

```sql
CREATE TABLE "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_status_check" CHECK (status IN ('open', 'done', 'abandoned'))
);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_character_id_characters_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "tasks_character_user_idx" ON "tasks" ("character_id", "user_id");
```

- [ ] **Step 3: Type-check `functions/`**

```bash
cd functions && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add functions/src/db/schema.ts functions/drizzle/0013_cloud_agent_tasks.sql
git commit -m "feat(db): add cloud sql tasks table for cloud agent"
```

---

## Task 2: Package scaffolding

**Files:**
- Create: `cloud-agent/package.json`
- Create: `cloud-agent/tsconfig.json`
- Create: `cloud-agent/Dockerfile`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p cloud-agent/src/tools cloud-agent/src/db
```

- [ ] **Step 2: Create `cloud-agent/package.json`**

```json
{
  "name": "clanker-cloud-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec \"dist/**/*.test.js\""
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
    "@types/node": "^22.19.17",
    "@types/pg": "^8.20.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.9.3",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 3: Create `cloud-agent/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "esModuleInterop": true,
    "moduleResolution": "nodenext",
    "types": ["node"],
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "target": "es2022",
    "skipLibCheck": true
  },
  "compileOnSave": true,
  "include": ["src"]
}
```

- [ ] **Step 4: Create `cloud-agent/Dockerfile`**

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

- [ ] **Step 5: Install dependencies**

```bash
cd cloud-agent && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/package.json cloud-agent/tsconfig.json cloud-agent/Dockerfile cloud-agent/package-lock.json
git commit -m "feat(cloud-agent): add package scaffolding and dockerfile"
```

---

## Task 3: Minimal Drizzle schema

**Files:**
- Create: `cloud-agent/src/db/schema.ts`

This is a mirror of the bounded context the cloud agent owns. It intentionally omits billing, subscription, and Stripe tables. Must stay in sync with `functions/src/db/schema.ts` for the four tables it covers.

- [ ] **Step 1: Create `cloud-agent/src/db/schema.ts`**

```typescript
// Minimal schema mirror — cloud agent bounded context only.
// Source of truth: functions/src/db/schema.ts
// Tables omitted: subscriptions, credit_transactions, messages, legacy wiki tables, stripe tables.
import {
  pgTable, uuid, text, timestamp, bigint,
  index, check, primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appearance: text('appearance'),
  traits: text('traits'),
  emotions: text('emotions'),
  context: text('context'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('characters_user_id_idx').on(table.userId),
}))

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  characterUserIdx: index('tasks_character_user_idx').on(table.characterId, table.userId),
  statusCheck: check('tasks_status_check', sql`${table.status} IN ('open', 'done', 'abandoned')`),
}))

export const llmWikiEvents = pgTable('llm_wiki_events', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityCreatedIdx: index('llm_wiki_events_entity_created_idx').on(table.entityId, table.userId, table.createdAt),
  eventTypeCheck: check(
    'llm_wiki_events_event_type_check',
    sql`${table.eventType} IN ('observation', 'decision', 'action', 'outcome')`
  ),
}))
```

- [ ] **Step 2: Verify it compiles**

```bash
cd cloud-agent && npm run typecheck
```

Expected: no errors (schema file has no imports that require runtime).

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/db/schema.ts
git commit -m "feat(cloud-agent): add minimal drizzle schema for cloud sql bounded context"
```

---

## Task 4: DB client

**Files:**
- Create: `cloud-agent/src/db/client.ts`

Mirrors `functions/src/db/cloudSql.ts` exactly. Throws in test env to prevent accidental real DB connections. Exports `DrizzleClient` type for use in tool factories and index.ts.

- [ ] **Step 1: Create `cloud-agent/src/db/client.ts`**

```typescript
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>

const isTestEnv = process.env.NODE_ENV === 'test'
const requiredVars = [
  'CLOUD_SQL_CONNECTION_NAME',
  'CLOUD_SQL_DB_USER',
  'CLOUD_SQL_DB_PASS',
  'CLOUD_SQL_DB_NAME',
] as const

let connector: Connector | null = null
let pool: pg.Pool | null = null
let dbPromise: Promise<DrizzleClient> | null = null
let closePromise: Promise<void> | null = null
let shutdownHandlersRegistered = false

function getRequiredEnv(name: (typeof requiredVars)[number]): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required Cloud SQL environment variable: ${name}`)
  }
  return value
}

function assertCloudSqlEnv(): void {
  const missing = requiredVars.filter((n) => {
    const v = process.env[n]
    return !v || v.trim().length === 0
  })
  if (missing.length > 0) {
    throw new Error(`Missing required Cloud SQL environment variables: ${missing.join(', ')}`)
  }
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return
  shutdownHandlersRegistered = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void closeCloudSql() })
  }
}

async function createDb(): Promise<DrizzleClient> {
  if (isTestEnv) {
    throw new Error(
      'Direct database access not allowed in test environment. ' +
      'Tests must inject a mock DrizzleClient.'
    )
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

export async function getDb(): Promise<DrizzleClient> {
  if (!dbPromise) {
    dbPromise = createDb().catch((error) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export async function closeCloudSql(): Promise<void> {
  if (closePromise) return closePromise

  closePromise = (async () => {
    const errors: unknown[] = []
    if (pool) {
      try { await pool.end() } catch (e) { errors.push(e) }
    }
    if (connector) {
      try { connector.close() } catch (e) { errors.push(e) }
    }
    pool = null
    connector = null
    dbPromise = null
    if (errors.length > 0) throw errors[0]
  })()

  try {
    await closePromise
  } finally {
    closePromise = null
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd cloud-agent && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/db/client.ts
git commit -m "feat(cloud-agent): add cloud sql connector and drizzle client"
```

---

## Task 5: Task tools (TDD)

**Files:**
- Create: `cloud-agent/src/tools/tasks.ts`
- Create: `cloud-agent/src/tools/tasks.test.ts`

`userId` and `characterId` are injected into closures at factory time — they are not parameters in the tool schema. The LLM only provides `title` for `create_task`; `list_tasks` takes no LLM input.

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/tools/tasks.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

// Inline mock db factory — no imports needed, no module mocking.
type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_table: unknown) => ({
      values: async (row: InsertedRow) => { inserted.push(row) },
    }),
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: async (_order: unknown) => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const { createTaskTool, listTasksTool } = await import('./tasks.js')

test('createTaskTool: name is create_task', () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'create_task')
})

test('createTaskTool: schema does not expose userId or characterId', () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('userId' in props), 'userId must not be in schema')
  assert.ok(!('characterId' in props), 'characterId must not be in schema')
  assert.ok('title' in props, 'title must be in schema')
})

test('createTaskTool: inserts row with closure userId and characterId', async () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-abc', 'char-xyz')
  await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ title: 'Buy milk' })

  const row = (db as unknown as { _inserted: InsertedRow[] })._inserted[0]
  assert.ok(row, 'expected one inserted row')
  assert.equal(row['characterId'], 'char-xyz')
  assert.equal(row['userId'], 'user-abc')
  assert.equal(row['title'], 'Buy milk')
  assert.equal(row['status'], 'open')
  assert.ok(typeof row['id'] === 'string' && row['id'].length > 0)
})

test('createTaskTool: returns JSON with taskId and title', async () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ title: 'Walk dog' })
  const parsed = JSON.parse(result) as { taskId: string; title: string }
  assert.equal(parsed.title, 'Walk dog')
  assert.ok(typeof parsed.taskId === 'string')
})

test('listTasksTool: name is list_tasks', () => {
  const db = makeMockDb()
  const tool = listTasksTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'list_tasks')
})

test('listTasksTool: schema does not expose userId or characterId', () => {
  const db = makeMockDb()
  const tool = listTasksTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('userId' in props))
  assert.ok(!('characterId' in props))
})

test('listTasksTool: returns serialised task rows', async () => {
  const rows = [
    { id: 't-1', characterId: 'char-1', userId: 'user-1', title: 'Task one', status: 'open', createdAt: new Date(), updatedAt: new Date() },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = listTasksTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({})
  const parsed = JSON.parse(result) as typeof rows
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.title, 'Task one')
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error\|Cannot find" | head -5
```

Expected: compilation errors like `Cannot find module './tasks.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud-agent/src/tools/tasks.ts`:

```typescript
import { FunctionTool } from '@google/adk'
import { eq, and } from 'drizzle-orm'
import { tasks } from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

export function createTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'create_task',
    description: 'Create a new task and persist it to cloud storage.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short, clear title for the task.' },
      },
      required: ['title'],
    },
    execute: async (args: unknown): Promise<string> => {
      const { title } = args as { title: string }
      const id = crypto.randomUUID()
      await db.insert(tasks).values({
        id,
        characterId,
        userId,
        title,
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return JSON.stringify({ taskId: id, title })
    },
  })
}

export function listTasksTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'list_tasks',
    description: 'List all open tasks for the current character.',
    execute: async (_args: unknown): Promise<string> => {
      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.characterId, characterId),
            eq(tasks.userId, userId),
            eq(tasks.status, 'open')
          )
        )
        .orderBy(tasks.createdAt)
      return JSON.stringify(rows)
    },
  })
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd cloud-agent && npm test 2>&1 | tail -20
```

Expected:
```
▶ createTaskTool: name is create_task
  ✔ createTaskTool: name is create_task
▶ createTaskTool: schema does not expose userId or characterId
  ✔ createTaskTool: schema does not expose userId or characterId
...
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/tasks.ts cloud-agent/src/tools/tasks.test.ts
git commit -m "feat(cloud-agent): add create_task and list_tasks ADK tools with closure security"
```

---

## Task 6: Wiki tools (TDD)

**Files:**
- Create: `cloud-agent/src/tools/wiki.ts`
- Create: `cloud-agent/src/tools/wiki.test.ts`

`wiki_read` searches `llm_wiki_events` by `entityId` (= characterId) and text match. `wiki_write` inserts an observation. Note: `llm_wiki_events` uses `entityId` (the Drizzle column name) to reference `characters.id`.

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/tools/wiki.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_table: unknown) => ({
      values: async (row: InsertedRow) => { inserted.push(row) },
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: unknown) => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const { wikiReadTool, wikiWriteTool } = await import('./wiki.js')

test('wikiReadTool: name is wiki_read', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'char-1')
  assert.equal(tool.name, 'wiki_read')
})

test('wikiReadTool: schema does not expose characterId', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('query' in props)
})

test('wikiReadTool: returns formatted context string when results found', async () => {
  const rows = [
    { summary: 'User likes cats' },
    { summary: 'User is vegetarian' },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = wikiReadTool(db, 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ query: 'food' })
  assert.ok(result.includes('User likes cats'))
  assert.ok(result.includes('User is vegetarian'))
})

test('wikiReadTool: returns empty string when no results', async () => {
  const db = makeMockDb([])
  const tool = wikiReadTool(db, 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ query: 'nothing' })
  assert.equal(result, '')
})

test('wikiWriteTool: name is wiki_write', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_write')
})

test('wikiWriteTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('summary' in props)
})

test('wikiWriteTool: inserts observation with closure values', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-99', 'char-42')
  await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ summary: 'User prefers morning meetings' })

  const row = (db as unknown as { _inserted: InsertedRow[] })._inserted[0]
  assert.ok(row, 'expected one inserted row')
  assert.equal(row['entityId'], 'char-42')
  assert.equal(row['userId'], 'user-99')
  assert.equal(row['eventType'], 'observation')
  assert.equal(row['summary'], 'User prefers morning meetings')
  assert.ok(typeof row['createdAt'] === 'number')
})

test('wikiWriteTool: returns success string', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ summary: 'User is left-handed' })
  assert.equal(result, 'Observation recorded successfully.')
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error" | head -5
```

Expected: `Cannot find module './wiki.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud-agent/src/tools/wiki.ts`:

```typescript
import { FunctionTool } from '@google/adk'
import { eq, and, ilike } from 'drizzle-orm'
import { llmWikiEvents } from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

export function wikiReadTool(db: DrizzleClient, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_read',
    description: 'Search long-term memory for facts relevant to the given query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The topic or keywords to search for in memory.' },
      },
      required: ['query'],
    },
    execute: async (args: unknown): Promise<string> => {
      const { query } = args as { query: string }
      const rows = await db
        .select({ summary: llmWikiEvents.summary })
        .from(llmWikiEvents)
        .where(
          and(
            eq(llmWikiEvents.entityId, characterId),
            ilike(llmWikiEvents.summary, `%${query}%`)
          )
        )
        .limit(5)
      if (rows.length === 0) return ''
      return rows.map((r) => `- ${r.summary}`).join('\n')
    },
  })
}

export function wikiWriteTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_write',
    description: 'Record a new observation about the user into long-term memory.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'The observation to record about the user.' },
      },
      required: ['summary'],
    },
    execute: async (args: unknown): Promise<string> => {
      try {
        const { summary } = args as { summary: string }
        if (!summary?.trim()) return 'Failed to record observation: summary is required.'
        await db.insert(llmWikiEvents).values({
          id: crypto.randomUUID(),
          entityId: characterId,
          userId,
          eventType: 'observation',
          summary: summary.trim(),
          createdAt: Date.now(),
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

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd cloud-agent && npm test 2>&1 | tail -20
```

Expected:
```
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

(8 new wiki tests pass alongside the 7 task tests from Task 5 and 1 from any prior suite.)

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/wiki.ts cloud-agent/src/tools/wiki.test.ts
git commit -m "feat(cloud-agent): add wiki_read and wiki_write ADK tools with closure security"
```

---

## Task 7: Agent factory (TDD)

**Files:**
- Create: `cloud-agent/src/agent.ts`
- Create: `cloud-agent/src/agent.test.ts`

`buildAgent` wires `LlmAgent` with the four tools. Tests verify tool registration and instruction without invoking the model.

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/agent.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const mockDb = {} as unknown as DrizzleClient

const { buildAgent } = await import('./agent.js')

test('buildAgent: returns LlmAgent with 4 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  assert.equal(agent.tools.length, 4)
})

test('buildAgent: registers all required tool names', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  const names = agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('create_task'), 'missing create_task')
  assert.ok(names.includes('list_tasks'), 'missing list_tasks')
  assert.ok(names.includes('wiki_read'), 'missing wiki_read')
  assert.ok(names.includes('wiki_write'), 'missing wiki_write')
})

test('buildAgent: sets instruction from parameter', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Bob, a chef.')
  assert.equal(agent.instruction, 'You are Bob, a chef.')
})

test('buildAgent: model is gemini-2.0-flash', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  assert.equal(agent.model, 'gemini-2.0-flash')
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error" | head -5
```

Expected: `Cannot find module './agent.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud-agent/src/agent.ts`:

```typescript
import { LlmAgent } from '@google/adk'
import { createTaskTool, listTasksTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import type { DrizzleClient } from './db/client.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.0-flash',
    instruction: systemInstruction,
    tools: [
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      wikiReadTool(db, characterId),
      wikiWriteTool(db, userId, characterId),
    ],
  })
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd cloud-agent && npm test 2>&1 | tail -10
```

Expected:
```
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/agent.ts cloud-agent/src/agent.test.ts
git commit -m "feat(cloud-agent): add buildAgent factory with injected LlmAgent and four tools"
```

---

## Task 8: Express server (TDD)

**Files:**
- Create: `cloud-agent/src/index.ts`
- Create: `cloud-agent/src/index.test.ts`

`createApp` is exported for testing. It accepts `verifyToken` and `runAgentFn` via an options object so tests avoid touching ADK or Cloud SQL at all. The real entry point calls `createApp` with the production implementations and calls `app.listen`.

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/index.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import type { DrizzleClient } from './db/client.js'
import type { RunAgentParams } from './index.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_t: unknown) => ({ values: async (row: InsertedRow) => { inserted.push(row) } }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          // Thenable + chainable so both patterns work:
          // 1. await db.select().from(t).where(c)  — character lookup
          // 2. await db.select().from(t).where(c).limit(5)  — wiki context
          const p = Promise.resolve(queryRows)
          return Object.assign(p, {
            limit: (_n: unknown) => Promise.resolve(queryRows),
            orderBy: (_ord: unknown) => Promise.resolve(queryRows),
          })
        },
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const mockCharacter = {
  id: 'char-1', userId: 'user-1', name: 'Alice',
  appearance: null, traits: null, emotions: null, context: null,
  createdAt: new Date(), updatedAt: new Date(),
}

const mockVerify = async (token: string): Promise<{ uid: string }> => {
  if (token === 'valid-token') return { uid: 'user-1' }
  throw new Error('invalid')
}

const mockRunAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => ({
  reply: 'Hello from mock agent',
  toolCalls: [],
})

const { createApp } = await import('./index.js')

// ── /health ──────────────────────────────────────────────────────────────────

test('GET /health returns 200 without auth', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

// ── Auth middleware ───────────────────────────────────────────────────────────

test('POST /agent/run returns 401 with no Authorization header', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).post('/agent/run').send({ message: 'hi', characterId: 'char-1' })
  assert.equal(res.status, 401)
  assert.equal((res.body as { error: string }).error, 'Unauthorized')
})

test('POST /agent/run returns 401 with invalid token', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer bad-token')
    .send({ message: 'hi', characterId: 'char-1' })
  assert.equal(res.status, 401)
})

// ── /agent/run ────────────────────────────────────────────────────────────────

test('POST /agent/run passes uid from token to runAgentFn', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  let capturedUserId = ''
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async (params) => { capturedUserId = params.userId; return { reply: 'ok', toolCalls: [] } },
  })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(capturedUserId, 'user-1')
})

test('POST /agent/run returns reply from runAgentFn', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(res.status, 200)
  assert.equal((res.body as { reply: string }).reply, 'Hello from mock agent')
})

test('POST /agent/run returns 404 when character not found', async () => {
  const db = makeMockDb([])  // empty: character lookup returns nothing
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-missing' })
  assert.equal(res.status, 404)
})

test('POST /agent/run bulk-inserts unsyncedHistory tasks', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({
      message: 'hello',
      characterId: 'char-1',
      unsyncedHistory: [
        { type: 'task', id: 'task-1', title: 'Buy milk', status: 'open', createdAt: 1700000000 },
      ],
    })
  const inserted = (db as unknown as { _inserted: InsertedRow[] })._inserted
  const taskRow = inserted.find((r) => r['title'] === 'Buy milk')
  assert.ok(taskRow, 'expected task row to be inserted')
  assert.equal(taskRow!['userId'], 'user-1')
  assert.equal(taskRow!['characterId'], 'char-1')
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error" | head -5
```

Expected: `Cannot find module './index.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud-agent/src/index.ts`:

```typescript
import express, { Request, Response, NextFunction } from 'express'
import admin from 'firebase-admin'
import { eq, and, ilike } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse } from '@google/adk'
import type { Content } from '@google/genai'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { characters, llmWikiEvents, tasks } from './db/schema.js'
import type { DrizzleClient } from './db/client.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
}

interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[] }>
}

type UnsyncedTask = { type: 'task'; id: string; title: string; status: string; createdAt: number }
type UnsyncedWikiEvent = { type: 'wiki_event'; id: string; eventType: string; summary: string; createdAt: number }
type UnsyncedItem = UnsyncedTask | UnsyncedWikiEvent

// ── Helpers ───────────────────────────────────────────────────────────────────

async function bulkInsertUnsynced(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  items: unknown[],
): Promise<void> {
  for (const raw of items) {
    const item = raw as UnsyncedItem
    if (item.type === 'task') {
      await db.insert(tasks).values({
        id: item.id,
        characterId,
        userId,
        title: item.title,
        status: item.status ?? 'open',
        createdAt: new Date(item.createdAt * 1000),
        updatedAt: new Date(),
      })
    } else if (item.type === 'wiki_event') {
      await db.insert(llmWikiEvents).values({
        id: item.id,
        entityId: characterId,
        userId,
        eventType: item.eventType ?? 'observation',
        summary: item.summary,
        createdAt: item.createdAt,
      })
    }
  }
}

async function queryWikiContext(db: DrizzleClient, query: string, characterId: string): Promise<string> {
  const rows = await db
    .select({ summary: llmWikiEvents.summary })
    .from(llmWikiEvents)
    .where(and(eq(llmWikiEvents.entityId, characterId), ilike(llmWikiEvents.summary, `%${query}%`)))
    .limit(5)
  if (rows.length === 0) return ''
  return rows.map((r) => `- ${r.summary}`).join('\n')
}

function assembleSystemInstruction(
  character: { name: string; appearance: string | null; traits: string | null; emotions: string | null; context: string | null },
  wikiContext: string,
): string {
  return [
    `You are ${character.name}.`,
    character.appearance && `Appearance: ${character.appearance}`,
    character.traits && `Traits: ${character.traits}`,
    character.emotions && `Emotions: ${character.emotions}`,
    character.context && `Context: ${character.context}`,
    wikiContext && `\nKnown facts about the user:\n${wikiContext}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ── Real agent runner (production) ────────────────────────────────────────────

async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
  const { db, userId, characterId, systemInstruction, message, history } = params
  const agent = buildAgent(db, userId, characterId, systemInstruction)
  const runner = new InMemoryRunner({ agent, appName: 'clanker-cloud-agent' })

  const events = runner.runAsync({
    userId,
    sessionId: crypto.randomUUID(),
    newMessage: { role: 'user', parts: [{ text: message }] },
  })

  let reply = ''
  const toolCalls: string[] = []
  for await (const event of events) {
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if ('functionCall' in part) {
          const fc = (part as { functionCall?: { name?: string } }).functionCall
          if (fc?.name) toolCalls.push(fc.name)
        }
      }
    }
    if (isFinalResponse(event) && event.content?.parts) {
      reply = event.content.parts
        .filter((p) => 'text' in p)
        .map((p) => (p as { text: string }).text)
        .join('')
    }
  }
  return { reply, toolCalls }
}

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(options: AppOptions) {
  const { verifyToken, db, runAgentFn } = options
  const app = express()
  app.use(express.json())

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  const requireAuth = async (
    req: Request & { uid?: string },
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = req.headers.authorization?.split('Bearer ')[1]
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      const decoded = await verifyToken(token)
      req.uid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  app.post('/agent/run', requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    const { message, characterId, history = [], unsyncedHistory = [] } = req.body as {
      message: string
      characterId: string
      history?: Content[]
      unsyncedHistory?: unknown[]
    }
    const userId = req.uid!

    if (unsyncedHistory.length > 0) {
      await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory)
    }

    const [character] = await db.select().from(characters).where(eq(characters.id, characterId))
    if (!character) { res.status(404).json({ error: 'Character not found' }); return }

    const wikiContext = await queryWikiContext(db, message, characterId)
    const systemInstruction = assembleSystemInstruction(character, wikiContext)

    const result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
    res.json(result)
  })

  return app
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  if (!admin.apps.length) admin.initializeApp()

  const db = await getDb()
  const app = createApp({
    verifyToken: (token) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })),
    db,
    runAgentFn: runAgentReal,
  })

  const port = process.env.PORT ?? '8080'
  app.listen(Number(port), () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd cloud-agent && npm test 2>&1 | tail -15
```

Expected:
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

- [ ] **Step 5: Verify full typecheck**

```bash
cd cloud-agent && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Verify Docker build succeeds**

```bash
cd cloud-agent && docker build -t clanker-cloud-agent:local .
```

Expected: `Successfully built ...` with no errors referencing `../functions/`.

- [ ] **Step 7: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "feat(cloud-agent): add express server with firebase auth middleware and agent run endpoint"
```

---

## Self-Review Checklist

After all tasks are complete, verify:

- [ ] `GET /health` returns `200 { status: 'ok' }` with no auth header
- [ ] `POST /agent/run` with no Bearer token returns `401`
- [ ] `POST /agent/run` with invalid token returns `401`
- [ ] `create_task` and `list_tasks` tool schemas contain no `userId` or `characterId` field
- [ ] `wiki_write` and `wiki_read` tool schemas contain no `userId` or `characterId` field
- [ ] `npm run typecheck` passes in both `functions/` and `cloud-agent/`
- [ ] `docker build` from `cloud-agent/` succeeds with no `../functions/` path references
- [ ] `npm test` passes with 0 failures in `cloud-agent/`
