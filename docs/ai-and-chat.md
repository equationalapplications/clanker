# AI & Chat

## Overview

All AI model access (chat + image) flows through Firebase 2nd Gen callable functions. The app has zero direct GenAI SDK imports. This ensures auth verification, access control, credit ledger enforcement, and Vertex AI credential protection all happen server-side.

---

## Chat Response Pipeline

### Architecture

Text generation runs through the Firebase callable `generateReply`. The client calls it via `src/services/chatReplyService.ts` for both chat responses and character introductions.

```
Client prompt → generateReply (Firebase callable) → Vertex AI → response + billing metadata
```

### Endpoint

- **Function name:** `generateReply`
- **Type:** Firebase callable (`onCall`, Gen 2)
- **Region:** `us-central1`
- **App Check:** enforced
- **Invoker:** public at Cloud Run layer (with tag + IAM runbook requirements)

### Request Contract

```json
{
  "prompt": "string (required, non-empty after trim, max 12000 chars)",
  "referenceId": "string (optional, max 128 chars, idempotency/reference key)"
}
```

Auth requirements:
- Firebase auth context must be present
- Context UID must match token UID
- Email must exist in Firebase token

### Response Contract

```json
{
  "reply": "string",
  "creditsSpent": 1,
  "remainingCredits": "number",
  "planTier": "string | null",
  "planStatus": "'active' | 'cancelled' | 'expired' | null",
  "verifiedAt": "string (ISO 8601)"
}
```

### Authorization & Billing Flow

1. Resolve Cloud SQL user from Firebase identity (create on first authenticated call when absent)
2. Ensure Cloud SQL user and subscription row exist
3. Reserve one credit via the Cloud SQL-backed credit service; capture the `transactionId`
4. Generate text reply with Vertex AI (`maxOutputTokens = 1024`)
5. On model failure: refund 1 credit to the same grant row via `transactionId`, return `internal` error

**Key property:** Credit is reserved (decremented) before model generation. On failure, credit is refunded — no net spend occurs.

### Error Mapping

| Error Code | Condition |
|---|---|
| `unauthenticated` | Missing auth context or token UID mismatch |
| `invalid-argument` | Prompt missing, empty, exceeds 12000 chars, or `referenceId` exceeds 128 chars |
| `failed-precondition` | Missing token email, missing server config, or insufficient credits |
| `internal` | User lookup/create failures, downstream failures, model invocation errors |

Operational logs include debug signals for Cloud SQL users with no active subscription rows.

### Testing

Tests in `functions/src/generateReply.test.ts` cover:
- Unauthenticated rejection
- Empty prompt rejection
- Pay-as-you-go spend flow
- Subscription credit spend flow
- Zero-credit rejection
- No spend on model failure
- Response shape on success

### Deploy

```bash
cd functions
npm run typecheck && npm run lint && npm run test && npm run deploy
```

After deploy for new callable service `generatereply`, apply org-policy bypass tag and public invoker IAM.

---

## Chat Memory Summarization

The app summarizes a conversation to reduce SQLite growth and prompt bloat.

### Trigger

- **Condition:** `messageCount - summary_checkpoint >= 20` (at least 20 new stored messages since last summary)
- `characters.summary_checkpoint` stores the message-count baseline after the last successful summarization for a `(characterId, userId)` conversation
- **Trigger location:** After an AI reply is saved locally
- **Execution mode:** Fire-and-forget background task (non-blocking)
- **Concurrency guard:** One summary job per `(characterId, userId)` at a time

### Input Strategy

Each new summary is generated from:
1. The previous stored summary in `characters.context` (older memory)
2. The most recent 20 conversation messages (higher priority)

Prompt instructions explicitly prioritize recent messages over older summarized context when conflicts appear.

### Output

- Max summary length: 4000 characters
- Destination: `characters.context`
- Empty summaries are rejected

### SQLite Retention

After a successful summary update:
- Keep latest 20 messages for the conversation
- Delete older conversation messages for that `(characterId, userId)` pair

### Cloud Function: `summarizeText`

A Firebase callable that performs summarization on Vertex AI using `gemini-2.5-flash`.

**Input:**
```json
{
  "text": "string (required, non-empty, max 16000 chars)",
  "maxCharacters": "number (required positive integer)"
}
```

**Response:**
```json
{
  "summary": "string"
}
```

**Security:** Firebase Auth required, App Check enforced, no user credits spent by this function.

---

## LLM Wiki Memory — Structured Agent-Robust Memory

