# LLM Wiki Memory — Structured Agent-Robust Memory

**Status**: v1 Implementation Complete ✅  
**Premium Feature**: Yes (gated on `usage.hasUnlimited` for monthly subscription)  
**Architecture**: Local SQLite + Cloud SQL mirror (optional)  
**Related Docs**: [Spec](superpowers/specs/2026-04-24-llm-wiki-memory.md) | [Handoff](superpowers/plans/2026-04-27-llm-wiki-memory-handoff.md)

---

## Overview

LLM Wiki Memory extends the existing chat summarization system with **structured, queryable memory** that can be read, written, and updated within a conversation without blocking replies. It complements `characters.context` (rolling conversation summary) with a database of facts, open tasks, and episodic observations, enabling agents to reference specific information efficiently.

### Why Wiki Memory?

| Problem | Solution |
|---------|----------|
| No single-fact lookup | FTS5 full-text search on local SQLite |
| Atomic fact updates | `wiki_entries` table with upsert semantics |
| No "when did we last discuss X?" | `last_accessed_at` + `access_count` tracking |
| No goal tracking | `agent_tasks` table for pending objectives |
| Conflicting facts accumulate | `confidence` levels + stale entry downgrade in `memoryHeal` |

---

## Architecture

### Data Model

#### Local SQLite (`v11` migration)

**`wiki_entries`** — Long-term facts (stable)
- Searchable via FTS5 full-text index
- Tracks confidence level (`certain` | `inferred` | `tentative`)
- Soft-deleted via `deleted_at` timestamp
- Synced to Cloud SQL if `character.save_to_cloud = 1`

**`agent_tasks`** — Volatile goals / pending actions
- Status workflow: `pending` → `in_progress` | `done` | `abandoned`
- Priority-ordered (`priority` integer, -1 = low, 0 = default, 2 = high)
- Soft-deleted for audit trail

**`memory_events`** — Episodic append-only log
- Event types: `observation`, `decision`, `action`, `outcome`
- Links to related `wiki_entries` and `agent_tasks`
- Not currently auto-pruned; retention is unbounded unless pruning is implemented separately

**`derived_synonyms`** — Auto-grown query expansion vocabulary
- Built from co-occurring tags during `memoryWrite`
- Layer 2 of 3-layer FTS5 preprocessing pipeline
- Not synced to Cloud SQL (regenerable from entries)

**`characters` columns** (v11 migration)
- `memory_checkpoint` — message count at last `memoryWrite`
- `heal_checkpoint` — message count at last `memoryHeal`

#### Cloud SQL (PostgreSQL, optional)

Mirror of local `wiki_entries`, `agent_tasks`, `memory_events` when `character.save_to_cloud = 1`:
- Tsvector + GIN index on `wiki_entries` for native PostgreSQL FTS
- Foreign keys to `characters.id` and `users.id`
- All timestamps as Timestamp type
- Soft-delete pattern (`deleted_at` nullable) matches local

**No cloud-side storage** for:
- `derived_synonyms` (regenerable)
- `heal_checkpoint` / `memory_checkpoint` (client-side only)

---

## Client-Side Memory Read

**Always local SQLite, <50ms, no callable on hot path.**

### Flow: `fetchMemoryBundle(characterId, userQuery)`

1. **Query Preprocessing** — `buildFtsQuery` (3 layers)
   - **Layer 1**: Sanitize → lowercase → strip punctuation → drop short tokens + stopwords
   - **Layer 2**: Expand with base + derived synonyms
   - **Layer 3**: Lemmatization via `compromise.js` NLP (nouns → singular, verbs → infinitive)

2. **FTS5 Search** — `wikiDatabase.searchEntries(characterId, ftsQuery)`
   - Filters soft-deleted rows: `rowid IN (SELECT rowid FROM wiki_fts) AND deleted_at IS NULL`
   - Recency fallback if `ftsQuery` is empty

3. **Bundle Assembly**
   - Top 10 facts (by `updated_at` DESC)
   - Top 5 open tasks (by `priority DESC`)
   - Top 3 memory events (by `created_at DESC`)
   - Return with `[MEMORY]` block budget of 1,500 chars

### Prompt Injection

```
[MEMORY]
Facts:
  - [certain] User prefers morning workouts | tags: health, schedule
  - [inferred] User's partner named Jamie | tags: relationships

Open tasks:
  - [high] Ask how job interview went (set 2 days ago)

Recent episodic context:
  - [observation] User mentioned stress about deadline
  - [outcome] User said it helped when we discussed priorities
[/MEMORY]

(existing summary context follows)
```

Block is **truncated entry-by-entry** (not mid-string) to fit within 1,500 chars.

---

## Server-Side Memory Write

**Premium users only. Fire-and-forget, deduped per `(characterId, userId)` pair.**

### Flow: `memoryWrite` Callable (triggered every 20 messages)

