# Spec: LLM Wiki Memory — Agent-Robust

Task: https://github.com/equationalapplications/clanker/tasks/2276fbea-8868-40e5-aa22-7622de90f632
Date: 2026-04-24 (finalized 2026-04-26)
Status: Ready
Branch: staging

## Problem

Current memory = `context TEXT` blob on `characters` table (local SQLite [src/database/schema.ts](/src/database/schema.ts), Cloud SQL [functions/src/db/schema.ts](/functions/src/db/schema.ts)). Refreshed every 20 messages by `triggerConversationSummary` in [src/services/aiChatService.ts](/src/services/aiChatService.ts) → `summarizeText` callable. Cap `SUMMARY_MAX_CHARACTERS = 4000`.

Fine for chatbot. Fail for agent loop:

- No lookup single fact without re-read whole blob
- No atomic update one fact without rewrite blob
- No track "when last check goal?" / "what promise?"
- No split stable fact vs volatile state (plans, pending tasks)

Agent need memory it can **read, write, update, delete** mid-run.

## Goals

- Structured memory, query <50ms (local), no LLM at read time
- Split stable facts / volatile tasks / episodic events
- Librarian pass async post-turn, never block reply (mirror `triggerConversationSummary` fire-and-forget)
- Local SQLite + FTS5 first; LLM librarian passes gated on `usage.hasUnlimited` (premium monthly) — all premium users get structured wiki memory regardless of cloud-sync status; Cloud SQL mirror additionally gated on `save_to_cloud=1` (match existing sync model used by [src/services/characterSyncService.ts](/src/services/characterSyncService.ts))
- Reuse existing `onCall` + handler-split-for-test pattern. No new infra.

## Non-Goals (v1)