> **Status:** Premium feature (gated on sufficient credits), v1 implementation complete.
>
> **Note:** The current codebase uses `@equationalapplications/expo-llm-wiki@4.9.0` with `src/services/wikiService.ts`, `src/hooks/useCharacterWiki.ts`, and `src/machines/wikiMachine.ts`. Legacy callable support remains in `functions/src/memoryFunctions.ts` for compatibility.

LLM Wiki Memory extends chat summarization with structured, queryable memory that can be read, written, and updated within a conversation without blocking replies. It complements `characters.context` (rolling summary) with a database of facts, open tasks, and episodic observations.

### Why Wiki Memory?

| Problem | Solution |
|---|---|
| No single-fact lookup | FTS5 full-text search on local SQLite |
| Atomic fact updates | `wiki_entries` table with upsert semantics |
| No "when did we last discuss X?" | `last_accessed_at` + `access_count` tracking |
| No goal tracking | `agent_tasks` table for pending objectives |
| Conflicting facts accumulate | `confidence` levels + stale entry downgrade |

### Data Model

#### Local SQLite (v11 migration)

- **`wiki_entries`** — Long-term facts. FTS5 full-text index. Fields: `confidence` (`certain` | `inferred` | `tentative`), soft-delete via `deleted_at`. Synced to Cloud SQL if `character.save_to_cloud = 1`.
- **`agent_tasks`** — Volatile goals/pending actions. Status: `pending` → `in_progress` | `done` | `abandoned`. Priority-ordered.
- **`memory_events`** — Episodic append-only log. Types: `observation`, `decision`, `action`, `outcome`. Links to related entries/tasks. Unbounded retention (pruning not yet implemented).
- **`derived_synonyms`** — Auto-grown query expansion vocabulary from co-occurring tags. Not synced to Cloud SQL.
- **`characters` columns:** `memory_checkpoint` (message count at last `memoryWrite`), `heal_checkpoint` (message count at last `memoryHeal`).

#### Cloud SQL (PostgreSQL, optional)

Mirror of `wiki_entries`, `agent_tasks`, `memory_events` when `character.save_to_cloud = 1`. Tsvector + GIN index on wiki_entries. No cloud storage for `derived_synonyms`, `heal_checkpoint`, or `memory_checkpoint`.

### Client-Side Memory Read

**Always local SQLite, <50ms, no callable on hot path.**

`fetchMemoryBundle(characterId, userQuery)`:

1. **Query Preprocessing** — `buildFtsQuery` (3 layers):
   - **Layer 1:** Sanitize → lowercase → strip punctuation → drop short tokens + stopwords
   - **Layer 2:** Expand with base + derived synonyms
   - **Layer 3:** Lemmatization via `compromise.js` (nouns → singular, verbs → infinitive)

2. **FTS5 Search** — `wikiDatabase.searchEntries(characterId, ftsQuery)` — filters soft-deleted rows

3. **Bundle Assembly:**
   - Top 10 facts (by `updated_at` DESC)
   - Top 5 open tasks (by `priority DESC`)
   - Top 3 memory events (by `created_at` DESC)
   - Return with `[MEMORY]` block budget of 1,500 chars (truncated entry-by-entry)

**Prompt injection format:**
```
[MEMORY]
Facts:
  - [certain] User prefers morning workouts | tags: health, schedule
  - [inferred] User's partner named Jamie | tags: relationships
Open tasks:
  - [high] Ask how job interview went (set 2 days ago)
Recent episodic context:
  - [observation] User mentioned stress about deadline
[/MEMORY]
```

### Server-Side Memory Write

Premium-only. Fire-and-forget, deduped per `(characterId, userId)` pair. Triggered every 20 messages via `dispatchWikiWrite`.

**Flow:**
1. **Fact Extraction** — LLM-first structured extraction via Vertex AI; falls back to heuristic sentence chunking (top 3 sentences, 200 chars, keyword-based tags)
2. **Dedup** — Fuzzy case-insensitive title match (token Jaccard similarity ≥ 0.5)
3. **Task Extraction** — LLM-extracted or keyword-filtered ("remind", "follow up", "todo")
4. **Synonym Enrichment** — Post-upsert collection of co-occurring terms
5. **Cloud Persist** — If `character.save_to_cloud = 1`, upsert to Cloud SQL; always returns diff payloads for client SQLite upsert

**Response:**
```json
{
  "diff": {
    "entriesAdded": 2,
    "entriesUpdated": 1,
    "tasksOpened": 1,
    "tasksClosed": 0,
    "eventsAppended": 1,
    "synonymsUpdated": 2
  }
}
```

### Server-Side Memory Heal

Premium-only. Same cadence as write (every 20 messages). Uses heuristic rules + Gemini LLM for contradiction detection.