Invoked by `dispatchWikiWrite` in [wikiHealMachine.ts](../src/machines/wikiHealMachine.ts) post-turn:

1. **Fact Extraction** — Heuristic text chunking
   - Splits `sourceText` by sentence boundaries (`. ! ?`)
   - Top 3 sentences clipped to 200 chars each
   - Tags inferred from content keywords (health, work, relationships, goals)

2. **Dedup Logic** — Fuzzy case-insensitive title match (token Jaccard similarity ≥ 0.5)
   - Tokenizes both titles into words (length ≥ 3), computes intersection/union ratio
   - Updates body + downgrade confidence if changed
   - Adds event log entry for audit trail

3. **Task Extraction** — Keyword-based filtering
   - Detects "remind", "follow up", "todo" patterns
   - Priority inferred from urgency keywords
   - Due context set to "next conversation"

4. **Synonym Enrichment** — Post-upsert
   - Collects title terms from newly added entries
   - Groups by tag → identifies co-occurring terms
   - Updates `derived_synonyms` table

5. **Cloud Persist** (conditional)
   - If `character.save_to_cloud = 1` → upsert to Cloud SQL
   - If not cloud-synced → skip Cloud SQL, return diff for local apply
   - Always returns full diff payloads for client SQLite upsert

### Response
```json
{
  "diff": {
    "entriesAdded": 2,
    "entriesUpdated": 1,
    "tasksOpened": 1,
    "tasksClosed": 0,
    "eventsAppended": 1,
    "synonymsUpdated": 2,
    "entries": [...],
    "tasks": [...],
    "events": [...],
    "synonyms": [...]
  }
}
```

---

## Server-Side Memory Heal

**Premium users only. Cloud-synced characters only (`save_to_cloud = 1` with a valid `cloud_id`). Optional maintenance pass, triggered every 20 messages (same cadence as write). In v1, `memoryHeal` uses heuristic rules for stale downgrade/orphan removal/concept seeding, and a Gemini LLM call for contradiction detection.**

### Flow: `memoryHeal` Callable

Same checkpoint-advance-before-invoke pattern as write:

1. **Load Capped Wiki** — Top 100 entries for the heuristic pass
   - Priority: `confidence='certain'` first
   - Then by `accessCount DESC`
   - Then by `updated_at DESC`

2. **Stale Downgrade** — Rule-based confidence decay
   - `last_accessed_at < 60 days ago` + `confidence='inferred'` → mark `tentative`
   - Preserves user-stated facts (`confidence='certain'`)

3. **Orphan Removal** — Rule-based cleanup
   - `access_count = 0` + age > 30 days → soft-delete
   - Keeps recent/unused new facts

4. **Concept Seeding** — Task-derived tentative entry creation
   - For each pending task not covered by existing entries
   - Create tentative entry: `[tentative] <task description>`
   - Log event linking task → seeded entry
   - In v1 this is heuristic seeding from task text, not LLM inference

5. **Contradiction Detection** — LLM-assisted (v1)
   - Sends up to 100 wiki entries to Gemini (`gemini-2.5-flash`)
   - Parses returned JSON array of `{ entryAId, entryBId, reason }` pairs
   - Older entry in each pair downgraded to `confidence='tentative'`
   - `memory_event` of type `observation` appended for each flagged pair
   - Fails soft: LLM errors skip contradiction pass, heuristic passes still apply

### Response
```json
{
  "diff": {
    "contradictionsFlagged": 0,
    "staleDowngraded": 3,
    "orphansRemoved": 1,
    "conceptsSeeded": 2,
    "entries": [...],
    "tasks": [...],
    "events": [...]
  }
}
```

---

## Memory Forget

**User-initiated deletion (soft-delete, non-reversible at API level).**

### Callable: `memoryForget`

```json
{
  "characterId": "char_123",
  "entryIds": ["entry_1", "entry_2"],    // optional
  "taskIds": ["task_1"],                 // optional
  "clearAll": false                      // soft-delete entire wiki
}
```

- Sets `deleted_at` timestamp
- Preserves `memory_events` for audit
- Returns count of deleted entries/tasks

---

## Memory Read (Bootstrap)

**One-time pull from Cloud SQL to seed a new device's local SQLite.**

### Callable: `memoryRead`

Invoked by `triggerMemoryRead` in [memoryService.ts](../src/services/memoryService.ts), called from `dispatchWikiWrite` before the first write cycle. Fires when:
- Cloud-synced character (`character.save_to_cloud = 1` with a valid Cloud UUID in `cloud_id`)
- Local wiki is empty for that character (`countEntries == 0`)
- User is online (implied by reaching `dispatchWikiWrite`)

**Not on hot path.** Returns:
```json
{
  "entries": [...],
  "tasks": [...],
  "events": [...],
  "synonyms": [...]
}
```

