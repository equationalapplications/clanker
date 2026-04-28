# Document Ingest (Wiki Memory v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add premium-gated user document ingest so characters can be seeded with knowledge from .txt/.md files.

**Architecture:** Client picks file → reads as UTF-8 → SHA-256 hash → `documentExtract` Firebase Callable extracts facts server-side → `documentIngestMachine` writes extracted `wiki_entries` with `source_type='user_document'` to local SQLite → `memoryHeal` treats these as immutable anchors.

**Tech Stack:** XState v5, expo-document-picker, expo-crypto, expo-file-system, Firebase Callable (Vertex AI Gemini), Drizzle ORM (Cloud SQL), SQLite (expo-sqlite).

**Schema version correction:** The spec says "bump 11→12" but `SCHEMA_VERSION` is already `12`. All tasks that reference migration 12 must use migration **13** instead.

---

## Key Files Reference

- `src/database/schema.ts` — SQLite schema, migrations, SCHEMA_VERSION
- `src/database/wikiDatabase.ts` — LocalWikiEntry, DB query functions
- `src/services/memoryService.ts` — forgetMemory, triggerMemoryWrite
- `src/services/documentIngestService.ts` — NEW: thin callable wrapper
- `src/machines/documentIngestMachine.ts` — NEW: XState v5 machine
- `src/components/ChatComposer.tsx` — add + button, progress bar
- `src/components/composer/IngestProgressBar.tsx` — NEW: progress bar
- `src/config/firebaseConfig.ts` — register documentExtractFn callable
- `functions/src/documentExtract.ts` — NEW: Firebase Callable handler
- `functions/src/db/schema.ts` — Drizzle Cloud SQL schema
- `functions/src/memoryFunctions.ts` — memoryForget + memoryHeal skip logic
- `functions/src/index.ts` — export documentExtract callable

---

## Task 1: SQLite schema migration (schema.ts)

**Goal:** Bump `SCHEMA_VERSION` to 13, add `source_hash` and `source_ref` columns to `wiki_entries`.

**Files:** `src/database/schema.ts`

- [ ] Read `src/database/schema.ts` in full to understand current state (SCHEMA_VERSION=12, MIGRATIONS, MIGRATION_SKIP_GUARDS, LATEST_SCHEMA_REQUIRED_COLUMNS, CREATE_TABLES)
- [ ] Bump `SCHEMA_VERSION` from `12` to `13`
- [ ] Add `MIGRATIONS[13]`:
  ```sql
  ALTER TABLE wiki_entries ADD COLUMN source_hash TEXT;
  ALTER TABLE wiki_entries ADD COLUMN source_ref TEXT;
  CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash) WHERE source_hash IS NOT NULL;
  ```
  Note: SQLite does not support partial indexes via `CREATE INDEX ... WHERE`. Instead use a regular index: `CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash);`
- [ ] Add `MIGRATION_SKIP_GUARDS[13]`:
  ```typescript
  13: { table: 'wiki_entries', column: 'source_hash' },
  ```
- [ ] Add `'wiki_entries'` entry to `LATEST_SCHEMA_REQUIRED_COLUMNS`:
  ```typescript
  wiki_entries: ['source_hash', 'source_ref'],
  ```
- [ ] Update `CREATE_TABLES` SQL: add `source_hash TEXT` and `source_ref TEXT` columns to the `wiki_entries` CREATE TABLE statement
- [ ] Run `npm run typecheck` at the workspace root; fix any errors
- [ ] Run `npm run test -- --testPathPattern="databaseSchema"` to run schema tests
- [ ] Commit: `feat(schema): bump SCHEMA_VERSION to 13, add source_hash/source_ref to wiki_entries`

---

## Task 2: wikiDatabase.ts extensions

**Goal:** Extend `LocalWikiEntry`, `WikiEntryUpsertInput`, `source_type` union, `upsertWikiEntries`, and add new DB functions for document ingest.

**Files:** `src/database/wikiDatabase.ts`, `__tests__/wikiDatabase.test.ts`

- [ ] Read `src/database/wikiDatabase.ts` in full
- [ ] Read `__tests__/wikiDatabase.test.ts` in full (to understand test patterns)
- [ ] Extend `LocalWikiEntry` interface — add `source_hash: string | null` and `source_ref: string | null`
- [ ] Extend `source_type` in `LocalWikiEntry` to include `'user_document'`: `'user_stated' | 'agent_inferred' | 'user_confirmed' | 'user_document'`
- [ ] Extend `WikiEntryUpsertInput` — add optional `sourceHash?: string | null` and `sourceRef?: string | null`, and update `sourceType` to include `'user_document'`
- [ ] Update `upsertWikiEntries` — add `source_hash` and `source_ref` to the INSERT column list and bind params; add them to `ON CONFLICT DO UPDATE SET` clause; default both to `null`
- [ ] Add `findEntriesByHash(characterId, hash)`:
  ```typescript
  export async function findEntriesByHash(characterId: string, hash: string): Promise<LocalWikiEntry[]>
  // SELECT * FROM wiki_entries WHERE character_id=? AND source_hash=? AND deleted_at IS NULL
  ```