**Passes:**
1. **Stale Downgrade:** `last_accessed_at > 60 days` + `confidence='inferred'` → `tentative`. Preserves `certain` facts.
2. **Orphan Removal:** `access_count = 0` + age > 30 days → soft-delete
3. **Concept Seeding:** Create tentative entries from uncovered pending tasks
4. **Contradiction Detection:** LLM-assisted (gemini-2.5-flash, up to 100 entries). Older entry downgraded per flagged pair. Fails soft: LLM errors skip contradiction pass.

**Response:**
```json
{
  "diff": {
    "contradictionsFlagged": 0,
    "staleDowngraded": 3,
    "orphansRemoved": 1,
    "conceptsSeeded": 2
  }
}
```

### Memory Forget

User-initiated soft-delete via `memoryForget` callable.

```json
{
  "characterId": "char_123",
  "entryIds": ["entry_1"],
  "taskIds": ["task_1"],
  "clearAll": false
}
```

Sets `deleted_at`, preserves `memory_events` for audit.

### Memory Read (Bootstrap)

One-time pull from Cloud SQL to seed a new device. Invoked by `triggerMemoryRead` before the first write cycle when:
- Cloud-synced character with valid `cloud_id`
- Local wiki is empty for that character
- User is online

Returns entries, tasks, events, and synonyms for bulk upsert. Subsequent calls are no-ops once `countEntries > 0`.

### State Machine: `dispatchWikiWrite`

Implemented as a simple dispatcher in `wikiHealMachine.ts` (not a full XState machine):

```
dispatchWikiWrite({ character, userId, chunk })
  → Check dedup (Set<characterId:userId>)
  → Load message count + character checkpoints
  → Verify online (onlineManager.isOnline())
  → If messages - memory_checkpoint >= 20:
      Advance memory_checkpoint
      triggerMemoryWrite()
      → If messages - heal_checkpoint >= 20:
          Advance heal_checkpoint
          triggerMemoryHeal()
  → Remove from activeWikiJobs
```

**Key properties:** Dedup set prevents concurrent jobs, online gate returns early (no checkpoint consumed), checkpoint advances before invocation to prevent retry storms, fire-and-forget (no await).

Invoked post-turn from `src/services/aiChatService.ts`:
```ts
void dispatchWikiWrite({ character, userId, chunk: userMessage.text })
```

### Coexistence with Existing Memory

| System | Trigger | Scope | Gate |
|---|---|---|---|
| `characters.context` (summary blob) | Every 20 messages | All users | None |
| Wiki entries (write) | Every 20 messages | Credit gated | sufficient credits |
| Wiki heal | Every 20 messages | Credit gated | sufficient credits |

Summary flow (`triggerConversationSummary`) unchanged. Wiki flow runs in parallel for premium users. Prompt includes both `[MEMORY]` block and existing summary section.

### Testing

- `__tests__/wikiHealMachine.test.ts` — Dispatcher orchestration
- `__tests__/ftsQueryBuilder.test.ts` — 3-layer query preprocessing
- `__tests__/memoryService.test.ts` — Client callable wrappers
- `functions/src/memoryFunctions.test.ts` — All 5 callables (162 tests)

### Known Limitations (v1)

- **No vector search:** FTS5 keyword-based only
- **No cross-character memory:** Each character's wiki is isolated
- **Fact extraction is best-effort:** LLM extraction with heuristic fallback
- **Contradiction detection is best-effort:** LLM-assisted, not guaranteed
- **No bootstrap on reconnect:** Workaround: log out/in

---

## Wiki State Machine Architecture

The character memory system uses `@equationalapplications/expo-llm-wiki@4.9.0` with an XState v5 state machine per character to serialize all wiki operations.

### Components

- **`wikiMachine`** (`src/machines/wikiMachine.ts`) — One actor per character. States: `idle`, `reading`, `writing`, `ingesting`, `syncing`, `forgetting`, `busyRetry`, `error`. All operations queued via `pendingEvents`, flushed sequentially from `idle`. `WikiBusyError` triggers automatic retry.

- **`wikiOrchestrator`** (`src/services/wikiOrchestrator.ts`) — Singleton managing wiki machine actors. API: `getOrSpawn(entityId, wiki, machineOptions?)`, `stop(entityId)`, `syncAll(items, wiki, concurrency?, timeoutMs?, options?)`. Actors cached by entity ID.

- **`useCharacterWiki`** (`src/hooks/useCharacterWiki.ts`) — React hook wrapping orchestrator. Returns `{ status, isBusy, isIngesting, error, read, write, ingest, forget, sync, hasChanged }`.

