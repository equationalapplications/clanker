# Spec: LLM Wiki Memory — Agent-Robust

Task: https://github.com/equationalapplications/clanker/tasks/2276fbea-8868-40e5-aa22-7622de90f632
Date: 2026-04-24
Status: Draft
Branch: staging

## Problem

Current memory = `context TEXT` blob on `characters` table (local SQLite [src/database/schema.ts](/src/database/schema.ts#L47), Cloud SQL [functions/src/db/schema.ts](/functions/src/db/schema.ts#L54)). Refreshed every 20 msgs by `triggerConversationSummary` ([src/services/aiChatService.ts](/src/services/aiChatService.ts#L161)) → `summarizeText` callable. Cap `SUMMARY_MAX_CHARACTERS = 4000` ([src/services/aiChatService.ts](/src/services/aiChatService.ts#L54)).

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

Current `SCHEMA_VERSION = 8` ([src/database/schema.ts](/src/database/schema.ts#L1)). Bump → `9`. Add SQL strings to `MIGRATIONS` map ([src/database/schema.ts](/src/database/schema.ts#L95-L102)) keyed `9`. Idempotent guards via `IF NOT EXISTS`. Apply via existing `applyMigrations()` ([src/database/index.ts](/src/database/index.ts#L216-L234)).

Mirror in Cloud SQL Drizzle schema ([functions/src/db/schema.ts](/functions/src/db/schema.ts)) — uuid PKs, FK to `characters.id` / `users.id`. PostgreSQL → use `tsvector` + GIN index instead of FTS5 (not available in PG). Tables only mirrored when host character has `save_to_cloud=1`.

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

### `derived_synonyms` — auto-grown query expansion vocabulary

Character-scoped synonym map populated by `memoryWrite` librarian pass from co-occurring tags on `wiki_entries`. Local SQLite columns:

```
term          TEXT NOT NULL
character_id  TEXT NOT NULL
synonyms      TEXT NOT NULL DEFAULT '[]'         -- JSON array of related terms
updated_at    INTEGER NOT NULL
PRIMARY KEY (term, character_id)
```

Index: `(character_id)`. No cloud mirror — derived data, regenerable from `wiki_entries`.

### `characters` table additions (v9 migration)

Add two columns to existing `characters` table (mirror `summary_checkpoint` pattern, [src/database/schema.ts](/src/database/schema.ts#L26)):

```
heal_checkpoint     INTEGER NOT NULL DEFAULT 0   -- message count at last memoryHeal
memory_checkpoint   INTEGER NOT NULL DEFAULT 0   -- message count at last memoryWrite
```

### Data access layer

New files matching existing pattern ([src/database/characterDatabase.ts](/src/database/characterDatabase.ts), [src/database/messageDatabase.ts](/src/database/messageDatabase.ts)):

- `src/database/wikiDatabase.ts` — raw SQL via `expo-sqlite`, exports `LocalWikiEntry` interface, CRUD + FTS5 query
- `src/database/agentTaskDatabase.ts`
- `src/database/memoryEventDatabase.ts`

## Firebase Callables (agent tool API)

All match existing template: `onCall({ region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] }, (req) => handler(req, deps))`. Handler exported separately for tests (pattern from [functions/src/generateReply.ts](/functions/src/generateReply.ts#L298), [functions/src/characterFunctions.ts](/functions/src/characterFunctions.ts#L117)).

Auth check ([functions/src/generateReply.ts](/functions/src/generateReply.ts#L311-L320) pattern):

```ts
if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
const decoded = request.auth.token as DecodedIdToken;
if (!decoded || decoded.uid !== request.auth.uid)
  throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
```

Export from [functions/src/index.ts](/functions/src/index.ts) alongside existing callables.

### `memoryRead` — fast retrieval, pre-turn

- In: `{ characterId: string, rawQuery: string, limit?: number }` (userId derived from `request.auth.uid`)
- Server (cloud path, premium only — see Query Preprocessing): PG `websearch_to_tsquery('english', rawQuery)` → MATCH against `tsvector` column on `wiki_entries`. Stemming + stop-words handled natively, no extra LLM. Plan check: `SUBSCRIPTION_TIERS.includes(decoded.planTier)` ([src/config/constants.ts](/src/config/constants.ts#L33)).
- Client (local path, all users): preprocesses `rawQuery` via `buildFtsQuery` (see Query Preprocessing) before calling `wikiDatabase.searchEntries`.
- Always returned: all `agent_tasks` where `status='pending'` ordered by `priority DESC`; + last N `memory_events` (default 5).
- Out: `{ facts: WikiEntry[], openTasks: AgentTask[], recentEvents: MemoryEvent[] }`
- No LLM at read time. Side-effect: bump `access_count`, set `last_accessed_at` on returned facts.
- Target <200ms p95 (local + compromise.js init amortized) / <300ms p95 (cloud).

### `memoryWrite` — librarian pass, post-turn

- In: `{ characterId: string, conversationChunk: string }`
- Server: LLM extract facts → fuzzy title match merge (avoid dup) → upsert `wiki_entries` → create/update/close `agent_tasks` → append `memory_events` → update `derived_synonyms` from co-occurring tags (see Derived Synonym Enrichment) → run prune if event count threshold → check heal trigger (see `memoryHeal`)
- Out: `{ diff: { entriesAdded, entriesUpdated, tasksOpened, tasksClosed, eventsAppended, synonymsUpdated } }`
- Reuses LLM infra from `summarizeText` ([functions/src/summarizeText.ts](/functions/src/summarizeText.ts))

### `memoryHeal` — full-wiki health check, periodic

- In: `{ characterId: string }`
- Trigger: `memoryWrite` fires this fire-and-forget when `messageCount - character.heal_checkpoint >= 20` (mirrors `SUMMARY_TRIGGER_MESSAGE_COUNT`, [src/services/aiChatService.ts](/src/services/aiChatService.ts#L52)). Before the heal starts, advance `heal_checkpoint` to the current `messageCount` as a scheduling checkpoint / retry-storm guard (same pattern as summary, [src/services/aiChatService.ts](/src/services/aiChatService.ts#L184)). This checkpoint is **not** rolled back if the heal later fails; failure is logged/appended as an operational event, and the next full heal becomes eligible only after another 20 messages.
- Server: LLM receives full wiki dump (entries + open tasks + recent events) → returns structured diff:
  - **Contradictions**: pairs of entries with conflicting bodies → downgrade older to `confidence='tentative'`, append `memory_events` of type `'observation'` flagging conflict
  - **Stale claims**: entries with `last_accessed_at` > 60 days AND no related recent events → downgrade `confidence='inferred' → 'tentative'`
  - **Orphan pages**: entries with `access_count=0` AND age > 30 days → soft-delete (`deleted_at` set)
  - **Missing concepts**: gaps inferred from open tasks lacking related entries → seed new `wiki_entries` with `confidence='tentative'`
- Out: `{ diff: { contradictionsFlagged, staleDowngraded, orphansRemoved, conceptsSeeded } }`
- Premium monthly users (`SUBSCRIPTION_TIERS`): runs in cloud against full Cloud SQL wiki. Free / non-premium users: `memoryHeal` is a no-op (returns empty diff). Local-only users get health from `memoryWrite` per-turn fixes; full heal is a paid feature.

### `memoryPatch` — direct agent write mid-turn

- In: `{ characterId: string, operation: 'upsert_entry'|'delete_entry'|'task_create'|'task_update', payload: object }`
- Agent tool-call when explicit commit / close task mid-turn
- Rate limit: max 10 calls per agent turn (track via in-memory map keyed by `auth.uid + turn_id`, or fold into existing usage gating in [functions/src/services/](/functions/src/services/))

### `memoryForget` — user-initiated delete

- In: `{ characterId: string, entryId?: string, taskId?: string, clearAll?: boolean }`
- Soft delete (`deleted_at`) on entries/tasks. Preserves `memory_events` for audit.
- `clearAll`: soft-delete all entries+tasks for character.

## Client Service

New `src/services/memoryService.ts` matching [src/services/chatReplyService.ts](/src/services/chatReplyService.ts) pattern:

```ts
const memoryReadFn = httpsCallable(functionsInstance, 'memoryRead')
// await appCheckReady before calling, same as chatReplyService L32
export async function fetchMemoryBundle(characterId: string, query: string): Promise<MemoryBundle>
export async function triggerMemoryWrite(character: Character, userId: string, chunk: string): Promise<void>
export async function patchMemory(characterId: string, op: PatchOp): Promise<void>
export async function forgetMemory(characterId: string, target: ForgetTarget): Promise<void>
```

`triggerMemoryWrite` mirrors `triggerConversationSummary` ([src/services/aiChatService.ts](/src/services/aiChatService.ts#L161)) — fire-and-forget, deduped via `Set<string>` keyed `${characterId}:${userId}` (same pattern as `activeSummaryJobs` [src/services/aiChatService.ts](/src/services/aiChatService.ts#L56)).

Offline / not cloud-synced fallback: read directly from local SQLite via `wikiDatabase.ts` instead of callable. Decision rule: if `character.save_to_cloud === 1 && synced_to_cloud === 1` → callable; else local.

## Wire-up: `aiChatService.sendMessageWithAIResponse`

Modify [src/services/aiChatService.ts](/src/services/aiChatService.ts) (after message save, ~line 335 region):

1. **Pre-turn**: `const bundle = await fetchMemoryBundle(character.id, userMessage)` — fail-soft (return empty bundle on error, never block reply)
2. **Compose prompt**: extend `buildChatPrompt` ([src/services/aiChatService.ts](/src/services/aiChatService.ts)) to accept optional `memoryBundle`; render structured block (see Context Injection) before user msg
3. **Reply**: existing `generateChatReply` flow unchanged
4. **Post-turn**: alongside existing `triggerConversationSummary(character, userId)`, send `WRITE` event to `wikiHealMachine` (see State Machine) — orchestrates `memoryWrite` then conditional `memoryHeal`, all fire-and-forget

`generateReply` callable signature ([functions/src/generateReply.ts](/functions/src/generateReply.ts)) unchanged in v1 — bundle composed client-side into the `prompt` field. v2 may move composition server-side.

## Query Preprocessing Pipeline

FTS5 `MATCH` chokes on raw user messages (punctuation, bare boolean operators, parse errors). Local path needs deterministic preprocessing. Cloud path (premium only) uses PostgreSQL's native `websearch_to_tsquery` instead.

### Local pipeline — `src/database/ftsQueryBuilder.ts` (new file)

Pure function `buildFtsQuery(rawMessage: string, characterId: string): string | null`. Three layers, each cheap:

**Layer 1 — Sanitize** (~0ms):
- lowercase → strip non-alphanumeric (keep whitespace) → split → drop tokens `len < 3` → drop ~60-word English stopword Set → slice top 15

**Layer 2 — Synonym expand** (~0ms):
- Static base map (`src/database/synonymMapBase.ts`): ~150 hand-curated entries across health, relationships, work, emotions, goals domains. Pre-seeded for day-1 recall before any wiki entries exist.
- Derived map: read `derived_synonyms` rows for `characterId`, merge with base. Cached at module level, invalidated on `memoryWrite` completion.
- Each surviving Layer 1 token expanded with synonyms; full list deduped after expand.

**Layer 3 — `compromise.js` NLP** (~30-60ms, lazy init):
- `import nlp from 'compromise'` — lazy-loaded on first call, module-level cached instance.
- Run on **original** message (compromise needs sentence structure, not sanitized tokens).
- Extract: `.nouns().toSingular().out('array')`, `.verbs().toInfinitive().out('array')`, `.adjectives().out('array')`.
- Lemmatized forms ("running" → "run", "marriages" → "marriage") added to token list, deduped against Layer 1+2.

**Merge → FTS5 query**:
- Final dedup, slice top 20.
- Each token wrapped: `"token"*` (quoted prefix-match, escape-safe).
- Join with ` OR `.
- Empty result → return `null` → caller skips FTS5, returns recency-only bundle (most-recently-accessed entries via `last_accessed_at DESC`).

Works identically on iOS, Android, Web (compromise.js is pure JS, no native module).

### Cloud pipeline — premium monthly users

Server-side `memoryRead` skips client preprocessing entirely. Passes raw user message to `websearch_to_tsquery('english', rawQuery)` against the `tsvector` column. PostgreSQL handles stemming, stop-words, and morphological analysis natively. No `compromise.js` server-side. No extra LLM cost.

Plan gate: `decoded.planTier && SUBSCRIPTION_TIERS.includes(decoded.planTier)` ([src/config/constants.ts](/src/config/constants.ts#L33)). Non-premium → server falls through to client-built FTS5 query path even when cloud-synced.

### Derived Synonym Enrichment

Runs inside `memoryWrite` librarian pass after wiki upsert, pure code (no LLM):

1. For each tag on newly upserted entries, query all `wiki_entries` sharing that tag.
2. Collect title terms (Layer 1 sanitize, no NLP).
3. Terms appearing in ≥2 entries with the same tag → grouped as synonyms.
4. Upsert into `derived_synonyms` (per-character scope).

Example: entries tagged `health` with titles "morning run", "jog before work", "skipped run again" → `derived_synonyms["run"] = ["jog"]`.

## State Machine: `wikiHealMachine`

New `src/machines/wikiHealMachine.ts`. Mirrors XState v5 pattern from existing machines ([src/machines/termsMachine.ts](/src/machines/termsMachine.ts), [src/machines/characterMachine.ts](/src/machines/characterMachine.ts)). Orchestrates the post-turn write+heal flow with fail-soft semantics throughout.

**States**:

```
idle
  → (WRITE event with { characterId, userId, chunk }) → checking

checking   [fromPromise: getMessageCount + load character.heal_checkpoint]
  → shouldHeal=true  → writing  (proceed, heal will follow)
  → shouldHeal=false → writing  (proceed, skip heal)

writing    [fromPromise: triggerMemoryWrite callable]
  → done + shouldHeal=true  → healing  (advance heal_checkpoint to messageCount before triggering)
  → done + shouldHeal=false → idle
  → error                    → idle  (fail-soft, log only)

healing    [fromPromise: triggerMemoryHeal callable; heal_checkpoint already advanced before start]
  → done  → idle
  → error → idle  (fail-soft; checkpoint not rolled back — next heal eligible after 20 more messages)
```

**Context**: `{ characterId, userId, chunk, messageCount, healCheckpoint, shouldHeal }`.

**Trigger condition** (in `checking` state guard): `messageCount - healCheckpoint >= 20` (constant `HEAL_TRIGGER_MESSAGE_COUNT = 20`, harmonized with `SUMMARY_TRIGGER_MESSAGE_COUNT`).

**Dedup**: machine instance per `(characterId, userId)` pair, stored in `Map`. Sending `WRITE` while machine is in non-`idle` state = no-op (matches `activeSummaryJobs` Set pattern, [src/services/aiChatService.ts](/src/services/aiChatService.ts#L56)).

**Premium check**: `healing` state actor inspects `subscription.planTier` via `useCurrentPlan` equivalent on the service side; non-premium → skip the callable, transition straight to `idle` while still advancing `heal_checkpoint` (so non-premium users don't accumulate phantom debt).

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

Match existing `syncCharacter` model ([functions/src/characterFunctions.ts](/functions/src/characterFunctions.ts#L117)):

- Wiki rows inherit parent character's `save_to_cloud`. If 0 → local only, all callables fall back to local.
- New callable `syncMemory({ characterId })` uploads pending rows (`synced_to_cloud=0`) to Cloud SQL, sets `cloud_id` + `synced_to_cloud=1`. Or fold into existing `syncCharacter` payload.
- Soft-deleted rows (`deleted_at != NULL`) sync as tombstones.

## Files Touched

**New**:
- [src/database/wikiDatabase.ts](/src/database/wikiDatabase.ts)
- [src/database/agentTaskDatabase.ts](/src/database/agentTaskDatabase.ts)
- [src/database/memoryEventDatabase.ts](/src/database/memoryEventDatabase.ts)
- [src/database/derivedSynonymDatabase.ts](/src/database/derivedSynonymDatabase.ts)
- [src/database/ftsQueryBuilder.ts](/src/database/ftsQueryBuilder.ts)
- [src/database/synonymMapBase.ts](/src/database/synonymMapBase.ts)
- [src/services/memoryService.ts](/src/services/memoryService.ts)
- [src/machines/wikiHealMachine.ts](/src/machines/wikiHealMachine.ts)
- [functions/src/memoryFunctions.ts](/functions/src/memoryFunctions.ts) (or split per callable: `memoryRead.ts`, `memoryWrite.ts`, `memoryPatch.ts`, `memoryForget.ts`, `memoryHeal.ts`)
- `__tests__/memoryService.test.ts`, `__tests__/wikiDatabase.test.ts`, `__tests__/ftsQueryBuilder.test.ts`, `__tests__/wikiHealMachine.test.ts`
- `functions/src/memoryFunctions.test.ts`

**Modified**:
- [src/database/schema.ts](/src/database/schema.ts) — bump `SCHEMA_VERSION` → 9, add `MIGRATIONS[9]` (3 wiki tables + FTS5 + triggers + `derived_synonyms` + `characters` ALTERs for `heal_checkpoint`/`memory_checkpoint`), add `CREATE_TABLES` entries
- [functions/src/db/schema.ts](/functions/src/db/schema.ts) — add Drizzle tables for cloud mirror with `tsvector` + GIN index
- [src/services/aiChatService.ts](/src/services/aiChatService.ts) — call `fetchMemoryBundle` in pre-turn; send `WRITE` event to `wikiHealMachine` instead of direct `triggerMemoryWrite`; extend `buildChatPrompt`
- [src/config/firebaseConfig.ts](/src/config/firebaseConfig.ts) — register 5 new callables
- [functions/src/index.ts](/functions/src/index.ts) — export 5 new callables
- `package.json` — add `compromise` dependency

**Unchanged**: `generateReply`, `summarizeText`, existing `context` column (coexists).

## Tests

Match existing patterns:

- **Client unit** ([__tests__/voiceChatService.test.ts](/__tests__/voiceChatService.test.ts) style): mock callables via `jest.mock('~/services/memoryService', ...)`; assert fire-and-forget dedup
- **DB unit**: open in-memory SQLite, run migrations 1→9, verify FTS5 query results, soft-delete behavior, `derived_synonyms` upsert from tag co-occurrence
- **Query builder** (`__tests__/ftsQueryBuilder.test.ts`): pure-function tests covering Layer 1 sanitize edge cases (punctuation-only, single-char, all-stopword input → null), Layer 2 base+derived synonym merge, Layer 3 compromise.js lemmatization, final FTS5 escaping
- **State machine** (`__tests__/wikiHealMachine.test.ts`, [__tests__/termsMachine.test.ts](/__tests__/termsMachine.test.ts) style): assert state transitions for shouldHeal=true/false, dedup on duplicate `WRITE` events, fail-soft on actor errors, premium gate skips `healing` state
- **Backend handler** ([functions/src/generateReply.test.ts](/functions/src/generateReply.test.ts) / [functions/src/characterFunctions.test.ts](/functions/src/characterFunctions.test.ts) style): build mock `deps`, call handler directly, mock auth via `buildAuth()` pattern; cover `memoryHeal` contradiction/stale/orphan/missing branches
- Coverage targets: librarian merge dedup, conflict downgrade, user-stated overwrite, prune threshold trigger, fail-soft on `memoryRead` error, heal trigger at 20-message delta, premium plan gate on cloud NLP path

## Open Questions

- v9 migration: ship FTS5 triggers in same migration or feature-flag rollout?
- Librarian model + cost cap per user/day (reuse credit system from [functions/src/services/](/functions/src/services/)?)
- Migration of existing `characters.context` blob → seed `wiki_entries` on first run? Or lazy: librarian opportunistically extracts on first `memoryWrite`?
- `memoryPatch` rate-limiting: in-memory map sufficient or need Cloud SQL counter?
- Deprecation timeline for `characters.context` once wiki proven?
- `compromise.js` bundle size impact on web (~230KB) — acceptable or lazy-load only when memory feature engages?
- `memoryHeal` cost ceiling: cap full-wiki dump size (e.g., truncate at 100 entries, oldest first) to bound LLM token spend per heal?

## Acceptance Criteria

- [ ] `SCHEMA_VERSION=9`; migration creates 3 wiki tables + FTS5 virtual table + triggers + `derived_synonyms` + `characters.heal_checkpoint`/`memory_checkpoint` columns, idempotent on re-run
- [ ] Drizzle cloud schema mirrors 3 wiki tables with FK constraints + `tsvector` column + GIN index
- [ ] `buildFtsQuery` handles edge cases: empty input → `null`, punctuation-only → `null`, all-stopwords → `null`, normal input → escape-safe `"tok"* OR "tok"*` form
- [ ] `compromise.js` lemmatization verified for inflected forms (running→run, marriages→marriage)
- [ ] `memoryRead` returns structured bundle, no LLM call; cloud path uses `websearch_to_tsquery` for premium tier only
- [ ] `memoryWrite` runs post-turn, never blocks reply latency (verified via `wikiHealMachine` dedup test)
- [ ] `memoryWrite` updates `derived_synonyms` from co-occurring tags
- [ ] `memoryHeal` fires when `messageCount - heal_checkpoint >= 20`; advances checkpoint before run (retry-storm guard); no-op for non-premium tier
- [ ] `memoryHeal` flags contradictions, downgrades stale claims, removes orphans, seeds missing concepts
- [ ] `memoryPatch` callable from agent tool loop with auth + rate-limit check
- [ ] `memoryForget` soft-deletes entries/tasks, preserves `memory_events`
- [ ] Conflict resolution policy enforced (3 cases tested)
- [ ] `wikiHealMachine` follows XState v5 pattern from existing machines; states transition idle→checking→writing→healing→idle with fail-soft on errors
- [ ] `aiChatService.sendMessageWithAIResponse` injects memory bundle into prompt; fail-soft on error; sends `WRITE` event to `wikiHealMachine` post-turn
- [ ] Cloud sync respects `character.save_to_cloud` flag; offline path uses local SQLite
- [ ] All 5 callables follow `enforceAppCheck`, `CLOUD_SQL_SECRETS`, handler-split-for-test pattern
- [ ] `npm run typecheck && npm run lint && npm run test` green (root + functions/)


---

## Appendix: `expo-agent-memory` Package Extraction Feasibility

### Core insight: Split cleanly by layer

Package has 4 layers. Not all extractable:

| Layer | Extractable? | Why |
|-------|-------------|-----|
| SQLite schema + migrations | ✅ Easy | Pure SQL, zero app coupling |
| Data access (CRUD + FTS5) | ✅ Easy | Generic patterns, just need type param |
| Client service (Firebase callables) | ⚠️ Hard | Each app = own Firebase project |
| Cloud Functions backend | ❌ Not packagable | Can't `npm install` a Cloud Function |

---

### The key problem: migration namespace collision

Host app owns `SCHEMA_VERSION = 8` integer. Package can't claim version 9 in foreign app.

**Solution**: Own separate DB file.

```
SQLite.openDatabaseAsync('agent_memory.db')  // not the host app's DB
```

Cleanest isolation. Install = open new file. Uninstall = delete file + run `DROP` migration on own DB. No schema version conflict with host app. This is what user described: "create its own table."

---

### What the package looks like

**Package name**: `expo-agent-memory` (or `react-native-agent-memory`)

**Ships:**
- `agent_memory.db` (own file, own migration runner, version starts at 1)
- 3 tables: `wiki_entries`, `agent_tasks`, `memory_events`
- FTS5 virtual table + triggers
- CRUD + FTS5 search exports
- Context injection formatter → produces `[MEMORY]...[/MEMORY]` block
- Pruning logic (events → wiki compression)
- Conflict resolution (certain/inferred/tentative)

**Generalized API**: `character_id` → `agentId`, user scoping stays.

**Does NOT ship:**
- Firebase callables (too app-specific)
- Cloud SQL Drizzle schema
- Credit/billing hooks
- App Check integration

**Optional**: `/functions-template` folder in package repo — Cloud Function source users copy + deploy themselves.

---

### Difficulty: 3/5 (Medium)

**Easy parts:**
- SQL strings trivially portable
- Migration runner already app-agnostic in this codebase
- FTS5 available in expo-sqlite 55.x (ships enabled)
- Context injection = pure function, trivial extract

**Hard parts:**
- Peer dependency matrix (`expo-sqlite` version drift over time)
- Jest mock for expo-sqlite in package's own test suite
- Publishing/maintaining semver + changelogs = ongoing cost
- Firebase backend piece must stay in each app → users need to write their own `memoryWrite`/`memoryRead` callables from your spec as reference

---

### Value: High, with caveats

**High value because:**
- No comparable package exists for Expo/React Native agent memory
- Universal problem — every LLM chatbot app needs this
- Local-first + FTS5 + structured facts is genuinely novel in this space
- Forces cleaner abstraction in Clanker (good side effect)

**Caveats:**
- Backend piece (librarian LLM pass) stays per-app → package handles storage, not intelligence
- Expo-sqlite breaking changes (55 → 56+) could block users
- Maintaining a public package adds non-trivial overhead for small team

---

### Recommended approach

**Build for Clanker first, extract after v1 proven.**

Reason: extracting during initial build = two problems at once (get the feature right + get the API right). Premature extraction risks designing wrong abstraction.

**Build path:**
1. Implement full feature in Clanker (spec as written)
2. Keep DB layer in `src/database/wikiDatabase.ts` etc. with zero Firebase coupling (they already are by spec)
3. After v1 ships + works, extract SQLite layer to separate package with ~1 day effort
4. Clanker becomes first consumer + living demo

**If extract immediately** (valid alternative): add ~1 week to timeline. Design API surface carefully upfront (`AgentMemoryStore` class or module factory). Worth it only if you plan to publish within 6 months.

---

**TL;DR**: Feasible, medium difficulty, high value. Local SQLite layer extracts cleanly into own DB file with zero conflict. Firebase/cloud layer stays per-app. Recommend build-first-extract-later unless publishing is an actual near-term goal.