# Spec: expo-llm-wiki Integration — Replace Custom Wiki Memory

**Date:** 2026-04-30
**Status:** Ready
**Branch:** feature branch off `staging`
**Depends on:** [expo-llm-wiki v1.x agent-memory-features](https://github.com/equationalapplications/expo-llm-wiki/docs/superpowers/specs/2026-04-30-agent-memory-features.md) (porter stemmer + synonymMap — must ship first; see that repo for the full agent memory spec)
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
- `npm run typecheck && npm run lint && npm run test` green after migration.

## Non-Goals

- Changing how `characters.context` / `triggerConversationSummary` works.
- Moving librarian inference on-device (deferred to v2, same as original spec).
- Any new UI surface for wiki memory.
- `memoryPatch` / direct agent write mid-turn (still deferred).

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
import { createWiki } from 'expo-llm-wiki';
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

### `synonymMapBase.ts`

**Kept** — the hand-curated ~150-entry map (health, relationships, work, emotions, goals) is still valuable for day-1 recall before any facts exist. It is now passed as `WikiConfig.synonymMap` instead of being used in the custom `buildFtsQuery` pipeline.

File path: `src/database/synonymMapBase.ts` → no rename needed. Export changes from the original ftsQueryBuilder shape to a plain `Record<string, string[]>`.

### Read Path

```ts
// In aiChatService.sendMessageWithAIResponse — premium users only
const bundle = await getWiki().read(character.id, userMessage);
// bundle: { facts: WikiFact[], tasks: WikiTask[], events: WikiEvent[] }
// Pass to buildChatPrompt as before
```

`read()` is fully local FTS5 + porter stemmer + synonymMap expansion. <50ms. Works offline. No callable.

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


### Cloud Sync

New `wikiSync` callable in `functions/src/wikiSync.ts`:

**Request:** `{ characterId: string, dump: MemoryDump }`

Where `MemoryDump = { generatedAt: number, entities: Record<string, MemoryBundle> }` — output of `wiki.exportDump([characterId])`.

**Server logic:**
1. Auth check + premium check + `save_to_cloud=1` check (character lookup).
2. Upsert `dump.entities[characterId]` entries, tasks, events to Cloud SQL wiki tables using last-write-wins (LWW) by `updated_at` for all entities. This means that if an incoming row has a newer `updated_at` than the existing row, it overwrites; otherwise, it is skipped. This applies to all imported bundles, not just new IDs.
3. Fetch full bundle for character from Cloud SQL.
4. Return `{ remoteDump: MemoryDump }`.

**Client:**
```ts
const { data } = await wikiSyncFn({ characterId, dump: await wiki.exportDump([characterId]) });
await wiki.importDump(data.remoteDump, { merge: true }); // merge uses LWW by updated_at
```

Triggered from `characterSyncService` on same cadence as `syncAllToCloud`. Non-premium or `save_to_cloud=0` characters skip this call.

---

## Schema

### Package tables (owned by expo-llm-wiki, created by `wiki.setup()`)

- `llm_wiki_entries` — facts
- `llm_wiki_tasks` — tasks
- `llm_wiki_events` — episodic events
- `llm_wiki_checkpoints` — librarian + heal checkpoint per entity
- `llm_wiki_entries_fts` — FTS5 virtual table (porter unicode61 tokenizer)

No `MIGRATIONS` entries needed in clanker's `schema.ts` for these — package manages them. The `resolution_note` field is not present; task resolution notes are deferred/cancelled for now (see agent-memory-features spec in expo-llm-wiki repo).


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
  // resolution_note field removed; see agent-memory-features spec for future plans
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
- `functions/src/memoryFunctions.ts` (and split files: `memoryRead.ts`, `memoryWrite.ts`, `memoryHeal.ts`, `memoryForget.ts`, `syncCharacterMemory.ts`)
- `__tests__/wikiDatabase.test.ts`, `__tests__/ftsQueryBuilder.test.ts`, `__tests__/wikiHealMachine.test.ts`
- `functions/lib/memoryFunctions.test.js` (162 handler tests — covered by new `wikiLlm`/`wikiSync` tests)


### New
- `src/services/wikiService.ts` — wiki singleton + `setupWiki()`
- `src/services/wikiLlmProvider.ts` — `createWikiLlmProvider(appCheckReady)`
- `functions/src/wikiLlm.ts` — thin LLM proxy callable + handler
- `functions/src/wikiSync.ts` — cloud sync callable + handler
- `functions/drizzle/000X_wiki_tables.sql` — generated by `db:generate`
- `__tests__/wikiService.test.ts` — read/write/sync integration tests
- `functions/src/wikiLlm.test.ts` — auth gate, premium gate, Vertex proxy
- `functions/src/wikiSync.test.ts` — upsert, fetch, merge, auth guards


### Modified
- `src/database/synonymMapBase.ts` — change export to `Record<string, string[]>` (same terms, new shape)
- `src/database/schema.ts` — remove `wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms` from `CREATE_TABLES`, `MIGRATIONS`, `MIGRATION_SKIP_GUARDS`, `LATEST_SCHEMA_REQUIRED_COLUMNS`. Remove `heal_checkpoint`/`memory_checkpoint` columns from `characters` additions (package owns checkpoints in `llm_wiki_checkpoints`). Bump `SCHEMA_VERSION` to next integer (e.g. `12`); add `MIGRATIONS[12]` that `DROP TABLE IF EXISTS`es `wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms` and runs `ALTER TABLE characters DROP COLUMN IF EXISTS heal_checkpoint, DROP COLUMN IF EXISTS memory_checkpoint` (SQLite does not support `DROP COLUMN` prior to 3.35 — use `PRAGMA table_info` + recreate pattern if needed, or simply leave the columns as harmless dead weight and skip the ALTER). Add `MIGRATION_SKIP_GUARDS[12]` checking `wiki_entries` does not exist.
- `src/database/index.ts` — call `setupWiki()` in `bootstrapSession` after existing DB setup.
- `src/services/aiChatService.ts` — replace `fetchMemoryBundle` + `wikiHealMachine WRITE` with `wiki.read()` + `wiki.write()`.
- `src/services/characterSyncService.ts` — add `wikiSync` callable invocation alongside existing character sync.
- `src/config/firebaseConfig.ts` — remove 4 old callables (`memoryRead`, `memoryWrite`, `memoryHeal`, `memoryForget`, `syncCharacterMemory`); add `wikiLlm`, `wikiSync` (only these two callables are required for wiki memory).
- `functions/src/index.ts` — export `wikiLlm`, `wikiSync`; remove old memory exports.
- `functions/src/db/schema.ts` — add `wikiEntries`, `wikiTasks`, `wikiEvents` Drizzle tables.
- `package.json` — add `expo-llm-wiki`; remove `compromise`.


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
  → build [MEMORY] block via buildChatPrompt (unchanged format from original spec)

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
```

---


## Tests

### `__tests__/wikiService.test.ts`

Mock `expo-llm-wiki` via `jest.mock('expo-llm-wiki', ...)`. Assert:
- `setupWiki()` calls `wiki.setup()` once.
- `wiki.read()` called pre-turn for premium users; skipped for non-premium.
- `wiki.write()` called post-turn for premium users with correct `event_type` and summary.
- `wiki.write()` failure is swallowed (fire-and-forget).
- Cloud sync: `wiki.exportDump()` → `wikiSync` callable → `wiki.importDump()` called with merge=true.

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

- [ ] `expo-llm-wiki` installed; `compromise` removed from `package.json`
- [ ] `wiki.setup()` called in `bootstrapSession`; package tables created idempotently
- [ ] `synonymMapBase.ts` exports `Record<string, string[]>`; passed as `WikiConfig.synonymMap`
- [ ] `wiki.read()` used pre-turn for premium users; `bundle` injected into `buildChatPrompt`
- [ ] `wiki.write()` called fire-and-forget post-turn for premium users
- [ ] `wikiLlm` callable: auth + premium gated; proxies prompts to Vertex; no credits deducted
- [ ] `wikiSync` callable: auth + premium + `save_to_cloud=1` gated; upserts to Cloud SQL; returns remoteDump
- [ ] `characterSyncService` calls `wikiSync` alongside existing character sync
- [ ] All 4 old memory callables removed from `firebaseConfig.ts` and `functions/src/index.ts`
- [ ] `wikiHealMachine`, `wikiDatabase`, `agentTaskDatabase`, `memoryEventDatabase`, `derivedSynonymDatabase`, `ftsQueryBuilder`, old `memoryService` deleted
- [ ] Cloud SQL Drizzle migration generated and applied for `wiki_entries`, `wiki_tasks`, `wiki_events`
- [ ] `npm run typecheck && npm run lint && npm run test` green
- [ ] `cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/wikiLlm.test.js lib/wikiSync.test.js` green