- **`wikiService`** (`src/services/wikiService.ts`) — Wiki singleton setup with mobile-optimized config.

### Data Flow

1. **Chat send:** `useAIChat` → `useCharacterWiki.read(query)` → machine: idle→reading→idle → format context → send with AI → `useCharacterWiki.write(observation)`
2. **Status:** `subscribeEntityStatus` callback → `STATUS` events → UI banner via `useCharacterWiki.status`
3. **Cloud sync:** `characterSyncService.syncWikiForCloud` → `wikiOrchestrator.syncAll` with entity-ID remap
4. **Character delete:** `characterMachine` DELETE → soft-delete in DB → `wikiOrchestrator.stop(entityId)`

### Key Design Decisions

- **No subscription gate on memory:** All users get memory read/write/ingest. Cloud sync remains gated on `save_to_cloud + cloud_id`.
- **SYNC carries a callback:** `runRemoteSync` decouples the machine from cloud-specific entity-ID remapping.
- **`subscribeEntityStatus` required:** Polling fallback removed.

Full design spec: [docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md](superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md)

---

## Image Generation

### Architecture

Character image generation is server-side only. Client sends a prompt to the Firebase callable `generateImage`, the backend calls Vertex AI (`gemini-2.5-flash-image`), and returns raw base64 image data.

```
User taps Generate → useImageGeneration → generateImageViaCallable(prompt)
  → generateImage (Firebase callable) → Vertex AI → { imageBase64, mimeType, ... }
  → saveCharacterImageLocally (SQLite) → UI refreshes
```

The app stores the returned base64 in SQLite `characters.avatar_data` and renders via data URI. No cloud object-storage upload is used for generated avatars.

### Callable Contract

**Input:**
```ts
type GenerateImageRequest = {
  prompt: string     // non-empty, trimmed, max 2000 chars
  referenceId?: string
}
```

**Output:**
```ts
type GenerateImageResponse = {
  imageBase64: string
  mimeType: string
  creditsSpent: number
  remainingCredits: number
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
}
```

### Security & Abuse Controls

- Authenticated callable only
- App Check enforced at function boundary
- Prompt validation (required + max length)
- Subscription/credit enforcement before generation
- Per-user rate limiting (in-memory request window)
- Payload-size cap for returned base64

If any check fails, the function fails closed with `HttpsError`.

### Billing

- All image generations require available credits
- 1 credit reserved (decremented) before the Vertex model call
- On model failure: credit refunded to the same grant row — no net spend

### Client Integration Files

- `src/config/firebaseConfig.ts` / `firebaseConfig.web.ts` — export callable `generateImageFn`
- `src/services/imageGenerationService.ts` — waits for App Check, calls callable, validates/normalizes payload
- `src/hooks/useImageGeneration.ts` — manages loading/error state and persists local avatar data
- Screen usage: character edit route calls `useImageGeneration`

### Logging

Success logs include: Firebase UID, Cloud SQL user ID, plan tier, credits spent/remaining, latency, approximate payload byte size. Error logs include model and billing failures with context.

### AI Access Policy

The app makes no client-side GenAI model calls (type-only `@google/genai` imports are allowed). All AI model access (chat + image) flows through Firebase callable functions.

---

## Local Development (cloud-agent)

`cloud-agent` (Cloud Run service backing the "Cloud Agent path" in `useAIChat.ts`, plus wiki-memory embeddings) makes its own Vertex AI calls — `agent.ts` for chat/tool routing, `db/embeddings.ts` for `text-embedding-004`. Neither uses an API key; both authenticate via Application Default Credentials (ADC), same as the deployed Cloud Run service (which gets ADC for free from the metadata server).

**One-time host setup:**

```bash
gcloud auth application-default login
```

**`docker-compose.local.yml` wiring** (already in place):
- Mounts `${HOME}/.config/gcloud` read-only into the container, so the container sees the host's ADC.
- Sets `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT=${GCP_PROJECT:?Set GCP_PROJECT to a non-production project}`, `GOOGLE_CLOUD_LOCATION=global` — the `@google/genai` SDK auto-detects these three env vars when no explicit client config is passed (this is how `agent.ts`'s `LlmAgent` picks up Vertex AI without any code wiring). `GCP_PROJECT` must be set explicitly; compose fails fast if it is missing.

**Run it:**

```bash
GCP_PROJECT=your-dev-project docker compose -f docker-compose.local.yml up -d
```

Caveat: local runs call real Vertex AI and bill whichever GCP project you set via `GCP_PROJECT`. Use a non-production project (the compose file enforces this by requiring `GCP_PROJECT` and suggesting a non-production value in its error message).