Client applies via bulk upsert to local SQLite. Subsequent calls are no-ops once `countEntries > 0`.

---

## State Machine: `dispatchWikiWrite`

Implemented as a simple dispatcher in [wikiHealMachine.ts](../src/machines/wikiHealMachine.ts), not a full XState machine:

```
dispatchWikiWrite(input: { character, userId, chunk })
  ↓
  [Check dedup: activeWikiJobs Set]
  ↓
  [Load message count + character checkpoints]
  ↓
  [Verify online via onlineManager.isOnline()]
  ↓
  [If messages - memory_checkpoint >= 20]
    ├→ Advance memory_checkpoint
    └→ triggerMemoryWrite()
        ↓
        [If messages - heal_checkpoint >= 20]
          ├→ Advance heal_checkpoint
          └→ triggerMemoryHeal()
  ↓
  [Remove from activeWikiJobs]
```

**Key properties**:
- **Dedup**: `Set<${characterId}:${userId}>` prevents concurrent jobs
- **Online gate**: Returns early if offline (no checkpoint consumed)
- **Checkpoint advance before invocation**: Prevents retry storms on network errors
- **Fire-and-forget**: No await for callable results in the critical path

Invoked post-turn from [src/services/aiChatService.ts](../src/services/aiChatService.ts):
```ts
void dispatchWikiWrite({
  character,
  userId,
  chunk: userMessage.text,
})
```

---

## Coexistence with Existing Memory

**Both systems run independently:**

| System | Trigger | Scope | Gate |
|--------|---------|-------|------|
| **`characters.context`** (summary blob) | Every 20 messages | All users | None |
| **Wiki entries** (write) | Every 20 messages | Premium only | `usage.hasUnlimited` |
| **Wiki heal** | Every 20 messages | Premium, cloud-synced only | `save_to_cloud && cloud_id` |

- Summary flow (`triggerConversationSummary`) unchanged
- Wiki flow (`dispatchWikiWrite`) runs in parallel for premium users
- Prompt includes both: `[MEMORY]` block + existing summary section

---

## Testing

### Root Tests
- [__tests__/wikiHealMachine.test.ts](../__tests__/wikiHealMachine.test.ts) — Dispatcher orchestration
- [__tests__/ftsQueryBuilder.test.ts](../__tests__/ftsQueryBuilder.test.ts) — 3-layer query preprocessing
- [__tests__/memoryService.test.ts](../__tests__/memoryService.test.ts) — Client callable wrappers

### Functions Tests
- [functions/src/memoryFunctions.test.ts](../functions/src/memoryFunctions.test.ts) — All 5 callables (162 tests)

**All passing**: 306 root + 162 functions = 468 total ✅

---

## Future Improvements (v2+)

### Phase 4 — Contradiction Flagging
- Wire LLM to detect conflicting fact pairs
- Mark with lower confidence, invite user resolution

### Phase 5 — LLM Librarian Integration
- Replace heuristic fact extraction with Vertex AI
- Structured output schema for fact/task/event generation

### Phase 6 — On-Device Inference (v2)
- Apple Intelligence (iOS 26+) / GGUF for local LLM
- Fallback to cloud callable when device incapable

### Phase 7 — User Document Ingest UI
- File picker / paste surface for user-sourced facts
- `sourceType='user_document'` already supported in API

---

## Deployment & Migration

### Database Migration

Bundled in `SCHEMA_VERSION = 11` (local SQLite):
```bash
npm run test  # Verifies migration applies cleanly
```

Cloud SQL migration:
```bash
cd functions
npm run db:generate  # Generate 0004_wiki_memory.sql from Drizzle schema
npm run migrate      # Deploy to Cloud SQL
```

### Verification

```bash
npm run typecheck && npm run lint && npm run test
# 306/306 tests ✅

cd functions && npm run typecheck && npm run build && npm run test
# 162/162 tests ✅
```

---

## Known Limitations (v1)

- **No vector search**: FTS5 keyword-based only (sufficient for v1)
- **No cross-character memory**: Each character's wiki is isolated
- **Heuristic fact extraction**: No LLM preprocessing (v2 planned)
- **Contradiction detection stubbed**: Manual resolution only (v2 planned)
- **No bootstrap on reconnect**: Requires manual navigation (workaround: log out/in)
- **Contradiction flagging disabled**: Returns 0 until LLM integration

---

## Related Systems

- [Chat Memory Summarization](CHAT_MEMORY_SUMMARIZATION.md) — Rolling conversation summary (`characters.context`)
- [Cloud Character Save + Share](CLOUD_CHARACTER_SAVE_SHARE.md) — Character sync to Cloud SQL
- [Firebase Functions](FIREBASE_FUNCTIONS.md) — Cloud Function deployment & testing
- [State Management](STATE_MANAGEMENT.md) — XState machines & TanStack Query