- [ ] Add `findEntriesBySourceRef(characterId, sourceRef)`:
  ```typescript
  export async function findEntriesBySourceRef(characterId: string, sourceRef: string): Promise<LocalWikiEntry[]>
  // SELECT * FROM wiki_entries WHERE character_id=? AND source_ref=? AND deleted_at IS NULL
  ```
- [ ] Add `bulkInsertEntries(entries: WikiEntryUpsertInput[])`:
  ```typescript
  export async function bulkInsertEntries(entries: WikiEntryUpsertInput[]): Promise<void>
  // Wraps upsertWikiEntries in a single transaction — use db.withTransactionAsync wrapping upsertWikiEntries calls
  // Actually since upsertWikiEntries already uses withTransactionAsync, call it directly; but for true atomicity, open a single outer transaction using db.withTransactionAsync and insert individually (mirror upsertWikiEntries but as a single outer transaction).
  ```
  Implementation: open one `db.withTransactionAsync` transaction, run all INSERTs inside it (copy INSERT logic from `upsertWikiEntries`). On error, transaction rolls back fully.
- [ ] Add `softDeleteWikiEntriesBySourceRef(characterId, userId, sourceRef)`:
  ```typescript
  export async function softDeleteWikiEntriesBySourceRef(characterId: string, userId: string, sourceRef: string): Promise<number>
  // UPDATE wiki_entries SET deleted_at=?, updated_at=?, synced_to_cloud=0 WHERE character_id=? AND user_id=? AND source_ref=? AND deleted_at IS NULL
  ```
- [ ] Write tests in `__tests__/wikiDatabase.test.ts`:
  - `findEntriesByHash` returns only rows for matching `character_id` and `source_hash`
  - `findEntriesBySourceRef` returns only rows for matching `character_id` and `source_ref`
  - `bulkInsertEntries` calls `withTransactionAsync` once and inserts all entries
  - `bulkInsertEntries` on simulated mid-insert error: entire call rejects (transaction rolls back — mock `runAsync` to throw on second call, assert mock call count)
  - `softDeleteWikiEntriesBySourceRef` does not touch rows for other source_ref values
- [ ] Run `npm run test -- --testPathPattern="wikiDatabase"` and confirm passing
- [ ] Run `npm run typecheck`
- [ ] Commit: `feat(db): extend wikiDatabase with source_hash/source_ref, add bulk insert and find-by-hash/ref`

---

## Task 3: Cloud SQL Drizzle schema + migration

**Goal:** Mirror the `source_hash` and `source_ref` columns on the Cloud SQL `wiki_entries` table and update the `sourceTypeCheck` constraint.

**Files:** `functions/src/db/schema.ts`, generated migration file

- [ ] Read `functions/src/db/schema.ts` to understand current `wikiEntries` table definition
- [ ] Add `sourceHash: text('source_hash')` (nullable) to `wikiEntries` table
- [ ] Add `sourceRef: text('source_ref')` (nullable) to `wikiEntries` table
- [ ] Add an index on `(characterId, sourceHash)`:
  ```typescript
  sourceHashIdx: index('wiki_entries_source_hash_idx').on(table.characterId, table.sourceHash),
  ```
- [ ] Update `sourceTypeCheck` constraint to include `'user_document'`:
  ```typescript
  sourceTypeCheck: check('wiki_entries_source_type_check', sql`${table.sourceType} IN ('user_stated', 'agent_inferred', 'user_confirmed', 'user_document')`),
  ```
- [ ] Run `cd functions && npm run db:generate` to generate the Drizzle migration. Check the repo's `/memories/repo/cloud-sql-migrations.md` for the correct commands.
- [ ] Run `cd functions && npm run typecheck` to verify no type errors
- [ ] Read the generated migration file to verify it adds the two columns and updates the constraint
- [ ] Commit: `feat(db): add source_hash/source_ref to Cloud SQL wiki_entries, update source_type constraint`

---

## Task 4: memoryForget extension + memoryHeal skip logic

**Goal:** Extend `memoryForgetHandler` to accept `sourceRef` as a forget target; modify `buildHealDiff` to skip `user_document` entries in contradiction/stale/orphan passes.

**Files:** `functions/src/memoryFunctions.ts`, `functions/src/memoryFunctions.test.ts`

- [ ] Read `functions/src/memoryFunctions.ts` focusing on: `parseForgetTargets`, `memoryForgetHandler`, `buildHealDiff` (lines ~1189-1478)
- [ ] Read `functions/src/memoryFunctions.test.ts` for test patterns
- [ ] Add `type MemoryForgetPayload` extension: add optional `sourceRef?: unknown` field (or just parse it inline)
- [ ] Modify `parseForgetTargets` to accept `sourceRef`:
  ```typescript
  function parseForgetTargets(data: unknown): {
    entryIds: string[];
    taskIds: string[];
    clearAll: boolean;
    sourceRef: string | null;
  }
  ```
  - Parse `data.sourceRef` as a string (trim, max 255 chars); null if absent
  - Update validation: if `!clearAll && entryIds.length === 0 && taskIds.length === 0 && sourceRef === null` → throw `'invalid-argument'`
