# Spec: LLM Wiki Memory — Agent-Robust

Task: https://github.com/equationalapplications/clanker/tasks/2276fbea-8868-40e5-aa22-7622de90f632
Date: 2026-04-24
Status: Draft
Branch: staging

## Problem

Current memory = `context TEXT` blob on `characters` table (local SQLite [src/database/schema.ts](src/database/schema.ts#L47), Cloud SQL [functions/src/db/schema.ts](functions/src/db/schema.ts#L54)). Refreshed every 20 msgs by `triggerConversationSummary` ([src/services/aiChatService.ts](src/services/aiChatService.ts#L161)) → `summarizeText` callable. Cap `SUMMARY_MAX_CHARACTERS = 4000` ([src/services/aiChatService.ts](src/services/aiChatService.ts#L54)).

Fine for chatbot. Fail for agent loop:

- No lookup single fact without re-read whole blob
- No atomic update one fact without rewrite blob
- No track "when last check goal?" / "what promise?"
- No split stable fact vs volatile state (plans, pending tasks)

Agent need memory it can **read, write, update, delete** mid-run.

## Goals

- Structured memory, query <50ms, no LLM at read time
- Split stable facts / volatile tasks / episodic events
- Agent can patch mid-turn as tool call
- Librarian pass async post-turn, never block reply (mirror `triggerConversationSummary` fire-and-forget)
- Local SQLite + FTS5 first; Cloud SQL mirror gated on `save_to_cloud=1` (match existing sync model)
- Reuse existing `onCall` + handler-split-for-test pattern. No new infra.

## Non-Goals

- Vector / embedding search (FTS5 enough for v1)
- Cross-character memory share
- Realtime cross-device push (piggyback existing character cloud sync)
- Replace `context` blob in v1 — coexist, deprecate later

## Schema (v9 migration)

Current `SCHEMA_VERSION = 8` ([src/database/schema.ts](src/database/schema.ts#L1)). Bump → `9`. Add SQL strings to `MIGRATIONS` map ([src/database/schema.ts](src/database/schema.ts#L95-L102)) keyed `9`. Idempotent guards via `IF NOT EXISTS`. Apply via existing `applyMigrations()` ([src/database/index.ts](src/database/index.ts#L216-L234)).

Mirror in Cloud SQL Drizzle schema ([functions/src/db/schema.ts](functions/src/db/schema.ts)) — uuid PKs, FK to `characters.id` / `users.id`. PostgreSQL → use `tsvector` + GIN index instead of FTS5 (not available in PG). Tables only mirrored when host character has `save_to_cloud=1`.

### `wiki_entries` — long-term facts (stable)

Local SQLite columns:

```
id            TEXT PRIMARY KEY                   -- entry_<ts>_<rand>
character_id  TEXT NOT NULL
user_id       TEXT NOT NULL
title         TEXT NOT NULL
body          TEXT NOT NULL
tags          TEXT NOT NULL DEFAULT '[]'         -- JSON array
confidence    TEXT NOT NULL DEFAULT 'inferred'   -- 'certain'|'inferred'|'tentative'
source_type   TEXT NOT NULL DEFAULT 'agent_inferred'  -- 'user_stated'|'agent_inferred'|'user_confirmed'
created_at    INTEGER NOT NULL
updated_at    INTEGER NOT NULL
last_accessed_at INTEGER
access_count  INTEGER NOT NULL DEFAULT 0
synced_to_cloud INTEGER NOT NULL DEFAULT 0       -- match character sync flag pattern
cloud_id      TEXT
deleted_at    INTEGER                            -- soft delete, match existing pattern
```

Indexes: `(character_id, user_id)`, `(updated_at DESC)`.

FTS5 virtual table `wiki_fts` on `(title, body, tags)`, content-linked to `wiki_entries`. Triggers on insert/update/delete keep in sync (standard FTS5 pattern).

### `agent_tasks` — volatile goals / pending actions

```
id            TEXT PRIMARY KEY
character_id  TEXT NOT NULL
user_id       TEXT NOT NULL
description   TEXT NOT NULL
status        TEXT NOT NULL DEFAULT 'pending'    -- 'pending'|'in_progress'|'done'|'abandoned'
priority      INTEGER NOT NULL DEFAULT 0
due_context   TEXT                               -- e.g. "next conversation"
created_at    INTEGER NOT NULL
updated_at    INTEGER NOT NULL
resolved_at   INTEGER
resolution_note TEXT
synced_to_cloud INTEGER NOT NULL DEFAULT 0
cloud_id      TEXT
```

Indexes: `(character_id, user_id, status)`, `(priority DESC)`.

### `memory_events` — episodic log (append-only)

```
id            TEXT PRIMARY KEY
character_id  TEXT NOT NULL
user_id       TEXT NOT NULL
event_type    TEXT NOT NULL                      -- 'observation'|'decision'|'action'|'outcome'
summary       TEXT NOT NULL
related_entry_id TEXT                            -- FK wiki_entries.id, nullable
related_task_id  TEXT                            -- FK agent_tasks.id, nullable
created_at    INTEGER NOT NULL
synced_to_cloud INTEGER NOT NULL DEFAULT 0
cloud_id      TEXT
```

Index: `(character_id, user_id, created_at DESC)`.

Append-only at API level (no update/delete in `memoryPatch`). Pruning: when row count > N (default 200) per character, oldest M (default 50) compressed → librarian summarizes into a `wiki_entries` row, then deletes events. Pruning runs inside `memoryWrite` librarian pass, not on hot read path.

### Data access layer

New files matching existing pattern ([src/database/characterDatabase.ts](src/database/characterDatabase.ts), [src/database/messageDatabase.ts](src/database/messageDatabase.ts)):

- `src/database/wikiDatabase.ts` — raw SQL via `expo-sqlite`, exports `LocalWikiEntry` interface, CRUD + FTS5 query
- `src/database/agentTaskDatabase.ts`
- `src/database/memoryEventDatabase.ts`

## Firebase Callables (agent tool API)

All match existing template: `onCall({ region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] }, (req) => handler(req, deps))`. Handler exported separately for tests (pattern from [functions/src/generateReply.ts](functions/src/generateReply.ts#L298), [functions/src/characterFunctions.ts](functions/src/characterFunctions.ts#L117)).

Auth check ([functions/src/generateReply.ts](functions/src/generateReply.ts#L311-L320) pattern):

```ts
if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
const decoded = request.auth.token as DecodedIdToken;
if (!decoded || decoded.uid !== request.auth.uid)
  throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
```

Export from [functions/src/index.ts](functions/src/index.ts) alongside existing callables.

### `memoryRead` — fast retrieval, pre-turn

- In: `{ characterId: string, query: string, limit?: number }` (userId derived from `request.auth.uid`)
- Server: PG `tsvector` MATCH over `wiki_entries` (when cloud-synced); client falls back to local FTS5 directly when offline / not cloud-synced; + all `agent_tasks` where `status='pending'` ordered by `priority DESC`; + last N `memory_events` (default 5)
- Out: `{ facts: WikiEntry[], openTasks: AgentTask[], recentEvents: MemoryEvent[] }`
- No LLM. Side-effect: bump `access_count`, set `last_accessed_at` on returned facts.
- Target <50ms p95 (local) / <200ms p95 (cloud).

### `memoryWrite` — librarian pass, post-turn

- In: `{ characterId: string, conversationChunk: string }`
- Server: LLM extract facts → fuzzy title match merge (avoid dup) → upsert `wiki_entries` → create/update/close `agent_tasks` → append `memory_events` → run prune if event count threshold
- Out: `{ diff: { entriesAdded, entriesUpdated, tasksOpened, tasksClosed, eventsAppended } }`
- Reuses LLM infra from `summarizeText` ([functions/src/summarizeText.ts](functions/src/summarizeText.ts))

### `memoryPatch` — direct agent write mid-turn

- In: `{ characterId: string, operation: 'upsert_entry'|'delete_entry'|'task_create'|'task_update', payload: object }`
- Agent tool-call when explicit commit / close task mid-turn
- Rate limit: max 10 calls per agent turn (track via in-memory map keyed by `auth.uid + turn_id`, or fold into existing usage gating in [functions/src/services/](functions/src/services/))

### `memoryForget` — user-initiated delete

- In: `{ characterId: string, entryId?: string, taskId?: string, clearAll?: boolean }`
- Soft delete (`deleted_at`) on entries/tasks. Preserves `memory_events` for audit.
- `clearAll`: soft-delete all entries+tasks for character.

## Client Service

New `src/services/memoryService.ts` matching [src/services/chatReplyService.ts](src/services/chatReplyService.ts) pattern:

```ts
const memoryReadFn = httpsCallable(functionsInstance, 'memoryRead')
// await appCheckReady before calling, same as chatReplyService L32
export async function fetchMemoryBundle(characterId: string, query: string): Promise<MemoryBundle>
export async function triggerMemoryWrite(character: Character, userId: string, chunk: string): Promise<void>
export async function patchMemory(characterId: string, op: PatchOp): Promise<void>
export async function forgetMemory(characterId: string, target: ForgetTarget): Promise<void>
```

`triggerMemoryWrite` mirrors `triggerConversationSummary` ([src/services/aiChatService.ts](src/services/aiChatService.ts#L161)) — fire-and-forget, deduped via `Set<string>` keyed `${characterId}:${userId}` (same pattern as `activeSummaryJobs` [src/services/aiChatService.ts](src/services/aiChatService.ts#L56)).

Offline / not cloud-synced fallback: read directly from local SQLite via `wikiDatabase.ts` instead of callable. Decision rule: if `character.save_to_cloud === 1 && synced_to_cloud === 1` → callable; else local.

## Wire-up: `aiChatService.sendMessageWithAIResponse`

Modify [src/services/aiChatService.ts](src/services/aiChatService.ts) (after message save, ~line 335 region):

1. **Pre-turn**: `const bundle = await fetchMemoryBundle(character.id, userMessage)` — fail-soft (return empty bundle on error, never block reply)
2. **Compose prompt**: extend `buildChatPrompt` ([src/services/aiChatService.ts](src/services/aiChatService.ts)) to accept optional `memoryBundle`; render structured block (see Context Injection) before user msg
3. **Reply**: existing `generateChatReply` flow unchanged
4. **Post-turn**: alongside existing `triggerConversationSummary(character, userId)`, also call `triggerMemoryWrite(character, userId, recentChunk)` — both fire-and-forget

`generateReply` callable signature ([functions/src/generateReply.ts](functions/src/generateReply.ts)) unchanged in v1 — bundle composed client-side into the `prompt` field. v2 may move composition server-side.

## Context Injection Format

Block prepended to `prompt` field passed to `generateReply`:

```
[MEMORY]
Facts: (top 5-10 FTS5 results, scored recency + access_count)
  - [certain] User prefers morning workouts | tags: health, schedule
  - [inferred] User preparing for marathon in October | tags: health, goals
  - [tentative] User's partner named Jamie | tags: relationships

Open tasks: (pending agent_tasks ordered by priority)
  - [high] Ask how job interview went (set 2 days ago)
  - [low] Follow up on book recommendation next week

Recent episodic context: (last 3 memory_events)
  - [observation] User mentioned stress about deadline
  - [action] Suggested 3-step prioritization technique
  - [outcome] User said it helped
[/MEMORY]
```

Deterministic. No LLM at read. Cheap.

## Confidence + Conflict Resolution (librarian policy)

Implemented inside `memoryWrite` handler:

- **Same title, body differs** → update body, downgrade `confidence='inferred'`, append old → `memory_events` as `'observation'`
- **Contradictory fact** → mark old `confidence='tentative'`, create new at `'inferred'`, next user confirm resolves
- **User-stated fact** ("I told you, I hate cilantro") → always overwrite agent-inferred. Set `source_type='user_stated'`, `confidence='certain'`

Detection: librarian LLM prompted to label each extracted fact with `source_type` based on conversation turn ownership.

## Cloud Sync

Match existing `syncCharacter` model ([functions/src/characterFunctions.ts](functions/src/characterFunctions.ts#L117)):

- Wiki rows inherit parent character's `save_to_cloud`. If 0 → local only, all callables fall back to local.
- New callable `syncMemory({ characterId })` uploads pending rows (`synced_to_cloud=0`) to Cloud SQL, sets `cloud_id` + `synced_to_cloud=1`. Or fold into existing `syncCharacter` payload.
- Soft-deleted rows (`deleted_at != NULL`) sync as tombstones.

## Files Touched

**New**:
- [src/database/wikiDatabase.ts](src/database/wikiDatabase.ts)
- [src/database/agentTaskDatabase.ts](src/database/agentTaskDatabase.ts)
- [src/database/memoryEventDatabase.ts](src/database/memoryEventDatabase.ts)
- [src/services/memoryService.ts](src/services/memoryService.ts)
- [functions/src/memoryFunctions.ts](functions/src/memoryFunctions.ts) (or split per callable)
- `__tests__/memoryService.test.ts`, `__tests__/wikiDatabase.test.ts`
- `functions/src/memoryFunctions.test.ts`

**Modified**:
- [src/database/schema.ts](src/database/schema.ts) — bump `SCHEMA_VERSION` → 9, add `MIGRATIONS[9]`, add `CREATE_TABLES` entries
- [functions/src/db/schema.ts](functions/src/db/schema.ts) — add Drizzle tables for cloud mirror
- [src/services/aiChatService.ts](src/services/aiChatService.ts) — call `fetchMemoryBundle` + `triggerMemoryWrite` in `sendMessageWithAIResponse`; extend `buildChatPrompt`
- [src/config/firebaseConfig.ts](src/config/firebaseConfig.ts) — register 4 new callables
- [functions/src/index.ts](functions/src/index.ts) — export 4 new callables

**Unchanged**: `generateReply`, `summarizeText`, existing `context` column (coexists).

## Tests

Match existing patterns:

- **Client unit** ([__tests__/voiceChatService.test.ts](__tests__/voiceChatService.test.ts) style): mock callables via `jest.mock('~/services/memoryService', ...)`; assert fire-and-forget dedup
- **DB unit**: open in-memory SQLite, run migrations 1→9, verify FTS5 query results, soft-delete behavior
- **Backend handler** ([functions/src/generateReply.test.ts](functions/src/generateReply.test.ts) / [functions/src/characterFunctions.test.ts](functions/src/characterFunctions.test.ts) style): build mock `deps`, call handler directly, mock auth via `buildAuth()` pattern
- Coverage targets: librarian merge dedup, conflict downgrade, user-stated overwrite, prune threshold trigger, fail-soft on `memoryRead` error

## Open Questions

- v9 migration: ship FTS5 triggers in same migration or feature-flag rollout?
- Librarian model + cost cap per user/day (reuse credit system from [functions/src/services/](functions/src/services/)?)
- Migration of existing `characters.context` blob → seed `wiki_entries` on first run? Or lazy: librarian opportunistically extracts on first `memoryWrite`?
- `memoryPatch` rate-limiting: in-memory map sufficient or need Cloud SQL counter?
- Cloud SQL FTS: `tsvector` + GIN, or pgvector later? v1 = `tsvector`.
- Deprecation timeline for `characters.context` once wiki proven?

## Acceptance Criteria

- [ ] `SCHEMA_VERSION=9`; migration creates 3 tables + FTS5 virtual table + triggers, idempotent on re-run
- [ ] Drizzle cloud schema mirrors 3 tables with FK constraints + `tsvector` index
- [ ] `memoryRead` returns structured bundle, no LLM call, p95 <50ms (local) / <200ms (cloud)
- [ ] `memoryWrite` runs post-turn, never blocks reply latency (verified via `triggerConversationSummary`-style dedup test)
- [ ] `memoryPatch` callable from agent tool loop with auth + rate-limit check
- [ ] `memoryForget` soft-deletes entries/tasks, preserves `memory_events`
- [ ] Conflict resolution policy enforced (3 cases tested)
- [ ] `aiChatService.sendMessageWithAIResponse` injects memory bundle into prompt; fail-soft on error
- [ ] Cloud sync respects `character.save_to_cloud` flag; offline path uses local SQLite
- [ ] All 4 callables follow `enforceAppCheck`, `CLOUD_SQL_SECRETS`, handler-split-for-test pattern
- [ ] `npm run typecheck && npm run lint && npm run test` green (root + functions/)