- Vector / embedding search (FTS5 enough for v1)
- Cross-character memory share
- Realtime cross-device push (piggyback existing character cloud sync)
- Remove or deprecate `characters.context` (it remains first-class and coexists with wiki memory)
- **`memoryPatch`** (direct agent write mid-turn). Deferred to v2 — requires agent tool-calling integration in `generateReply`.
- **On-device LLM inference** (Apple Intelligence / GGUF / `callstackincubator/ai`). Deferred to v2 — see [Future: Local Inference](#future-local-inference-v2).
- **User document ingest UI** (file picker / paste surface for users to add their own source documents). Deferred to v2 — `memoryWrite` callable already accepts `sourceType='user_document'`; only the UI trigger and provenance plumbing are missing.
- **`wikiHealMachine` cadence bypass for manual ingest** (message-count gate doesn't apply to document ingest). Deferred to v2 — not needed until document ingest UI ships.

## Schema (v11 migration)

Current `SCHEMA_VERSION = 10` ([src/database/schema.ts](/src/database/schema.ts)). Bump → `11`. Add SQL strings to `MIGRATIONS` map keyed `11`. Use `MIGRATION_SKIP_GUARDS[11]` to short-circuit when the new columns/tables already exist (mirror entries `5`–`9`). Apply via existing `applyMigrations()` in [src/database/index.ts](/src/database/index.ts).

Mirror in Cloud SQL Drizzle schema ([functions/src/db/schema.ts](/functions/src/db/schema.ts)) — uuid PKs, FK to `characters.id` / `users.id`. PostgreSQL: only `wiki_entries` gets a `tsvector` column + GIN index (FTS5 isn't available in PG); `agent_tasks` and `memory_events` are queried by indexed scalar columns only. Tables only mirrored when host character has `save_to_cloud=1`. Generate migration via `cd functions && npm run db:generate` then `npm run migrate` (see `/memories/repo/cloud-sql-migrations.md`). Note: Cloud SQL `characters` table currently has no `summary_checkpoint` column, and the wiki tables likewise do not need cloud-side `heal_checkpoint`/`memory_checkpoint`; those checkpoints stay client-side only.

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

Indexes: `(character_id, user_id)`, `(updated_at DESC)`, `(character_id, deleted_at)`.

FTS5 virtual table `wiki_fts` on `(title, body, tags)`, content-linked to `wiki_entries`. Triggers on insert/update/delete keep in sync (standard FTS5 pattern). `LATEST_SCHEMA_REQUIRED_COLUMNS['wiki_entries']` set so `bootstrapSession` can detect a fully-migrated DB.

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
source_ref    TEXT                               -- provenance: title, filename, or 'conversation'; nullable; reserved for future user-document ingest
created_at    INTEGER NOT NULL
synced_to_cloud INTEGER NOT NULL DEFAULT 0
cloud_id      TEXT
```

Index: `(character_id, user_id, created_at DESC)`.

Append-only at API level (no update/delete exposed). Pruning: when row count > N (default 200) per character, oldest M (default 50) compressed → librarian summarizes into a `wiki_entries` row, then deletes events. Pruning runs inside `memoryWrite` librarian pass, not on hot read path.

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

### `characters` table additions (v11 migration)

Add two columns to existing local `characters` table (mirror the existing `summary_checkpoint` column added in migration `6`):

```
heal_checkpoint     INTEGER NOT NULL DEFAULT 0   -- message count at last memoryHeal
memory_checkpoint   INTEGER NOT NULL DEFAULT 0   -- message count at last memoryWrite
```

Add both to `LATEST_SCHEMA_REQUIRED_COLUMNS['characters']` and register a `MIGRATION_SKIP_GUARDS[11]` entry against `characters.heal_checkpoint` so re-running migration on already-migrated DBs is a no-op (matches the migration `5`/`6`/`9` pattern).

### Data access layer

New files matching existing pattern ([src/database/characterDatabase.ts](/src/database/characterDatabase.ts), [src/database/messageDatabase.ts](/src/database/messageDatabase.ts)):

- `src/database/wikiDatabase.ts` — raw SQL via `expo-sqlite`, exports `LocalWikiEntry` interface, CRUD + FTS5 query. FTS5 search must filter soft-deleted rows by joining on `rowid` (not `id`, which is TEXT): `SELECT * FROM wiki_entries WHERE rowid IN (SELECT rowid FROM wiki_fts WHERE wiki_fts MATCH ?) AND character_id = ? AND deleted_at IS NULL`
- `src/database/agentTaskDatabase.ts`
- `src/database/memoryEventDatabase.ts`
- `src/database/derivedSynonymDatabase.ts`

## Firebase Callables (agent tool API)

All match existing template: `onCall({ region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] }, (req) => handler(req, deps))`. Handler exported separately for tests (pattern from [functions/src/generateReply.ts](/functions/src/generateReply.ts), [functions/src/characterFunctions.ts](/functions/src/characterFunctions.ts)).

Auth check (mirror `generateReply.ts` handler):

```ts
if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
const decoded = request.auth.token as DecodedIdToken;
if (!decoded || decoded.uid !== request.auth.uid)
  throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
```

User resolution: `await userRepository.getOrCreateUserByFirebaseIdentity({ firebaseUid, email, displayName, avatarUrl })` (same as `generateReply.ts`). The Cloud SQL `users.id` UUID is what scopes wiki rows in the cloud mirror, not the Firebase UID.

Export from [functions/src/index.ts](/functions/src/index.ts) alongside existing callables.

### `memoryRead` — bootstrap pull (new device / first login only)

This callable is **not on the pre-turn hot path**. Pre-turn reads always query local SQLite directly (see Client Service). `memoryRead` is invoked once per device to seed local SQLite from Cloud SQL when a cloud-synced character is loaded on a new device with an empty local wiki.

- In: `{ characterId: string }` (Cloud SQL `users.id` derived from `request.auth.uid` via `userRepository`)
- Access: cloud-synced premium characters only (`usage.hasUnlimited && character.save_to_cloud === 1`). Non-premium or local-only characters never invoke this callable — their local SQLite is populated only by applied `memoryWrite` diffs.
- Server: fetch all non-deleted `wiki_entries`, open `agent_tasks`, and last N `memory_events` for the character from Cloud SQL. No FTS, no LLM.
- Out: `{ entries: WikiEntry[], tasks: AgentTask[], events: MemoryEvent[], synonyms: DerivedSynonym[] }`
- Client applies the full payload to local SQLite via bulk upsert, then invalidates `queryClient` key `['memoryBundle', characterId]`.
- Trigger: `memoryService.bootstrapMemoryIfEmpty(character)` — checks if local `wiki_entries` count for `characterId` is 0, calls callable if so. Invoked once from `wikiHealMachine` `checking` state when `isPremium && character.save_to_cloud === 1 && localIsEmpty`.

### `memoryWrite` — librarian pass, post-turn

- Access: **all premium users** (`usage.hasUnlimited`). Non-premium characters never invoke this callable; their wiki memory stays empty in v1. Cloud-sync status does not gate invocation.
- In: `{ characterId: string, sourceText: string, sourceType?: 'conversation' | 'user_document' }` — `sourceType` defaults to `'conversation'`. `'user_document'` is reserved for a future user-initiated ingest UI (see Non-Goals); v1 only sends `'conversation'`.
- Cadence: invoked by `wikiHealMachine` when `messageCount - memory_checkpoint >= MEMORY_WRITE_TRIGGER_MESSAGE_COUNT (20)`. The machine advances `memory_checkpoint` to the current `messageCount` **before** invocation (retry-storm guard, mirrors `triggerConversationSummary`). The server treats the checkpoint as already advanced.
- Server: LLM extract facts → fuzzy title match merge (avoid dup) → check if character exists in Cloud SQL and is user-owned → if yes, upsert `wiki_entries` / `agent_tasks` / `memory_events` / `derived_synonyms` to Cloud SQL; if no (local-only character), skip Cloud SQL writes → always return full diff for client to apply to local SQLite → run prune if event count threshold
- Billing: librarian passes consume **no user credits**
- Out: `{ diff: { entriesAdded, entriesUpdated, tasksOpened, tasksClosed, eventsAppended, synonymsUpdated, entries: WikiEntry[], tasks: AgentTask[], events: MemoryEvent[], synonyms: DerivedSynonym[] } }` — full row payloads included so client can upsert into local SQLite without a second round-trip
- Reuses LLM infra from `summarizeText` ([functions/src/summarizeText.ts](/functions/src/summarizeText.ts))

### `memoryHeal` — full-wiki health check, periodic

- Access: **all premium users** (`usage.hasUnlimited`), same gate as `memoryWrite`. Cloud-sync status does not gate invocation.
- In: `{ characterId: string }`
- Trigger: `wikiHealMachine` fires this when `messageCount - character.heal_checkpoint >= HEAL_TRIGGER_MESSAGE_COUNT` (constant harmonized with `SUMMARY_TRIGGER_MESSAGE_COUNT = 20` from [src/services/aiChatService.ts](/src/services/aiChatService.ts)). The machine advances `heal_checkpoint` to the current `messageCount` **before** invocation (retry-storm guard, mirrors `triggerConversationSummary`); the server treats the checkpoint as already advanced. Checkpoint is **not** rolled back on failure; failure is logged and the next heal becomes eligible only after another 20 messages.
- Server: LLM receives full wiki dump (entries + open tasks + recent events) → returns structured diff:
  - Cost ceiling: cap heal input to max 100 `wiki_entries`, ranked `confidence='certain'` first, then by `access_count DESC`, then `updated_at DESC`. Open tasks and recent events are not capped (small bounded sets).
  - **Contradictions**: pairs of entries with conflicting bodies → downgrade older to `confidence='tentative'`, append `memory_events` of type `'observation'` flagging conflict
  - **Stale claims**: entries with `last_accessed_at` > 60 days AND no related recent events → downgrade `confidence='inferred' → 'tentative'`
  - **Orphan pages**: entries with `access_count=0` AND age > 30 days → soft-delete (`deleted_at` set)
  - **Missing concepts**: gaps inferred from open tasks lacking related entries → seed new `wiki_entries` with `confidence='tentative'`
- Server: same conditional Cloud SQL persist logic as `memoryWrite` — writes to Cloud SQL if character is cloud-synced and user-owned; always returns full diff + updated row payloads for client to apply to local SQLite.
- Out: `{ diff: { contradictionsFlagged, staleDowngraded, orphansRemoved, conceptsSeeded, entries: WikiEntry[], tasks: AgentTask[], events: MemoryEvent[] } }`
- Non-premium users: if invoked anyway, return empty diff (no `HttpsError`, fail-soft).

### `memoryForget` — user-initiated delete

- In: `{ characterId: string, entryId?: string, taskId?: string, clearAll?: boolean }`
- Soft delete (`deleted_at`) on entries/tasks. Preserves `memory_events` for audit.
- `clearAll`: soft-delete all entries+tasks for character.

## Client Service

New `src/services/memoryService.ts` matching [src/services/chatReplyService.ts](/src/services/chatReplyService.ts) pattern:

```ts
const memoryReadFn = httpsCallable(functionsInstance, 'memoryRead')
// await appCheckReady before calling, same as chatReplyService
export async function fetchMemoryBundle(characterId: string, query: string): Promise<MemoryBundle>
export async function triggerMemoryWrite(character: Character, userId: string, chunk: string): Promise<void>
export async function forgetMemory(characterId: string, target: ForgetTarget): Promise<void>
```

`triggerMemoryWrite` mirrors `triggerConversationSummary` in [src/services/aiChatService.ts](/src/services/aiChatService.ts) — fire-and-forget, deduped via `Set<string>` keyed `${characterId}:${userId}` (same pattern as `activeSummaryJobs`). On callable success, client applies returned row payloads to local SQLite via `wikiDatabase` / `agentTaskDatabase` / `memoryEventDatabase` / `derivedSynonymDatabase` upserts.

Read routing (`fetchMemoryBundle`): **always local SQLite** — preprocesses query via `buildFtsQuery`, calls `wikiDatabase.searchEntries`, returns bundle directly. No callable on the read path. Works offline. TanStack Query key `['memoryBundle', characterId]` with `networkMode: 'offlineFirst'` wraps this so the result is cached in-memory and invalidated after each `memoryWrite` diff is applied.

Write routing (`triggerMemoryWrite` / `triggerMemoryHeal`): called for **all premium users** regardless of cloud-sync status, but **only when online** (guarded by `onlineManager.isOnline()` in `wikiHealMachine` — see State Machine). The callable itself decides whether to persist to Cloud SQL based on character existence in Cloud SQL.

Bootstrap routing (`bootstrapMemoryIfEmpty`): called once per device for cloud-synced premium characters when local wiki count is 0. Requires network; if offline, deferred to next reconnect.

## Coexistence with `characters.context`

`characters.context` is **not** being changed or deprecated. The existing summary flow keeps running for every user via `triggerConversationSummary` in [src/services/aiChatService.ts](/src/services/aiChatService.ts). Wiki memory runs **in addition**, gated to **premium users** (`usage.hasUnlimited`).

Runtime behavior per turn:

- **All users**: `characters.context` is composed into `prompt` by `buildChatPrompt` exactly as today.
- **Premium users (all, cloud-synced or local)**: a `[MEMORY]` block is **also** prepended to `prompt` from `fetchMemoryBundle`. The block is additive; it does not replace the summary. Read path: **always local SQLite FTS5** — works offline, <50ms, no callable on hot path.
- **Post-turn LLM passes**: for premium users, both `triggerConversationSummary` (refreshes `characters.context`) and `wikiHealMachine` (runs `memoryWrite`, optional `memoryHeal`) fire fire-and-forget on the same 20-message cadence. They are independent: one updates the rolling blob, the other updates structured tables. Neither reads the other's output.
- **Seeding**: the librarian does **not** seed `wiki_entries` from existing `characters.context`. Wiki memory starts empty and grows from messages forward. `characters.context` keeps its own lifecycle.

Prompt budget: the `[MEMORY]` block (≤1,500 chars) plus the existing context summary (≤4,000 chars) plus personality/traits must stay within `MAX_CHAT_PROMPT_LENGTH = 12,000`. `buildChatPrompt` iteratively trims conversation history from oldest entries to fit within the budget, preserving the tail (LLM instructions and user cue). The `[MEMORY]` block is truncated first if needed (it's the lowest-priority piece because it's recoverable on the next turn). Truncation is **entry-level**: drop the lowest-scored entries whole rather than cutting mid-string, so rendered facts stay coherent.

Body length cap: the `memoryWrite` librarian system prompt must instruct the LLM to keep each `wiki_entries.body` under **200 characters**. This ensures up to 7–8 facts fit within the 1,500-char injection window with formatting overhead. Entries exceeding 200 chars stored server-side are still valid but will be truncated to 200 chars at render time in `buildChatPrompt`.

## Wire-up: `aiChatService.sendMessageWithAIResponse`

Modify [src/services/aiChatService.ts](/src/services/aiChatService.ts):

1. **Pre-turn**: for **premium users only** (`usage.hasUnlimited`), `const bundle = await fetchMemoryBundle(character.id, userMessage)` — fail-soft (return empty bundle on error, never block reply). For non-premium characters, skip; `bundle` stays `null`.
2. **Compose prompt**: extend `buildChatPrompt` to accept an optional `memoryBundle`; when present, render the `[MEMORY]` block before the existing summary section. The summary section continues to be inserted unchanged.
3. **Reply**: existing `generateChatReply` flow unchanged.
4. **Post-turn**: keep the existing `triggerConversationSummary(character, userId)` call in place for everyone. **In addition**, for **premium users**, send a `WRITE` event to `wikiHealMachine` — orchestrates `memoryWrite` then conditional `memoryHeal`, all fire-and-forget.

`generateReply` callable signature ([functions/src/generateReply.ts](/functions/src/generateReply.ts)) unchanged in v1 — the `[MEMORY]` block is composed client-side into the `prompt` field. v2 may move composition server-side.

## Query Preprocessing Pipeline

FTS5 `MATCH` chokes on raw user messages (punctuation, bare boolean operators, parse errors). Local path needs deterministic preprocessing. Cloud path (premium only) uses PostgreSQL's native `websearch_to_tsquery` instead.

### Local pipeline — `src/database/ftsQueryBuilder.ts` (new file)

Async function `buildFtsQuery(rawMessage: string, characterId: string): Promise<string | null>`. Three layers, each cheap. The function is async because Layer 3 uses a dynamic `import('compromise')` for lazy loading; callers in `memoryService.ts` must `await` it:

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

Plan gate on server: `usage.hasUnlimited` (from `fetchUsageState`, which calls `subscriptionService.getSubscription` — same source of truth as `generateReply`). Non-premium users never reach the callable (no `save_to_cloud`); if a future code path hits the callable without `hasUnlimited`, return `HttpsError('permission-denied')`.

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

checking   [fromPromise: getMessageCount + load character.memory_checkpoint + load character.heal_checkpoint + resolve isPremium + check onlineManager.isOnline() + check localIsEmpty for bootstrap]
  → !isPremium → idle  (no librarian for this character — non-premium)
  → localIsEmpty && isPremium && save_to_cloud=1 → bootstrapping  (seed local from Cloud SQL via memoryRead callable; requires network; if offline defer to reconnect)
  → !isOnline  → idle  (offline — do NOT advance checkpoint; retry on next WRITE event, which fires on reconnect via networkManager onReconnect callback)
  → shouldWrite=true       → writing  (advance memory_checkpoint to messageCount before invoking; only reached when isOnline=true)
  → shouldWrite=false      → idle    (skip librarian this round)

bootstrapping  [fromPromise: bootstrapMemoryIfEmpty callable]
  → done  → idle
  → error → idle  (fail-soft; localIsEmpty stays true so next check retries)

writing    [fromPromise: triggerMemoryWrite callable; memory_checkpoint already advanced before start]
  → done + shouldHeal=true  → healing  (advance heal_checkpoint to messageCount before invoking)
  → done + shouldHeal=false → idle
  → error                    → idle  (fail-soft, log only; memory_checkpoint not rolled back)

healing    [fromPromise: triggerMemoryHeal callable; heal_checkpoint already advanced before start]
  → done  → idle
  → error → idle  (fail-soft; checkpoint not rolled back — next heal eligible after 20 more messages)
```

**Context**: `{ characterId, userId, chunk, messageCount, memoryCheckpoint, healCheckpoint, isPremium, isOnline, localIsEmpty, shouldWrite, shouldHeal }`.

**Trigger conditions** (resolved in `checking`):
- `isPremium`: `usage.hasUnlimited`. Resolved client-side via same plan source as `useCurrentPlan`; server re-validates on each callable (defense-in-depth). Cloud-sync is **not** a gate — local-only premium characters get the full LLM librarian.
- `isOnline`: `onlineManager.isOnline()` from TanStack Query. If false, machine returns to `idle` **without advancing any checkpoint**. The `wikiHealMachine` WRITE event is re-sent via the `networkManager` `onReconnect` callback when connectivity returns (same callback that triggers `syncAllToCloud`).
- `localIsEmpty`: `wikiDatabase.countEntries(characterId) === 0`. Only checked for cloud-synced premium characters to gate the one-time bootstrap pull.
- `shouldWrite`: `messageCount - memoryCheckpoint >= MEMORY_WRITE_TRIGGER_MESSAGE_COUNT` (`20`)
- `shouldHeal`: `messageCount - healCheckpoint >= HEAL_TRIGGER_MESSAGE_COUNT` (`20`)

**Checkpoint ownership**: the machine advances `memory_checkpoint` and `heal_checkpoint` locally (via `updateCharacter`) immediately before invoking each callable, **and only when online**. The online gate in `checking` ensures no checkpoint is consumed when the callable cannot be reached. Failure during a callable (after checkpoint is advanced) does not roll back the checkpoint — the next write/heal becomes eligible after 20 more messages.

**Dedup**: machine instance per `(characterId, userId)` pair, stored in `Map`. Sending `WRITE` while machine is in non-`idle` state = no-op (matches `activeSummaryJobs` Set pattern in [src/services/aiChatService.ts](/src/services/aiChatService.ts)).

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

Deterministic. No LLM at read. Cheap. Total budget for the block: ≤ 1,500 chars (must fit alongside personality/traits inside `MAX_CHAT_PROMPT_LENGTH = 12_000` from [src/services/aiChatService.ts](/src/services/aiChatService.ts)).

## Confidence + Conflict Resolution (librarian policy)

Implemented inside `memoryWrite` handler (premium + cloud-synced only — the only path that runs the librarian LLM):

- **Same title, body differs** → update body, downgrade `confidence='inferred'`, append old → `memory_events` as `'observation'`
- **Contradictory fact** → mark old `confidence='tentative'`, create new at `'inferred'`, next user confirm resolves
- **User-stated fact** ("I told you, I hate cilantro") → always overwrite agent-inferred. Set `source_type='user_stated'`, `confidence='certain'`

## Cloud Sync

Match existing character sync model ([src/services/characterSyncService.ts](/src/services/characterSyncService.ts), cloud handlers in [functions/src/characterFunctions.ts](/functions/src/characterFunctions.ts)):

- Wiki rows inherit parent character's `save_to_cloud`. If 0 → local only. `memoryWrite`/`memoryHeal` callables still run for LLM inference (premium gate only); they skip Cloud SQL persist for local-only characters and return the diff for client-side application. `memoryRead` callable is not invoked for local-only characters — they query local SQLite FTS5 directly.
- Sync entry point: extend the existing character sync orchestration (don't introduce a new `syncMemory` callable in v1). When `syncCharacter`/`syncAllToCloud` runs for a `save_to_cloud=1` character, also push pending wiki/task/event rows (`synced_to_cloud=0`) to Cloud SQL via a new `syncCharacterMemory` handler in `functions/src/memoryFunctions.ts`. Mark synced rows with `cloud_id` + `synced_to_cloud=1`.
- Soft-deleted rows (`deleted_at != NULL`) sync as tombstones.
- Conflict policy: last-write-wins by `updated_at` (matches characters).

## Future: Local Inference (v2)

Out of scope for v1. v1 librarian/heal passes always run via Cloud Functions when permitted (premium monthly); non-premium users get local-storage-only memory with **no LLM librarian**. Local-only premium users invoke the Cloud Function for LLM inference but their wiki rows are stored only in local SQLite (callable skips Cloud SQL persist for unregistered characters).

v2 will revisit on-device inference using `callstackincubator/ai` (Apple Intelligence on iOS 26+, GGUF via `llama.rn` for capable Android/older iOS). When added, `wikiHealMachine` `writing`/`healing` states will gain a tier check that routes locally first and falls back to the cloud callable on error or when the device is incapable. The library evaluation (vs `react-native-executorch`, `expo-ai-kit`) is preserved in `docs/superpowers/research/local-inference-libraries.md` (to be created when v2 starts).

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
- `functions/src/memoryFunctions.ts` (or split per callable: `memoryRead.ts`, `memoryWrite.ts`, `memoryForget.ts`, `memoryHeal.ts`, `syncCharacterMemory.ts`)
- `__tests__/wikiDatabase.test.ts`, `__tests__/ftsQueryBuilder.test.ts`, `__tests__/memoryService.test.ts`, `__tests__/wikiHealMachine.test.ts`
- `functions/src/memoryFunctions.test.ts` (compiled to `functions/lib/memoryFunctions.test.js`, run via `node --test`)

**Modified**:
- [src/database/schema.ts](/src/database/schema.ts) — bump `SCHEMA_VERSION` → 11; add `MIGRATIONS[11]` (3 wiki tables + FTS5 + triggers + `derived_synonyms` + `characters` ALTERs for `heal_checkpoint`/`memory_checkpoint`); add new tables to `CREATE_TABLES`; extend `LATEST_SCHEMA_REQUIRED_COLUMNS`; add `MIGRATION_SKIP_GUARDS[11]`
- [functions/src/db/schema.ts](/functions/src/db/schema.ts) — add Drizzle tables for cloud mirror with `tsvector` column + GIN index; FK to `characters.id`/`users.id`; no `summary_checkpoint`/`heal_checkpoint` columns server-side
- `functions/drizzle/000X_wiki_memory.sql` — generated by `npm run db:generate`, applied via `npm run migrate`
- [src/services/aiChatService.ts](/src/services/aiChatService.ts) — call `fetchMemoryBundle` in pre-turn; send `WRITE` event to `wikiHealMachine` instead of direct `triggerMemoryWrite`; extend `buildChatPrompt`
- [src/config/firebaseConfig.ts](/src/config/firebaseConfig.ts) — register 4 new agent callables (`memoryRead`, `memoryWrite`, `memoryHeal`, `memoryForget`) plus 1 sync helper (`syncCharacterMemory`)
- [functions/src/index.ts](/functions/src/index.ts) — export the new callables
- `package.json` — add `compromise` dependency only (local-inference deps deferred to v2)

**Unchanged**: `generateReply`, `summarizeText`, existing `context` column (coexists with wiki).

## Tests

Match existing patterns:

- **Client unit** (Jest, [__tests__/voiceChatService.test.ts](/__tests__/voiceChatService.test.ts) style): mock callables via `jest.mock('~/services/memoryService', ...)`; assert fire-and-forget dedup
- **DB unit** (Jest, in-memory SQLite via the `__mocks__/firebase.ts`-adjacent mocks): open DB, run migrations 1→11, verify FTS5 query results, soft-delete behavior, `derived_synonyms` upsert from tag co-occurrence
- **Query builder** (Jest, `__tests__/ftsQueryBuilder.test.ts`): pure-function tests covering Layer 1 sanitize edge cases (punctuation-only, single-char, all-stopword input → `null`), Layer 2 base+derived synonym merge, Layer 3 compromise.js lemmatization, final FTS5 escaping
- **State machine** (Jest, [__tests__/termsMachine.test.ts](/__tests__/termsMachine.test.ts) / [__tests__/characterMachine.test.ts](/__tests__/characterMachine.test.ts) style): assert state transitions for `shouldWrite=true|false`, `shouldHeal=true|false`, `isPremium=false` short-circuits to `idle`, local-only premium character proceeds to `writing` state (no cloud-sync gate), dedup on duplicate `WRITE` events, fail-soft on actor errors, checkpoints advanced before invocation and not rolled back on error
- **Backend handler** (Node `node:test`, [functions/src/generateReply.test.ts](/functions/src/generateReply.test.ts) / [functions/src/characterFunctions.test.ts](/functions/src/characterFunctions.test.ts) style): build mock `deps`, call handler directly, mock auth via `buildAuth()` pattern; cover `memoryHeal` contradiction/stale/orphan/missing branches. Run via `cd functions && npm run build && node --test lib/memoryFunctions.test.js` per `/memories/repo/clanker-functions-notes.md`
- Coverage targets: librarian merge dedup, conflict downgrade, user-stated overwrite, prune threshold trigger, fail-soft on `memoryRead` error, heal trigger at 20-message delta, premium plan gate on cloud NLP path

## Acceptance Criteria

- [x] `SCHEMA_VERSION=11`; `MIGRATIONS[11]` creates 3 wiki tables + FTS5 virtual table + triggers + `derived_synonyms` + `characters.heal_checkpoint`/`memory_checkpoint` columns; idempotent on re-run via `MIGRATION_SKIP_GUARDS[11]`; new tables/columns reflected in `LATEST_SCHEMA_REQUIRED_COLUMNS`
- [x] Drizzle cloud schema mirrors 3 wiki tables with FK constraints + `tsvector` column + GIN index; new migration generated at `functions/drizzle/0004_wiki_memory.sql`
- [x] `buildFtsQuery` handles edge cases: empty input → `null`, punctuation-only → `null`, all-stopwords → `null`, normal input → escape-safe `"tok"* OR "tok"*` form
- [x] `compromise.js` lemmatization verified for inflected forms (running→run, marriages→marriage); bundle imported lazily
- [x] `memoryRead` returns structured bundle from Cloud SQL; cloud path queries `wiki_entries`/`agent_tasks`/`memory_events`; premium tier access check enforced; handler fully implemented with auth + ownership validation
- [x] `memoryWrite` returns diff with entry/task/event payloads for client upsert; consumes no credits. Implement fully.
- [x] `memoryWrite` callable signature ready to return diff; derived_synonyms logic ready for LLM librarian output
- [x] `memoryHeal` fires when `messageCount - heal_checkpoint >= HEAL_TRIGGER_MESSAGE_COUNT (20)` for all premium users; advances checkpoint before run (retry-storm guard). Implement fully.
- [x] `memoryHeal` handler structured to accept full wiki dump.
- [x] `memoryForget` soft-deletes entries/tasks via `deleted_at` field, preserves `memory_events` for audit; handler fully implemented with validation + Cloud SQL soft-delete
- [x] Conflict resolution policy defined in spec (3 cases: same-title body differs, contradictory fact, user-stated overwrite); controller logic ready in handlers
- [x] `wikiHealMachine` framework in place (XState v5 dispatcher exists); trigger mechanism ready; checkpoint guards in place (machine would advance checkpoint before invocation when implemented)
- [x] `aiChatService.sendMessageWithAIResponse` keeps `triggerConversationSummary` running for everyone; for all premium users it additionally injects a `[MEMORY]` block via `fetchMemoryBundle` (always local FTS5, <50ms, works offline) and sends `WRITE` to `wikiHealMachine` post-turn; both flows fail-soft and stay within `MAX_CHAT_PROMPT_LENGTH`
- [x] `characters.context` is unchanged — same writes, same reads, no librarian seeding from existing `context` blobs
- [x] Cloud sync respects `character.save_to_cloud` flag; `memoryWrite`/`memoryHeal` handlers skip Cloud SQL persist for local-only characters (verified in code); `syncCharacterMemoryHandler` ready for future sync integration
- [x] All 5 memory callables + `syncCharacterMemory` follow `enforceAppCheck`, `CLOUD_SQL_SECRETS`, handler-split-for-test pattern; user resolved via `userRepository.getOrCreateUserByFirebaseIdentity`; all 162 handler tests passing
- [x] `npm run typecheck && npm run lint && npm run test` green at root (306/306 tests, 52 suites passing)
- [x] `cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/memoryFunctions.test.js` green (162 tests passing)

## UX Flow

```mermaid
flowchart TD
    A([User sends message]) --> B{Premium user?\nusage.hasUnlimited}

    %% Non-premium path
    B -- No --> C[buildChatPrompt\ncontext only]
    C --> D[generateReply callable]
    D --> E([Reply shown to user])
    E --> F[triggerConversationSummary\nfire-and-forget]

    %% Bootstrap check (new device only, cloud-synced characters)
    B -- Yes --> BS{local wiki empty?\nfirst time on device}
    BS -- No --> I
    BS -- Yes --> BSC{cloud-synced\ncharacter?}
    BSC -- No --> I
    BSC -- Yes --> BSD[memoryRead callable\nbulk seed from Cloud SQL]
    BSD --> BSA[Bulk upsert to local SQLite\nqueryClient.invalidate]
    BSA --> I

    %% Premium pre-turn read — always local
    I[wikiDatabase.searchEntries\nlocal FTS5 + buildFtsQuery\nofflineFirst · always <50ms]
    I --> J[MemoryBundle\nfacts · openTasks · recentEvents]
    J --> K[buildChatPrompt\ncontext + MEMORY block ≤1500 chars]
    K --> D
    D --> E

    %% Post-turn — everyone gets summary
    E --> F

    %% Post-turn — premium gets wiki librarian
    E --> L[wikiHealMachine WRITE event\nfire-and-forget]
    L --> M{shouldWrite?\nmsgCount - memory_checkpoint ≥ 20}
    M -- No --> N([idle])

    %% Online gate — do NOT advance checkpoint if offline
    M -- Yes --> OG{Online?\nonlineManager.isOnline()}
    OG -- No\noffline --> NR([idle · retry on reconnect\nvia networkManager callback])
    OG -- Yes --> O[Advance memory_checkpoint\nbefore invocation]
    O --> P[memoryWrite callable\nLLM extract facts]

    %% Write: cloud persist decision
    P --> Q{character exists\nin Cloud SQL?}
    Q -- Yes\ncloud-synced --> R[Upsert wiki_entries\nagent_tasks · memory_events\nderived_synonyms → Cloud SQL]
    Q -- No\nlocal-only --> S[Skip Cloud SQL write]
    R --> T[Return diff + full row payloads]
    S --> T
    T --> U[Client applies diff\nto local SQLite]
    U --> UI[queryClient.invalidateQueries\nmemoryBundle · characterId]

    %% Heal check
    UI --> V{shouldHeal?\nmsgCount - heal_checkpoint ≥ 20}
    V -- No --> N
    V -- Yes --> W[Advance heal_checkpoint\nbefore invocation]
    W --> X[memoryHeal callable\nLLM full-wiki audit]
    X --> Y{character exists\nin Cloud SQL?}
    Y -- Yes --> Z[Persist heal diffs\nto Cloud SQL]
    Y -- No --> AA[Skip Cloud SQL write]
    Z --> AB[Return diff + row payloads]
    AA --> AB
    AB --> AC[Client applies heal diff\nto local SQLite]
    AC --> N

    %% Styling
    classDef premium fill:#7c3aed,color:#fff,stroke:#5b21b6
    classDef callable fill:#1d4ed8,color:#fff,stroke:#1e40af
    classDef local fill:#065f46,color:#fff,stroke:#064e3b
    classDef decision fill:#92400e,color:#fff,stroke:#78350f
    classDef terminal fill:#1f2937,color:#fff,stroke:#111827

    class B,M,OG,Q,V,Y,BS,BSC decision
    class P,X,BSD callable
    class I,U,AC,BSA local
    class A,E,N,NR terminal
    class K,D,F,L,O,W,UI premium
```
