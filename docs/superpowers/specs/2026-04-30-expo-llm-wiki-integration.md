# Spec: expo-llm-wiki Integration — Replace Custom Wiki Memory

**Date:** 2026-04-30
**Status:** Ready
**Branch:** feature branch off `staging`
**Depends on:**
- [expo-llm-wiki: agent-memory-features](https://github.com/equationalapplications/expo-llm-wiki/docs/superpowers/specs/2026-04-30-agent-memory-features.md) — porter stemmer + synonymMap + LWW merge — **Status: Ready**
- [expo-llm-wiki: ingest-perf-and-export](https://github.com/equationalapplications/expo-llm-wiki/docs/superpowers/specs/2026-04-30-ingest-perf-and-export.md) — exportDump / importDump / WikiBusyError / getEntityStatus — **Status: Implemented**
- [expo-llm-wiki: next-version-improvements](https://github.com/equationalapplications/expo-llm-wiki/docs/superpowers/specs/2026-05-01-next-version-improvements.md) — formatContext / hasChanged / runPrune / schema versioning — **Status: Ready**

**Replaces:** [2026-04-24-llm-wiki-memory.md](./2026-04-24-llm-wiki-memory.md) (original wiki memory design)

---

## Problem

The original wiki memory spec ([2026-04-24-llm-wiki-memory.md](./2026-04-24-llm-wiki-memory.md)) was designed and partially implemented before `expo-llm-wiki` existed as a standalone package. The result is a large amount of custom infrastructure in clanker that duplicates what the package now provides:

- Custom SQLite tables (`wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms`)
- Custom data-access layer (`wikiDatabase.ts`, `agentTaskDatabase.ts`, `memoryEventDatabase.ts`, `derivedSynonymDatabase.ts`)
- Custom FTS5 query builder + synonym pipeline (`ftsQueryBuilder.ts`, `synonymMapBase.ts`)
- 4 Firebase callables (`memoryRead`, `memoryWrite`, `memoryHeal`, `memoryForget`) that duplicate package logic on the server
- `wikiHealMachine.ts` state machine wrapping those callables
- 162 handler tests in `functions/src/memoryFunctions.test.js`
- `compromise` dependency (lemmatizer) — package porter stemmer makes it redundant

This spec replaces all of the above with `expo-llm-wiki` used as-is, adding only what the package cannot provide: a cloud sync callable and a curated synonym map. The agent-memory-features spec (porter stemmer, synonymMap, LWW merge) is maintained in the expo-llm-wiki repo and referenced here.

---

## Goals

- Replace all custom wiki DB/service/callable code with `expo-llm-wiki`.
- One new callable: `wikiSync` (cloud mirror via `exportDump` / `importDump`).
- LLM inference stays server-side: `llmProvider.generateText` proxies through an auth-gated callable.
- `characters.context` unchanged — existing summary flow runs for all users in parallel.
- All premium users get wiki memory (local SQLite via package).
- Cloud sync only for `save_to_cloud=1` premium characters.
- Schema version bump covers the package table setup; no manual migration SQL needed for the wiki tables (package owns them via `wiki.setup()`).
- Document ingest via the + button: skip unchanged files via `hasChanged`; surface `WikiBusyError` on concurrent upload.
- Inline chat UI indicators for `ingesting` and `librarian` states via `getEntityStatus`.
- `runPrune` called post-sync in `characterSyncService` to hard-delete aged soft-deleted rows and old events.
- `useWikiExport` hook drives the user-initiated cloud sync button for correct fresh-snapshot LWW semantics.
- `npm run typecheck && npm run lint && npm run test` green after migration.

## Non-Goals

- Changing how `characters.context` / `triggerConversationSummary` works.
- Moving librarian inference on-device (deferred to v2, same as original spec).
- No dedicated wiki management or memory browser screen. Inline status indicators and upload skip notification are the only new UI additions.
- `memoryPatch` / direct agent write mid-turn (still deferred).
- `formatMemoryDump` / backup export UI (deferred).

---

## Architecture

### LLM Provider Bridge

The package requires a `generateText` function. clanker provides it by wrapping the existing `generateReply`-adjacent callable infrastructure:

```ts
// src/services/wikiLlmProvider.ts  (new, tiny)
import { httpsCallable } from 'firebase/functions';
import { functionsInstance } from '~/config/firebaseConfig';

// Reuse existing appCheckReady pattern from chatReplyService
export function createWikiLlmProvider(appCheck: Promise<void>) {
  return {
    generateText: async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) => {
      await appCheck;
      const fn = httpsCallable<{ systemPrompt: string; userPrompt: string }, { text: string }>(
        functionsInstance, 'wikiLlm'
      );
      const result = await fn({ systemPrompt, userPrompt });
      return result.data.text;
    },
  };
}
```

**`wikiLlm` callable** (new, thin — lives in `functions/src/wikiLlm.ts`):
- In: `{ systemPrompt: string, userPrompt: string }`
- Auth check (mirror `generateReply.ts` pattern): `request.auth` required; decode `DecodedIdToken`.
- Premium check: `usage.hasUnlimited` (same `fetchUsageState` as `generateReply`). Non-premium → `HttpsError('permission-denied')`.
- Calls Vertex AI / Gemini with the provided prompts. No model selection logic — same model as `summarizeText`.
- Returns `{ text: string }` — raw LLM response string (package handles JSON parsing).
- **Consumes no user credits.** Billing is same as `summarizeText` librarian passes.
- Exported from `functions/src/index.ts`.

### Wiki Singleton

```ts
// src/services/wikiService.ts  (new)
import { createWiki } from '@equationalapplications/expo-llm-wiki';
import { createWikiLlmProvider } from './wikiLlmProvider';
import { appCheckReady } from '~/config/firebaseConfig';
import { getDatabase } from '~/database';
import { synonymMapBase } from '~/database/synonymMapBase';  // kept (hand-curated map)

let _wiki: ReturnType<typeof createWiki> | null = null;

export function getWiki() {
  if (!_wiki) {
    _wiki = createWiki(getDatabase(), {
      llmProvider: createWikiLlmProvider(appCheckReady),
      config: {
        tablePrefix: 'llm_wiki_',
        autoLibrarianThreshold: 20,   // matches original MEMORY_WRITE_TRIGGER_MESSAGE_COUNT
        autoHealThreshold: 100,
        synonymMap: synonymMapBase,
        // chunkConcurrency: 1 (default — sequential; raise for providers with higher rate limits)
        // maxChunkLength: 12000 (package default — up from 6000 in prior versions)
        // chunkOverlap: 400 (package default)
      },
    });
  }
  return _wiki;
}

export async function setupWiki() {
  await getWiki().setup();
}
```

`setupWiki()` called once from `bootstrapSession` alongside existing DB setup. The package's `setup()` creates its tables via `CREATE TABLE IF NOT EXISTS` — idempotent, no manual migration SQL needed.

### React Provider

Package React hooks (`useWikiIngest`, `useWikiHasChanged`, `useWikiExport`, `useWikiMaintenance`, `useMemoryRead`, `useWikiWrite`, `useWikiForget`) consume a context populated by `WikiProvider`. Mount it once near the root of the app, **inside** the existing premium-aware tree so non-premium users render `null` for the wiki context (no work done):

```tsx
// src/App.tsx (or the existing root provider stack)
import { WikiProvider } from '@equationalapplications/expo-llm-wiki/react';
import { getWiki } from '~/services/wikiService';

<WikiProvider wiki={getWiki()}>
  {/* existing app tree */}
</WikiProvider>
```

All subsequent hook examples in this spec assume the provider is mounted.

### `synonymMapBase.ts`

**Kept** — the hand-curated ~150-entry map (health, relationships, work, emotions, goals) is still valuable for day-1 recall before any facts exist. It is now passed as `WikiConfig.synonymMap` instead of being used in the custom `buildFtsQuery` pipeline.

File path: `src/database/synonymMapBase.ts` → no rename needed. Export changes from the original ftsQueryBuilder shape to a plain `Record<string, string[]>`.

### Read Path

```ts
import { formatContext } from '@equationalapplications/expo-llm-wiki';

// In aiChatService.sendMessageWithAIResponse — premium users only
const bundle = await getWiki().read(character.id, userMessage);
// Format for LLM injection using package utility (next-version-improvements spec)
const memoryBlock = formatContext(bundle, {
  maxFacts: 10,
  maxTasks: 10,
  maxEvents: 10,
  includeConfidence: true,
  includeTags: true,
});
// Pass memoryBlock string to buildChatPrompt as the [MEMORY] block
```

`read()` is fully local FTS5 + porter stemmer + synonymMap expansion. <50ms. Works offline. No callable.

`formatContext` is a pure function (no DB) from the package. It ranks facts by confidence × recency × access count, tasks by priority, events newest-first. Replaces the hand-rolled bundle formatter in `buildChatPrompt`.


### Write Path (post-turn)

```ts
// In aiChatService — after reply is saved, premium users only
// Fire-and-forget (mirrors triggerConversationSummary)
getWiki().write(character.id, {
  event_type: 'observation',
  summary: `User: ${userMessage}\nAssistant: ${assistantReply}`,
}).catch(console.error);
```

The package auto-triggers `runLibrarian` (via `wikiLlm` callable) when event count hits `autoLibrarianThreshold`. No `wikiHealMachine` state machine. No explicit checkpoint management. The package owns the checkpoint in `{prefix}checkpoints`.

The auto-trigger inside `write()` uses a silent-skip when busy — it never throws into the write path. If clanker ever calls `runLibrarian()` or `runHeal()` directly, it must catch `WikiBusyError` (exported from `expo-llm-wiki`; available since ingest-perf-and-export). The current spec does not call these methods directly.


### Document Ingest (+ Button)

The + button lives in `src/components/ChatComposer.tsx` (premium users only) and currently dispatches into `src/machines/documentIngestMachine.ts` — an xstate machine that wraps the legacy `memoryIngest` callable. Both are replaced.

**Delete** `src/machines/documentIngestMachine.ts` (and its tests). The expo-llm-wiki React hooks replace the entire state machine.

**ChatComposer rewires** to use `useWikiIngest` + `useWikiHasChanged` directly:

```ts
import { useWikiIngest, useWikiHasChanged } from '@equationalapplications/expo-llm-wiki/react';
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

// Inside ChatComposer (premium users only)
const { execute: checkChanged } = useWikiHasChanged();
const { execute: ingest, isPending: isIngesting, error: ingestError } = useWikiIngest();

async function handleAttachPress() {
  const result = await DocumentPicker.getDocumentAsync({ type: 'text/*' });
  if (result.canceled) return;
  const file = result.assets[0];
  const content = await FileSystem.readAsStringAsync(file.uri);
  const sourceHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    content
  );

  const changed = await checkChanged(character.id, file.name, sourceHash);
  if (!changed) {
    showToast('Document already ingested — no changes detected');
    return;
  }

  try {
    await ingest(character.id, {
      sourceRef: file.name,
      sourceHash,
      documentChunk: content,
    });
    showToast('Document ingested');
  } catch (e) {
    if (e instanceof WikiBusyError) {
      showToast('Already processing this document — please wait');
    } else {
      throw e;
    }
  }
}
```

`sourceRef` = filename; `sourceHash` = SHA-256 hex of file content (computed via `expo-crypto`, already a project dependency — see `__tests__/documentIngestMachine.test.tsx` mock).

`useWikiHasChanged` wraps `wiki.hasChanged()` with `isPending` / `error` state. If the file hash matches what was previously ingested for this `(characterId, sourceRef)`, skip and notify the user.

`WikiBusyError` is thrown by `ingestDocument` when a concurrent ingest for the same `(entityId, sourceRef)` is in flight — handled with a user-facing toast.


### Entity Status Indicators

`getEntityStatus(entityId)` is synchronous and safe to call from a React render loop. Wire it up in the chat screen with a low-cadence poll:

```ts
// In the chat screen component (premium users only)
const [wikiStatus, setWikiStatus] = useState({ ingesting: false, librarian: false, heal: false });

useEffect(() => {
  if (!isPremium) return;
  const interval = setInterval(() => {
    setWikiStatus(getWiki().getEntityStatus(character.id));
  }, 2000);
  return () => clearInterval(interval);
}, [character.id, isPremium]);

// wikiStatus.ingesting → show "Ingesting document…" near compose bar
// wikiStatus.librarian → show subtle "Processing memories…" in chat header
// wikiStatus.heal     → no visible indicator (background, not user-facing)
```

No new screen. Inline indicators only.


### Maintenance & Prune

`runPrune` is called in `characterSyncService` after a successful `wikiSync`, using package defaults:

```ts
// After wikiSync completes (save_to_cloud=1 characters only)
try {
  await getWiki().runPrune(characterId, {
    retainSoftDeletedFor: 7,  // days — package default
    retainEventsFor: 30,      // days — matches pruneEventsAfter config key
    vacuum: false,            // too slow on mobile for routine use
  });
} catch (e) {
  if (e instanceof WikiBusyError) { /* defer to next sync cycle */ }
  else throw e;
}
```

Also exposed via `useWikiMaintenance` (package hook extended with `runPrune` in next-version-improvements) for optional developer/settings screen use.


### Cloud Sync — Manual, Last-Write-Wins

Character wiki memory cloud sync is **user-initiated only** via a sync button on the character screen. It is not automatic or triggered by background processes.

**Sync flow (Last-Write-Wins semantics):**

1. User presses sync button → `useWikiExport` hook captures a fresh local snapshot via `wiki.exportDump([characterId])`.
2. Client sends snapshot to `wikiSync` callable on the server.
3. Server uses **last-write-wins (LWW) by `updated_at`**: for each fact/task, if the local row has `updated_at` newer than the incoming row, local wins (server keeps it); if incoming is newer, incoming overwrites. Events are append-only.
4. Server returns the merged state from Cloud SQL.
5. Client merges the returned state back locally via `wiki.importDump(remoteDump, { merge: true })`, which also uses LWW.

**Result:** Local and cloud are eventually consistent. Whichever version of a fact was edited most recently (highest `updated_at`) wins on both sides.

**Example:**
- Local fact `id=X` has `updated_at=1000`; cloud fact `id=X` has `updated_at=800`.
- Client sends local snapshot to server. Server sees incoming `updated_at=1000 > cloud.updated_at=800` → overwrites cloud row with local version.
- Server returns merged bundle (cloud fact now has `updated_at=1000`).
- Client calls `importDump` with merge=true. Local already has `updated_at=1000`; incoming is equal, so local is unchanged. Both sides now agree.

---

**Implementation:** `wikiSync` callable in `functions/src/wikiSync.ts`:

**Request:** `{ characterId: string, dump: MemoryDump }`

Where `MemoryDump = { generatedAt: number, entities: Record<string, MemoryBundle> }` — output of `wiki.exportDump([characterId])`.

**Server logic:**
1. Auth check + premium check + `save_to_cloud=1` check (character lookup).
2. **LWW upsert** to Cloud SQL: for each incoming fact/task by `id`, if no cloud row exists, insert it. If cloud row exists and incoming `updated_at > cloud.updated_at`, overwrite the cloud row. Otherwise, keep the cloud row. Events are append-only by id (no `updated_at` for events).
3. Fetch full merged bundle for character from Cloud SQL (includes cloud-only rows that were not in the local snapshot).
4. Return `{ remoteDump: MemoryDump }` — the authoritative cloud state after merge.

**Background sync (automatic, separate from user-initiated sync):**

The background character sync in `characterSyncService` also syncs wiki memory when `save_to_cloud=1`, using the same `wikiSync` callable. This happens on the same cadence as other character data syncs (~every 5 min or on app resume). It is fire-and-forget and does not block the UI.

**User-initiated sync (manual, via sync button):**

When the user explicitly presses the character sync button, it:
1. Uses `useWikiExport` to capture the freshest local snapshot (all pending writes flushed).
2. Calls `wikiSync` with that snapshot.
3. Receives the merged cloud state.
4. Calls `wiki.importDump(remoteDump, { merge: true })` to pull any cloud-only changes back down to local.

```ts
import { useWikiExport } from '@equationalapplications/expo-llm-wiki/react';

const { execute: exportWiki, isPending: isExporting } = useWikiExport();

async function handleSyncPress() {
  const dump = await exportWiki([character.id]); // fresh snapshot, captures all pending writes
  const { data } = await wikiSyncFn({ characterId: character.id, dump });
  await getWiki().importDump(data.remoteDump, { merge: true }); // LWW by updated_at
}
```

`useWikiExport` ensures the snapshot reflects all local writes completed before the button press, and its `isPending` state drives the button's disabled/loading state.

**Non-premium or `save_to_cloud=0` characters:** skip wiki sync entirely (both background and user-initiated).

---

## Schema

### Package tables (owned by expo-llm-wiki, created by `wiki.setup()`)

- `llm_wiki_entries` — facts
- `llm_wiki_tasks` — tasks
- `llm_wiki_events` — episodic events
- `llm_wiki_checkpoints` — librarian + heal checkpoint per entity
- `llm_wiki_entries_fts` — FTS5 virtual table (porter unicode61 tokenizer)
- `llm_wiki_meta` — schema version key/value store (added in next-version-improvements; `setup()` creates it idempotently)

No `MIGRATIONS` entries needed in clanker's `schema.ts` for these — package manages them via its own migration registry. The `resolution_note` field will not be implemented.


### Cloud SQL (Drizzle, `functions/src/db/schema.ts`)

New tables mirroring the package schema, FK to `characters.id` / `users.id`:

```ts
export const wikiEntries = pgTable('wiki_entries', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: jsonb('tags').notNull().default('[]'),
  confidence: text('confidence').notNull().default('inferred'),
  source_type: text('source_type').notNull().default('agent_inferred'),
  source_hash: text('source_hash'),
  source_ref: text('source_ref'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
  last_accessed_at: bigint('last_accessed_at', { mode: 'number' }),
  access_count: integer('access_count').notNull().default(0),
  deleted_at: bigint('deleted_at', { mode: 'number' }),
  // tsvector for Cloud SQL FTS (GIN index)
  search_vector: tsvector('search_vector').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(tags::text,''))`
  ),
});