- [ ] Modify `memoryForgetHandler` to handle `sourceRef` target when set:
  ```typescript
  if (targets.sourceRef !== null) {
    const rows = await db.update(wikiEntries)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(
        and(
          eq(wikiEntries.characterId, characterId),
          eq(wikiEntries.userId, identity.userId),
          eq(wikiEntries.sourceRef, targets.sourceRef),
          isNull(wikiEntries.deletedAt),
        )
      )
      .returning({ id: wikiEntries.id });
    deletedEntries += rows.length;
  }
  ```
  This handles the `sourceRef` path — note: `sourceRef` column must exist on `wikiEntries` Drizzle schema (Task 3). Also need to import the `sourceRef` field from the Drizzle schema object (it's added in Task 3).
- [ ] Modify `buildHealDiff` — add skip logic for `source_type = 'user_document'` entries:
  - Add comment at top of function: `// user_document entries are treated as immutable anchors: skipped in contradiction, stale, and orphan passes.`
  - In the `updatedEntries` map: skip the orphan check if `entry.sourceType === 'user_document'`
  - In the `updatedEntries` map: skip the stale downgrade if `entry.sourceType === 'user_document'`
  - In the contradiction pairs loop: skip flagging if either entry in the pair has `sourceType === 'user_document'`
  - The `seededEntries` (missing concepts pass) is unchanged — `user_document` entries still serve as input context

  Concrete implementation in the `.map((entry) => {...})`:
  ```typescript
  const isUserDoc = entry.sourceType === 'user_document';
  if (orphan && !isUserDoc && entry.deletedAt === null) { ... }
  if (stale && !isUserDoc && entry.confidence === 'inferred') { ... }
  if (!isUserDoc && contradictedIds.has(entry.id) && ...) { ... }
  ```
  
  For the contradiction pairs loop:
  ```typescript
  const entryA = mappedEntries.find((e) => e.id === pair.entryAId);
  const entryB = mappedEntries.find((e) => e.id === pair.entryBId);
  if (!entryA || !entryB) continue;
  // Skip if either entry is user_document (treat as authoritative anchor)
  if (entryA.sourceType === 'user_document' || entryB.sourceType === 'user_document') continue;
  ```

- [ ] Write tests in `functions/src/memoryFunctions.test.ts`:
  - `memoryForgetHandler` with `sourceRef` target: calls DB update where `source_ref = sourceRef`
  - `memoryHealHandler` with entries including `source_type='user_document'`: user_document entry NOT downgraded in stale pass, NOT deleted in orphan pass, NOT flagged in contradiction pass
  - Verify missing-concepts pass still runs for `user_document` entries (they're in the input context)
- [ ] Run `cd functions && npm run build && node --test lib/memoryFunctions.test.js`
- [ ] Run `cd functions && npm run typecheck`
- [ ] Commit: `feat(memory): extend forgetMemory with sourceRef target; heal skips user_document entries`

---

## Task 5: documentExtract Firebase Callable

**Goal:** Create the `documentExtract` Firebase Callable with all server pipeline logic: premium gate, rate limit, size cap, hash verification, character ownership, chunking, parallel LLM extraction, injection defense, field validation.

**Files:** `functions/src/documentExtract.ts` (new), `functions/src/index.ts`, `functions/src/memoryFunctions.ts` (read for patterns), `functions/src/documentExtract.test.ts` (new)

Read these files first:
- `functions/src/memoryFunctions.ts` lines 1-200 (auth patterns, dep types, defaultDeps pattern)
- `functions/src/memoryFunctions.ts` lines ~600-800 (buildWriteDiff, LLM prompt, generateContent)
- `functions/src/index.ts` (export pattern)

### Constants
```typescript
const MAX_DOCUMENT_CHARS = 200_000;
const MAX_DOCUMENTS_PER_DAY = 5;
const MAX_CHUNKS = 100;
const CHUNK_TARGET_CHARS = 2000;
const EXTRACTION_CONCURRENCY = 4;
```

### Rate limiting
Add `documentsIngestedToday: integer` and `documentsIngestedDate: text` to the subscriptions table to track daily usage. BUT since this requires a Drizzle migration, use a simpler approach: count `wiki_entries` with `source_type='user_document'` created today (where `created_at > start_of_today`) for this user. This avoids a new migration.

Alternatively, count `memory_events` with `source_ref IS NOT NULL AND summary LIKE 'Ingested document%'` created today. 

Actually the simplest serverless approach: query `wikiEntries` count for `source_type = 'user_document'` created today per user. Use: `sql`extract(epoch from date_trunc('day', now() at time zone 'UTC'))`` as a start-of-day boundary.

```typescript
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);

const [countRow] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(wikiEntries)
  .where(
    and(
      eq(wikiEntries.userId, identity.userId),
      eq(wikiEntries.sourceType, 'user_document'),
      isNull(wikiEntries.deletedAt),
      gte(wikiEntries.createdAt, todayStart),
    )
  );
const ingestedToday = countRow?.count ?? 0;
if (ingestedToday >= MAX_DOCUMENTS_PER_DAY) {
  throw new HttpsError('resource-exhausted', 'Daily document limit reached');
}
```

Note: `gte` must be imported from drizzle-orm. The `countRow` check uses a direct entry count per day rather than a separate counter — this is simpler and avoids schema migrations.

BUT wait: for a local-only character (doesn't own cloud character), we can't check Cloud SQL. In that case, skip the rate limit (user can't sync anyway) OR always enforce. The spec says "per user, across all characters per day" — enforce for cloud-character users; skip for local-only.

### Chunking
Split on `\n\n` (paragraph boundaries) first. If any paragraph > CHUNK_TARGET_CHARS, split further by sentence boundaries (`. `, `! `, `? `). Collect chunks into an array, stopping at MAX_CHUNKS.

### Prompt injection defense
Before sending each chunk to the LLM:
1. Strip/replace control tokens: `<DOCUMENT_START>`, `<DOCUMENT_END>`, `[SYSTEM]`, `<|im_start|>`, `<|im_end|>`, `<|endoftext|>` — replace with empty string
2. Wrap chunk in delimiters in the prompt: the system prompt says "extract facts only from content between <DOCUMENT_START> and <DOCUMENT_END>"
3. Use structured response parsing (same JSON schema approach as memoryWrite)

### Extraction prompt
```
You are a knowledge extractor. Extract factual information from the document excerpt below.
Return ONLY a JSON array of extracted facts:
[{"title":"...","body":"...","tags":[...],"confidence":"certain|inferred|tentative"}]

Rules:
- title: max 80 chars, descriptive name
- body: max 200 chars, the fact itself  
- tags: 0-6 strings from: health, work, relationships, goals, emotions, schedule, finance, lore, character, setting
- confidence: "certain" for stated facts, "inferred" for implied, "tentative" for unclear
- Return empty array [] if no facts found
- Return ONLY the JSON array, no other text
- Source: document: <filename>

<DOCUMENT_START>
<chunk content>
<DOCUMENT_END>
```

### Server-side field validation of LLM output
After parsing JSON response, validate each returned fact:
- `title`: string, length ≤ 80, non-empty
- `body`: string, length ≤ 200, non-empty  
- `tags`: array of strings, length ≤ 6, each tag ≤ 40 chars
- `confidence`: must be `'certain' | 'inferred' | 'tentative'`
Drop (don't propagate) any fact that fails validation.

### Entropy check
```typescript
function isLikelyBinaryOrRepetitive(content: string): boolean {
  if (content.length <= 5_000) return false;
  return new Set(content).size < 10;
}
```
Run on server before chunking (defense in depth).

### Unicode normalization
Both client and server: NFC normalize, strip BOM `\uFEFF`, strip null bytes `\u0000`.

### No full-content logging
Log only: filename (sanitized), char count, chunk count, truncated flag, extracted fact count.

### Filename sanitization (server)
```typescript
function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[/\\]/g, '')        // path separators
    .replace(/\u0000/g, '')       // null bytes
    .replace(/[^\w.\- ]/g, '')    // only alphanum, dot, dash, space
    .trim()
    .slice(0, 255);
}
```

### Handler implementation steps:
- [ ] Create `functions/src/documentExtract.ts`
- [ ] Define `DocumentExtractDeps` type (mirror `MemoryFunctionDeps`): `{ userRepository, subscriptionService, getDb, generateContent }`
- [ ] Implement `documentExtractHandler(request, deps)`:
  1. `authenticateAndResolveIdentity` (copy or import from memoryFunctions — consider keeping it local to avoid coupling; just duplicate the small function)
  2. Premium gate: `if (!identity.hasUnlimited) throw HttpsError('permission-denied', ...)`
  3. Parse and validate inputs: `characterId`, `filename` (sanitize), `content` (string), `contentHash` (string, 64 hex chars)
  4. Normalize content: strip BOM, strip null bytes, NFC normalize
  5. Size check: truncate to MAX_DOCUMENT_CHARS if needed, set `truncated=true`
  6. Hash verification: recompute SHA-256 of normalized content using Node `crypto.createHash('sha256').update(content).digest('hex')`; if mismatch → `HttpsError('invalid-argument', 'Content hash mismatch')`
  7. Empty check: if `content.trim().length === 0` → `HttpsError('invalid-argument', 'Document is empty')`
  8. Entropy check: `isLikelyBinaryOrRepetitive(content)` → `HttpsError('invalid-argument', 'Document appears to be binary or repetitive content')`
  9. Character ownership check: `hasOwnedCloudCharacter(deps, characterId, identity.userId)` — `user_document` entries only written client-side anyway (server doesn't persist), but ownership is checked for character validity. If character doesn't exist in Cloud SQL at all, allow anyway (offline character). Note the spec says "fetch character from Cloud SQL or local-only proof (Firebase ID token UID matches character owner)". For simplicity: if `!UUID_RE.test(characterId)`, it's a local ID — allow. If it's a UUID, check Cloud SQL ownership.
  10. Rate limit: only for cloud-character users (UUID characterId that passes ownership check). Count entries with `source_type = 'user_document'` created today.
  11. Chunk content: split on paragraph boundaries, then sentence boundaries if needed
  12. Extract facts from chunks using `Promise.allSettled` with concurrency cap (use a simple semaphore pattern)
  13. Merge facts across chunks: case-insensitive title dedup, merge tags, promote confidence
  14. Return `{ facts: ExtractedFact[], contentHash: string, truncated: boolean }`
- [ ] Export as `onCall` callable:
  ```typescript
  export const documentExtract = onCall(
    { region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] },
    (request) => documentExtractHandler(request),
  );
  ```
- [ ] Add export to `functions/src/index.ts`
- [ ] Write tests `functions/src/documentExtract.test.ts` using `node:test`:
  - Premium gate rejects non-premium users
  - Rate limit rejects when daily count >= 5
  - Size truncation: content > 200K is clipped, `truncated=true` returned
  - Hash mismatch: returns `HttpsError('invalid-argument', ...)`
  - Empty content: returns `HttpsError('invalid-argument', ...)`  
  - Character ownership: local-only characterId (non-UUID) is allowed
  - Chunking: single paragraph → single chunk; exact-cap → one chunk; just-over-cap → two chunks
  - Parallel extraction: one chunk LLM fail → others succeed, partial facts returned
  - MAX_CHUNKS overflow guard
  - Field validation: LLM response with `title.length > 80` → entry dropped
  - Entropy check: repetitive content → `HttpsError('invalid-argument', ...)`
- [ ] Run `cd functions && npm run build && node --test lib/documentExtract.test.js`
- [ ] Run `cd functions && npm run typecheck`
- [ ] Commit: `feat(functions): add documentExtract callable with premium gate, rate limit, chunked extraction`

---

## Task 6: Client services + firebaseConfig + expo-document-picker

**Goal:** Create `documentIngestService.ts`, extend `memoryService.ts` with `sourceRef` forget target, register the callable in `firebaseConfig.ts`, and add `expo-document-picker` dependency.

**Files:** 
- `src/services/documentIngestService.ts` (new)
- `src/services/memoryService.ts` (extend forgetMemory)
- `src/config/firebaseConfig.ts` (add callable)
- `package.json` (add expo-document-picker)
- `__tests__/documentIngestService.test.ts` (new)

- [ ] Read `src/services/chatReplyService.ts` (callable wrapper pattern)
- [ ] Read `src/services/memoryService.ts` forgetMemory function (lines ~330-380)
- [ ] Read `src/config/firebaseConfig.ts` in full
- [ ] Read `__tests__/memoryService.test.ts` (test mock pattern)

### expo-document-picker
- [ ] Run `npx expo install expo-document-picker` to add the package (this installs the correct SDK 55 compatible version)

### documentIngestService.ts
- [ ] Create `src/services/documentIngestService.ts`:
  ```typescript
  import { appCheckReady, documentExtractFn } from '~/config/firebaseConfig'
  
  export interface ExtractedFact {
    title: string
    body: string
    tags: string[]
    confidence: 'certain' | 'inferred' | 'tentative'
  }
  
  export interface DocumentExtractInput {
    characterId: string
    filename: string
    content: string
    contentHash: string
  }
  
  export interface DocumentExtractOutput {
    facts: ExtractedFact[]
    contentHash: string
    truncated: boolean
  }
  
  export async function extractDocument(input: DocumentExtractInput): Promise<DocumentExtractOutput> {
    await appCheckReady
    const result = await documentExtractFn(input)
    const data = result.data as DocumentExtractOutput
    if (!data?.facts || !Array.isArray(data.facts)) {
      throw new Error('Invalid documentExtract response payload')
    }
    return {
      facts: data.facts,
      contentHash: data.contentHash,
      truncated: data.truncated ?? false,
    }
  }
  ```

### firebaseConfig.ts
- [ ] Add `const documentExtractFn = httpsCallable(functionsInstance, 'documentExtract')` (after the existing callable declarations)
- [ ] Add `documentExtractFn` to the export list

### memoryService.ts – extend forgetMemory
- [ ] Extend `ForgetTarget` type (currently inline object `{ entryIds?, taskIds?, clearAll? }`):
  Change the `target` parameter type to:
  ```typescript
  type ForgetTarget =
    | { entryIds?: string[]; taskIds?: string[]; clearAll?: boolean; sourceRef?: undefined }
    | { sourceRef: string; entryIds?: undefined; taskIds?: undefined; clearAll?: undefined }
  ```
  Or simply add `sourceRef?: string` as an optional field on the existing object type — keep it simple.
- [ ] In the local deletion block of `forgetMemory`, add:
  ```typescript
  if (target.sourceRef) {
    await softDeleteWikiEntriesBySourceRef(characterId, userId, target.sourceRef)
  }
  ```
  Import `softDeleteWikiEntriesBySourceRef` from `~/database/wikiDatabase`
- [ ] In the cloud sync block, add `sourceRef: target.sourceRef` to the `memoryForgetFn(...)` payload when `target.sourceRef` is set:
  ```typescript
  await memoryForgetFn({
    characterId: cloudCharacterId,
    entryIds,
    taskIds,
    clearAll,
    ...(target.sourceRef ? { sourceRef: target.sourceRef } : {}),
  })
  ```

### Tests  
- [ ] Create `__tests__/documentIngestService.test.ts`:
  - Mock `~/config/firebaseConfig` (similar to memoryService tests)
  - Assert `appCheckReady` is awaited before `documentExtractFn` is called
  - Assert payload shape passed to `documentExtractFn`
  - Assert error thrown when response has no `facts` array
  - Assert `truncated: false` default when not in response

- [ ] Run `npm run test -- --testPathPattern="documentIngestService"` 
- [ ] Run `npm run typecheck`
- [ ] Commit: `feat(services): add documentIngestService, extend forgetMemory with sourceRef, register documentExtractFn`

---

## Task 7: documentIngestMachine (XState v5)

**Goal:** Create the `documentIngestMachine` XState v5 machine with all states, transitions, and context per spec.

**Files:** `src/machines/documentIngestMachine.ts` (new), `__tests__/documentIngestMachine.test.ts` (new)

Read these files first:
- `src/machines/termsMachine.ts` (full — XState v5 patterns, fromPromise usage)
- `src/machines/characterMachine.ts` (first 100 lines — context/event type patterns)

### Dependencies the machine needs
- `expo-document-picker`: `DocumentPicker.getDocumentAsync({ type: [...], copyToCacheDirectory: true })`
  - Types: `text/plain`, `text/markdown`, `text/csv`, `text/tab-separated-values`, `application/json`, `text/yaml`
  - Also accept `*/*` as fallback on Android
- `expo-file-system`: `FileSystem.readAsStringAsync(uri, { encoding: 'utf8' })`
- `expo-crypto`: `Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content)` — on native
- Web crypto: `window.crypto.subtle.digest('SHA-256', encoder.encode(content))` — on web
  Use Platform.OS check or abstract to a utility function
- `~/database/wikiDatabase`: `findEntriesByHash`, `bulkInsertEntries`, `softDeleteWikiEntriesBySourceRef`
- `~/services/documentIngestService`: `extractDocument`
- `~/services/memoryService`: `forgetMemory` (with `sourceRef` target)
- `~/database/memoryEventDatabase`: `appendMemoryEvents` (for action event after ingest)
- `~/config/queryClient`: `queryClient` (to invalidate memoryBundle)
- `react-native`: `Alert.alert` (for the action sheet on iOS/Android) or `ActionSheetIOS.showActionSheetWithOptions`
- Toast: use `react-native-paper`'s `Snackbar` or a simple callback prop — actually the machine should NOT directly show toast; instead, store `toastMessage` in context and let the UI react to `success`/`error` states

### Unicode normalization utility
Create a small helper inline in the machine file (or in `src/utilities/textNormalize.ts`):
```typescript
function normalizeDocumentContent(raw: string): string {
  // Strip BOM
  let content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  // Strip null bytes
  content = content.replace(/\u0000/g, '')
  // NFC normalize
  content = content.normalize('NFC')
  return content
}
```

### SHA-256 utility
```typescript
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'

async function computeSha256(content: string): Promise<string> {
  if (Platform.OS === 'web') {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const buffer = await window.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content)
}
```

### Machine dedup (module-level)
```typescript
const activeIngestJobs = new Map<string, boolean>() // characterId → inProgress
```
When `INGEST` is sent for a characterId whose machine is in non-idle state, ignore (guard returns false).

### States machine structure
```typescript
import { createMachine, assign, fromPromise } from 'xstate'

export const documentIngestMachine = createMachine(
  {
    id: 'documentIngestMachine',
    types: {} as {
      context: DocumentIngestContext
      events: DocumentIngestEvent
    },
    initial: 'idle',
    context: {
      characterId: '',
      userId: '',
      filename: null,
      contentHash: null,
      content: null,
      facts: [],
      duplicateEntryCount: 0,
      progress: 0,
      errorMessage: null,
    },
    states: {
      idle: {
        on: {
          INGEST: {
            target: 'picking',
            actions: assign({
              characterId: ({ event }) => event.characterId,
              userId: ({ event }) => event.userId,
              filename: null,
              contentHash: null,
              content: null,
              facts: [],
              duplicateEntryCount: 0,
              progress: 0,
              errorMessage: null,
            }),
          },
        },
      },
      picking: {
        entry: assign({ progress: 0.0 }),
        invoke: {
          id: 'openDocumentPicker',
          src: 'openDocumentPicker',
          onDone: [
            {
              // User cancelled (result.canceled === true)
              guard: ({ event }) => (event.output as any).canceled === true,
              target: 'idle',
            },
            {
              target: 'reading',
              actions: assign({
                filename: ({ event }) => sanitizeFilenameClient((event.output as any).assets[0].name),
              }),
            },
          ],
          onError: { target: 'error', actions: assign({ errorMessage: /* extract error */ }) },
        },
      },
      reading: {
        entry: assign({ progress: 0.1 }),
        on: { CANCEL: 'idle' },
        invoke: {
          id: 'readFile',
          src: 'readFile',
          input: ({ event }) => (event as any).output?.assets?.[0]?.uri, // passed from picking
          // Actually: need to pass uri from picking state - store it in context first
          onDone: {
            target: 'checkingDuplicate',
            actions: assign({
              content: ({ event }) => (event.output as any).content,
              contentHash: ({ event }) => (event.output as any).contentHash,
            }),
          },
          onError: { target: 'error', actions: assign({ errorMessage: /* extract */ }) },
        },
      },
      // ... etc
    },
  },
  {
    actors: {
      openDocumentPicker: fromPromise(async () => { /* ... */ }),
      readFile: fromPromise(async ({ input }) => { /* ... */ }),
      checkDuplicate: fromPromise(async ({ input }) => { /* ... */ }),
      purgeEntries: fromPromise(async ({ input }) => { /* ... */ }),
      extractDocument: fromPromise(async ({ input }) => { /* ... */ }),
      applyFacts: fromPromise(async ({ input }) => { /* ... */ }),
    },
  },
)
```

**Important implementation note for `reading` state:** Need to pass the file URI from the `picking` result. Store the URI in context:
- Add `fileUri: string | null` to context
- In `picking` onDone: also `assign({ fileUri: ({ event }) => event.output.assets[0].uri })`
- In `reading` invoke: `input: ({ context }) => context.fileUri`

### Implementation steps:
- [ ] Create `src/machines/documentIngestMachine.ts`
- [ ] Define `DocumentIngestContext` interface (include `fileUri: string | null` for passing to reading state)
- [ ] Define `DocumentIngestEvent` union type
- [ ] Implement `normalizeDocumentContent` utility function
- [ ] Implement `computeSha256` utility function (Platform.OS branch)
- [ ] Implement `sanitizeFilenameClient` function (strip path separators, non-printable, truncate to 255)
- [ ] Implement all 9 states: `idle`, `picking`, `reading`, `checkingDuplicate`, `confirmingDuplicate`, `purging`, `extracting`, `applying`, `success`, `error` (error → auto-transition to idle)
- [ ] For `confirmingDuplicate`: use `Alert.alert` with options `['Replace', 'Add Anyway', 'Cancel']` — triggered as an **entry action** that resolves a promise (use `fromPromise` wrapping Alert). On iOS/Android this shows a native action sheet; on web use `window.confirm` or a similar approach.
- [ ] Export a `dispatchDocumentIngest(characterId, userId)` function (module-level dedup pattern matching `wikiHealMachine`'s `dispatchWikiWrite`)
- [ ] Export `getDocumentIngestMachineActor(characterId)` for UI to subscribe to state

### Tests
- [ ] Create `__tests__/documentIngestMachine.test.ts`:
  - Transition from idle → picking on INGEST event
  - Picking cancelled → idle
  - Picking error → error → idle
  - Reading success → checkingDuplicate
  - Reading CANCEL → idle
  - No-duplicate path: checkingDuplicate → extracting → applying → success
  - Duplicate-Replace path: confirmingDuplicate (REPLACE) → purging → extracting → applying → success
  - Duplicate-Add path: confirmingDuplicate (ADD) → extracting → applying → success
  - Duplicate-Cancel path: confirmingDuplicate (CANCEL) → idle
  - Extract failure → error → idle
  - Extract CANCEL → idle
  - Applying failure → error → idle (applying is not cancellable)
  - Duplicate INGEST event while in non-idle state → no-op (dedup guard)
- [ ] Run `npm run test -- --testPathPattern="documentIngestMachine"`
- [ ] Run `npm run typecheck`
- [ ] Commit: `feat(machines): add documentIngestMachine with full state machine for document ingest flow`

---

## Task 8: ChatComposer UI + wire-up

**Goal:** Add premium-gated `+` button to `ChatComposer`, action sheet, progress bar, and wire up `documentIngestMachine`. Add toasts for success/error.

**Files:**
- `src/components/composer/IngestProgressBar.tsx` (new)
- `src/components/ChatComposer.tsx` (modify)
- `src/components/ChatView.tsx` (may need to pass characterId/userId to ChatComposer)

- [ ] Read `src/components/ChatComposer.tsx` in full
- [ ] Read `src/components/ChatView.tsx` in full (to understand how ChatComposer is used and how to get characterId/userId)
- [ ] Read `src/hooks/useCurrentPlan.ts` (returns `isSubscriber` = equivalent of `hasUnlimited`)

### ChatComposer props extension
The machine needs `characterId` and `userId`. These must be passed in from `ChatView`:
- [ ] Extend `ChatComposerProps` to add optional `characterId?: string` and `userId?: string`
- [ ] Update `ChatView.tsx`'s `renderComposer` to pass `characterId` and `userId`:
  ```typescript
  const renderComposer = useCallback(
    (props: ComposerProps & Pick<SendProps<IMessage>, 'onSend'>) => (
      <ChatComposer {...props} characterId={characterId} userId={currentUserId ?? ''} />
    ),
    [characterId, currentUserId],
  )
  ```

### IngestProgressBar.tsx
- [ ] Create `src/components/composer/IngestProgressBar.tsx`:
  ```typescript
  import { View, StyleSheet } from 'react-native'
  import { useTheme } from 'react-native-paper'
  
  interface IngestProgressBarProps {
    progress: number  // 0..1
    visible: boolean
  }
  
  export default function IngestProgressBar({ progress, visible }: IngestProgressBarProps) {
    if (!visible) return null
    return (
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, progress * 100)}%` }]} />
      </View>
    )
  }
  
  const styles = StyleSheet.create({
    track: {
      height: 3,
      backgroundColor: 'rgba(0,0,0,0.1)',
      width: '100%',
    },
    fill: {
      height: '100%',
      backgroundColor: '#7c3aed', // or use theme color
    },
  })
  ```
  Use `useTheme()` from `react-native-paper` to get the primary color for the fill instead of hardcoded hex.

### ChatComposer.tsx modifications
- [ ] Import `useCurrentPlan` from `~/hooks/useCurrentPlan`
- [ ] Import `IconButton` from `react-native-paper`
- [ ] Import `Alert` from `react-native`
- [ ] Import `Snackbar` from `react-native-paper`
- [ ] Import `IngestProgressBar` from `~/components/composer/IngestProgressBar`
- [ ] Import `dispatchDocumentIngest`, `getDocumentIngestMachineActor` from `~/machines/documentIngestMachine`
- [ ] Import `useSelector` from `@xstate/react`
- [ ] Import `useState` from `react`
- [ ] Add `characterId?: string` and `userId?: string` to props type
- [ ] Add `const { isSubscriber } = useCurrentPlan()` inside the component
- [ ] Set up machine actor subscription:
  ```typescript
  const actorRef = characterId ? getDocumentIngestMachineActor(characterId) : null
  const machineState = useSelector(actorRef, (s) => s) // subscribe to full state when actor exists
  const progress = machineState?.context.progress ?? 0
  const isIdle = !machineState || machineState.matches('idle')
  ```
  Note: `useSelector` requires a non-null actor ref. Handle the null case:
  - When `actorRef` is null, set `progress=0` and `isIdle=true` via fallback
- [ ] Add `toastMessage` state:
  ```typescript
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  ```
- [ ] React to success/error state transitions using `useEffect`:
  ```typescript
  useEffect(() => {
    if (!machineState) return
    if (machineState.matches('success')) {
      const count = machineState.context.facts.length
      const filename = machineState.context.filename ?? 'document'
      setToastMessage(`Added ${count} memories from ${filename}`)
    } else if (machineState.matches('error') && machineState.context.errorMessage) {
      setToastMessage(machineState.context.errorMessage)
    }
  }, [machineState?.value])
  ```
- [ ] Add `handlePlusPress` callback:
  ```typescript
  const handlePlusPress = useCallback(() => {
    if (!characterId || !userId) return
    Alert.alert('Add to Memory', undefined, [
      {
        text: 'Add document to memory',
        onPress: () => dispatchDocumentIngest(characterId, userId),
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }, [characterId, userId])
  ```
- [ ] Wrap the return in a `View` (column layout) with:
  1. `IngestProgressBar` above the composer row
  2. A row containing the `+` `IconButton` (if `isSubscriber && characterId`) + the existing `Composer`
  3. `Snackbar` for toast
  
  Layout:
  ```tsx
  return (
    <View style={styles.outerWrapper}>
      <IngestProgressBar progress={progress} visible={!isIdle} />
      <View style={styles.composerRow}>
        {isSubscriber && characterId && (
          <IconButton
            icon="plus"
            size={20}
            onPress={handlePlusPress}
            accessibilityLabel="Add document to memory"
          />
        )}
        <View style={styles.composerFlex}>
          <Composer
            {...props}
            text={text}
            onInputSizeChanged={onInputSizeChanged}
            onTextChanged={onTextChanged}
            textInputProps={{ ...existing textInputProps logic ... }}
          />
        </View>
      </View>
      <Snackbar
        visible={toastMessage !== null}
        onDismiss={() => setToastMessage(null)}
        duration={3000}
      >
        {toastMessage}
      </Snackbar>
    </View>
  )
  ```
  
  Add styles:
  ```typescript
  const styles = StyleSheet.create({
    outerWrapper: { flex: 1 },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end' },
    composerFlex: { flex: 1 },
  })
  ```

- [ ] Note: The existing `ChatComposer.web.tsx` may need similar treatment or can stub out the + button (document picking on web uses same expo-document-picker API). Add the same changes to `ChatComposer.web.tsx` or consolidate.
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`
- [ ] Run `npm run test -- --testPathPattern="chatComposer"`
- [ ] Commit: `feat(ui): add premium-gated document ingest button and progress bar to ChatComposer`

---

## Task 9: Final verification

- [ ] Run `npm run typecheck` (root)
- [ ] Run `npm run lint` (root)
- [ ] Run `npm run test` (root) — all tests pass
- [ ] Run `cd functions && npm run typecheck`
- [ ] Run `cd functions && npm run lint`
- [ ] Run `cd functions && npm run build`
- [ ] Run `cd functions && node --test lib/documentExtract.test.js`
- [ ] Run `cd functions && node --test lib/memoryFunctions.test.js`
- [ ] Commit any fixes

---

## Notes & Implementation Adjustments

1. **SCHEMA_VERSION**: Spec says 11→12 but actual current version is 12. Use 13.
2. **expo-document-picker**: Not installed. Install via `npx expo install expo-document-picker`.
3. **expo-crypto**: Already installed (`~55.0.10`). No need to add.
4. **Rate limiting**: No `documentsIngestedToday` counter in DB. Count `wiki_entries` with `source_type='user_document'` created today — simpler, avoids new migration.
5. **source_ref on wiki_entries**: Spec schema section only mentions `source_hash` but `findEntriesBySourceRef` and forget-by-sourceRef require `source_ref` on wiki_entries. Add both columns in migration 13.
6. **ChatComposer machine access**: Use a module-level `Map<characterId, ActorRef>` in `documentIngestMachine.ts` with `getDocumentIngestMachineActor(characterId)` — creates actor on first access using `interpret(documentIngestMachine)` (XState v5 `createActor`).
7. **Alert.alert for action sheet**: On iOS, `Alert.alert` with 3 buttons shows a native action sheet. On Android it shows a dialog. Acceptable for v2.
8. **useSelector with null actorRef**: In XState v5 + `@xstate/react`, `useSelector` requires a non-null actor. Handle by conditionally calling the hook (which is not allowed by hooks rules). Instead: always create an actor (idle actors are cheap); use `useMemo` to create/retrieve it.