export const wikiTasks = pgTable('wiki_tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  // resolution_note is not implemented
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
  resolved_at: bigint('resolved_at', { mode: 'number' }),
  deleted_at: bigint('deleted_at', { mode: 'number' }),
});

export const wikiEvents = pgTable('wiki_events', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  event_type: text('event_type').notNull(),
  summary: text('summary').notNull(),
  related_entry_id: text('related_entry_id'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});
```

Indexes: GIN on `search_vector`; `(character_id)` on all three tables. Generate migration via `cd functions && npm run db:generate && npm run migrate` (see `/memories/repo/cloud-sql-migrations.md`).

---

## Files Touched


### Deleted
- `src/database/wikiDatabase.ts`
- `src/database/agentTaskDatabase.ts`
- `src/database/memoryEventDatabase.ts`
- `src/database/derivedSynonymDatabase.ts`
- `src/database/ftsQueryBuilder.ts`
- `src/services/memoryService.ts`
- `src/machines/wikiHealMachine.ts`
- `src/machines/documentIngestMachine.ts` (replaced by `useWikiIngest` + `useWikiHasChanged` directly in `ChatComposer`)
- `functions/src/memoryFunctions.ts` (and split files: `memoryRead.ts`, `memoryWrite.ts`, `memoryHeal.ts`, `memoryForget.ts`, `syncCharacterMemory.ts`, `memoryIngest.ts` if present)
- `__tests__/wikiDatabase.test.ts`, `__tests__/ftsQueryBuilder.test.ts`, `__tests__/wikiHealMachine.test.ts`, `__tests__/documentIngestMachine.test.tsx`
- `functions/lib/memoryFunctions.test.js` (162 handler tests — covered by new `wikiLlm`/`wikiSync` tests)


### New
- `src/services/wikiService.ts` — wiki singleton + `setupWiki()`
- `src/services/wikiLlmProvider.ts` — `createWikiLlmProvider(appCheckReady)`
- `functions/src/wikiLlm.ts` — thin LLM proxy callable + handler
- `functions/src/wikiSync.ts` — cloud sync callable + handler
- `functions/drizzle/000X_wiki_tables.sql` — generated by `db:generate`
- `__tests__/wikiService.test.ts` — read/write/sync/ingest/prune integration tests
- `functions/src/wikiLlm.test.ts` — auth gate, premium gate, Vertex proxy
- `functions/src/wikiSync.test.ts` — upsert, fetch, merge, auth guards


### Modified
- `src/database/synonymMapBase.ts` — change export to `Record<string, string[]>` (same terms, new shape)
- `src/services/aiChatService.ts` — replace `fetchMemoryBundle` + `wikiHealMachine WRITE` with `wiki.read()` + `wiki.write()`; import `formatContext` from `@equationalapplications/expo-llm-wiki` and replace manual bundle formatting in `buildChatPrompt` with `formatContext(bundle)`.
- `src/database/schema.ts` — remove `wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms` from `CREATE_TABLES`, `MIGRATIONS`, `MIGRATION_SKIP_GUARDS`, `LATEST_SCHEMA_REQUIRED_COLUMNS`. Remove `heal_checkpoint`/`memory_checkpoint` columns from `characters` additions (package owns checkpoints in `llm_wiki_checkpoints`). Bump `SCHEMA_VERSION` to next integer (e.g. `12`); add `MIGRATIONS[12]` that `DROP TABLE IF EXISTS`es `wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms` and runs `ALTER TABLE characters DROP COLUMN IF EXISTS heal_checkpoint, DROP COLUMN IF EXISTS memory_checkpoint` (SQLite does not support `DROP COLUMN` prior to 3.35 — use `PRAGMA table_info` + recreate pattern if needed, or simply leave the columns as harmless dead weight and skip the ALTER). Add `MIGRATION_SKIP_GUARDS[12]` checking `wiki_entries` does not exist.
- `src/database/index.ts` — call `setupWiki()` in `bootstrapSession` after existing DB setup.
- `src/services/characterSyncService.ts` — add `wikiSync` callable invocation alongside existing character sync; add `runPrune` call after successful sync; catch `WikiBusyError` from prune and defer to next cycle.
- `src/config/firebaseConfig.ts` — remove 4 old callables (`memoryRead`, `memoryWrite`, `memoryHeal`, `memoryForget`, `syncCharacterMemory`); add `wikiLlm`, `wikiSync` (only these two callables are required for wiki memory).
- `functions/src/index.ts` — export `wikiLlm`, `wikiSync`; remove old memory exports.
- `functions/src/db/schema.ts` — add `wikiEntries`, `wikiTasks`, `wikiEvents` Drizzle tables.
- `package.json` — add `@equationalapplications/expo-llm-wiki`; remove `compromise`. (`expo-document-picker`, `expo-file-system`, `expo-crypto` already present.)
- **`src/components/ChatComposer.tsx`** (the + button) — replace `documentIngestMachine` invocation with `useWikiHasChanged` + `useWikiIngest`; notify user on unchanged file; catch `WikiBusyError` and surface to user.
- **Chat screen component** — add `getEntityStatus` polling (2s interval, premium only); render inline `ingesting` and `librarian` indicators.
- **Character sync button / screen** — use `useWikiExport` hook; wire `isPending` to button disabled/loading state; pass export result to `wikiSync` callable then `importDump` with merge=true.
- **App root** — mount `WikiProvider` from `@equationalapplications/expo-llm-wiki/react` once, inside the existing provider stack.


### Unchanged
- `src/services/aiChatService.ts` `triggerConversationSummary` path — runs for all users, untouched.
- `generateReply` callable — unchanged.
- `summarizeText` callable — unchanged.
- `characters.context` column — unchanged.

---


## Wire-up: `aiChatService.sendMessageWithAIResponse`

```
Pre-turn  (premium only):

  bundle = await getWiki().read(character.id, userMessage)
  memoryBlock = formatContext(bundle)   // pure fn, no I/O — replaces manual bundle format
  → inject memoryBlock into buildChatPrompt as [MEMORY] block

Reply:
  existing generateChatReply flow unchanged

Post-turn (all users):
  triggerConversationSummary(character, userId)   ← unchanged

Post-turn (premium only, fire-and-forget):

  getWiki().write(character.id, {
    event_type: 'observation',
    summary: `${userMessage}\n${assistantReply}`,
  }).catch(console.error)
  // Package auto-triggers wikiLlm callable at threshold — no explicit machine
  // Auto-trigger is silent-skip when busy; never throws into write path
```

---


## Tests

### `__tests__/wikiService.test.ts`

Mock `@equationalapplications/expo-llm-wiki` via `jest.mock('@equationalapplications/expo-llm-wiki', ...)`. Assert:
- `setupWiki()` calls `wiki.setup()` once.
- `wiki.read()` called pre-turn for premium users; skipped for non-premium.
- `wiki.write()` called post-turn for premium users with correct `event_type` and summary.
- `wiki.write()` failure is swallowed (fire-and-forget).
- Background sync: `wiki.exportDump()` → `wikiSync` callable → `wiki.importDump()` called with merge=true.
- `runPrune` called after successful sync with correct retention options; `WikiBusyError` from prune is caught and does not abort the sync.
- `hasChanged` returns false → `ingestDocument` not called; user notified.
- `hasChanged` returns true → `ingestDocument` called with correct `sourceRef` and `sourceHash`.
- `WikiBusyError` from concurrent ingest is caught and surfaced (not swallowed).
- `getEntityStatus` returns `ingesting: true` while ingest is in flight for the entity.

### `functions/src/wikiLlm.test.ts`

Node `node:test` pattern (see `/memories/repo/clanker-functions-notes.md`). Mock auth + Vertex. Assert:
- Unauthenticated request → `unauthenticated` error.
- Non-premium user → `permission-denied` error.
- Premium user → calls Vertex with provided prompts; returns `{ text: string }`.
- No credits deducted.


### `functions/src/wikiSync.test.ts`

Assert:
- Unauthenticated → error.
- Non-premium → error.
- `save_to_cloud=0` character → skips Cloud SQL write, returns empty remoteDump.
- Premium + `save_to_cloud=1` → upserts entries/tasks/events; returns full bundle.
- `importDump` merge: last-write-wins (LWW) by `updated_at` for all entities; existing local facts are only overwritten if remote has newer `updated_at`.

---

## Acceptance Criteria

- [ ] `@equationalapplications/expo-llm-wiki` installed; `compromise` removed from `package.json`
- [ ] `WikiProvider` mounted once near app root from `@equationalapplications/expo-llm-wiki/react`
- [ ] `wiki.setup()` called in `bootstrapSession`; package tables created idempotently (including `llm_wiki_meta`)
- [ ] `synonymMapBase.ts` exports `Record<string, string[]>`; passed as `WikiConfig.synonymMap`
- [ ] `wiki.read()` used pre-turn for premium users; `bundle` formatted via `formatContext()` and injected as [MEMORY] block
- [ ] `wiki.write()` called fire-and-forget post-turn for premium users; auto-trigger never throws (`WikiBusyError` only surfaces on explicit `runLibrarian()`/`runHeal()` calls)
- [ ] `wikiLlm` callable: auth + premium gated; proxies prompts to Vertex; no credits deducted
- [ ] `wikiSync` callable: auth + premium + `save_to_cloud=1` gated; **LWW upsert** to Cloud SQL by `id` and `updated_at`; returns merged remoteDump
- [ ] Background sync: `wikiSync` called from `characterSyncService` on existing cadence (~every 5 min or on resume)
- [ ] User-initiated sync: sync button uses `useWikiExport` hook to capture fresh snapshot; calls `wikiSync` callable; merges result back locally via `importDump` with merge=true
- [ ] All 4 old memory callables removed from `firebaseConfig.ts` and `functions/src/index.ts`
- [ ] `wikiHealMachine`, `documentIngestMachine`, `wikiDatabase`, `agentTaskDatabase`, `memoryEventDatabase`, `derivedSynonymDatabase`, `ftsQueryBuilder`, old `memoryService` deleted
- [ ] Cloud SQL Drizzle migration generated and applied for `wiki_entries`, `wiki_tasks`, `wiki_events`
- [ ] + button upload: `useWikiHasChanged` checked before `useWikiIngest`; unchanged file → user notified, ingest skipped; `WikiBusyError` on concurrent upload surfaced to user
- [ ] Chat screen shows inline `ingesting` indicator during document upload; shows inline `librarian` indicator during background memory processing; `heal` state has no visible indicator
- [ ] `runPrune` called in `characterSyncService` after successful `wikiSync`; `WikiBusyError` caught and deferred to next cycle; returns row counts (logged, not surfaced to user)
- [ ] Manual sync button: uses `useWikiExport`; `isPending` disables button; **LWW merge** reconciles local/cloud by `updated_at`; result re-imported locally via `importDump` with merge=true
- [ ] Background sync: `wikiSync` called from `characterSyncService` on existing cadence (~5 min); non-premium or `save_to_cloud=0` characters skip; uses same **LWW semantics** as user-initiated sync
- [ ] `npm run typecheck && npm run lint && npm run test` green
- [ ] `cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/wikiLlm.test.js lib/wikiSync.test.js` green
