# Spec: User Document Ingest — Wiki Memory v2

Date: 2026-04-28
Status: Ready
Branch: TBD (feature branch off `staging`)
Depends on: [2026-04-24-llm-wiki-memory.md](./2026-04-24-llm-wiki-memory.md) (v1, shipped)

## Problem

Wiki memory v1 ([2026-04-24-llm-wiki-memory.md](./2026-04-24-llm-wiki-memory.md)) grows organically from conversation only. Users have no way to seed a character with knowledge they already have written down (notes, character sheets, lore docs, journals, briefing material). The `source_type` union and `source_ref` column on `memory_events` were reserved for this in v1, but no UI surface or extraction path was built.

This spec adds **user-initiated document ingest** for premium users: pick a `.txt` or `.md` file from the device, send to a new server-side extraction callable, apply extracted facts to the local wiki tagged as immutable user-source material that the heal pass leaves alone.

## Goals

- Premium-gated `+` action in `ChatComposer` opens a document picker
- Server callable extracts structured facts from supplied text (no client-side LLM, mirrors v1 server-extraction model)
- Extracted entries written to local SQLite with `source_type='user_document'` so `memoryHeal` treats them as anchors
- Idempotent re-upload: same filename → prompts Replace/Add Anyway (filename-based dedup; `source_ref` column)
- User can purge all entries from a single uploaded document via `memoryForget`
- Reasonable abuse / cost ceilings enforced both client and server

## Non-Goals (v2)

- **PDF / DOCX / image extraction** — deferred to v3. Decision on extraction location (Cloud Storage upload vs client-side parse) deferred with it. v2 supports plain text formats only: `.txt`, `.md`.
- **Cross-character document share** — each ingest is scoped to one character.
- **Document management dashboard** — `source_ref` provenance is stored, but no UI lists/edits ingested docs in v2. Deferred to v3.
- **Background / queued ingest** — ingest is foreground; cancellation supported.
- **On-device LLM extraction** — same v2 deferral as wiki librarian; cloud callable only.

## Schema (v16 migration)

Bump `SCHEMA_VERSION = 12 → 16` ([src/database/schema.ts](/src/database/schema.ts)). Migrations were needed in practice, each with a single-column skip guard for retry safety: `MIGRATIONS[13]` adds `source_hash`; `MIGRATIONS[14]` adds `source_ref`; `MIGRATIONS[15]` drops any prior index and recreates it as a partial index (`WHERE source_hash IS NOT NULL`) to avoid indexing NULL rows; `MIGRATIONS[16]` adds a partial index on `(character_id, source_ref) WHERE source_ref IS NOT NULL` to support efficient purge-by-filename queries.

### `wiki_entries` additions

Add two columns to local SQLite:

```
source_hash   TEXT                              -- SHA-256 of normalized source content; nullable for non-document entries
source_ref    TEXT                              -- original filename (sanitized); nullable for non-document entries
```

Index: `(character_id, source_hash)` — partial index where `source_hash IS NOT NULL`. Stored with each entry for provenance; not used for duplicate prompting in v2.

Index: `(character_id, source_ref)` — partial index where `source_ref IS NOT NULL`. Used for duplicate detection (`findEntriesByRef`) and purge-by-filename (`softDeleteWikiEntriesBySourceRef`).

Cloud SQL Drizzle mirror ([functions/src/db/schema.ts](/functions/src/db/schema.ts)) gets the same column + index. Generate via `cd functions && npm run db:generate` then `npm run migrate` (see `/memories/repo/cloud-sql-migrations.md`).

### `source_type` union extension

TypeScript union extended to include `'user_document'`. No SQL change needed (column is `TEXT`). Existing wiki_entries continue with `'agent_inferred'` / `'user_stated'` / `'user_confirmed'`.

`memory_events.source_ref` (already nullable, added in v11) is now actively populated with the original filename for events emitted during document ingest. No new column.

## Firebase Callable: `documentExtract`

New callable in `functions/src/documentExtract.ts`. Match v1 template: `onCall({ region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] }, (req) => handler(req, deps))`. Handler exported separately for tests.

### Signature

```ts
documentExtract({
  characterId: string,
  filename: string,           // for provenance only; max 255 chars, sanitized server-side
  content: string,            // full document text (already extracted client-side for .txt/.md)
  contentHash: string,        // SHA-256 hex of `content`, computed client-side, re-verified server-side
}) => {
  facts: ExtractedFact[],
  contentHash: string,        // echo back (verified)
  truncated: boolean,         // true if content exceeded MAX_DOCUMENT_CHARS and was clipped
}

interface ExtractedFact {
  title: string,             // ≤80 chars
  body: string,              // ≤200 chars (matches v1 wiki body cap)
  tags: string[],            // ≤6 tags
  confidence: 'certain' | 'inferred' | 'tentative',
}
```

### Server pipeline

1. **Auth + premium gate** — same `request.auth` check as `generateReply`; resolve user via `userRepository.getOrCreateUserByFirebaseIdentity`; require `usage.hasUnlimited` else `HttpsError('permission-denied', 'Premium required for document ingest')`.
2. **Rate limit** — read `usage` doc; if `usage.documentsIngestedToday >= MAX_DOCUMENTS_PER_DAY (5)` → `HttpsError('resource-exhausted', 'Daily document limit reached')`. Increment counter on success (transaction; reset by existing daily-rollover code). Per-character cap is implicit (5 per user across all characters per day).
3. **Size validation** — `content.length > MAX_DOCUMENT_CHARS (200_000)` → truncate to cap, set `truncated=true`. Empty / whitespace-only content → `HttpsError('invalid-argument', 'Document is empty')`.
4. **Hash verification** — recompute SHA-256 of the full normalized content (before truncation); if mismatch with client-supplied `contentHash` → `HttpsError('invalid-argument', 'Content hash mismatch')`. Returned `contentHash` is the server-recomputed value (authoritative). Truncation happens after hash verification so both client and server hash the same bytes.
5. **Character ownership** — fetch character from Cloud SQL or local-only proof (Firebase ID token UID matches character owner); if not owned → `HttpsError('permission-denied')`.
6. **Chunking** — split content on paragraph boundaries first, then sentence boundaries, target ≤2000 chars per chunk, hard ceiling `MAX_CHUNKS = 100`. If raw chunk count exceeds ceiling, content was already truncated — should not be reachable, but defend anyway and `HttpsError('resource-exhausted', 'Document too long after chunking')`.
7. **Parallel extraction** — `Promise.allSettled` over chunks with concurrency cap (`p-limit` style, max 4 concurrent). Each chunk → reuses `summarizeText`-style LLM call asking for structured fact extraction. System prompt must enforce body ≤ 200 chars (v1 budget rule).
8. **Merge + dedup within document** — collapse facts across chunks by case-insensitive title match; tags merged, confidence promoted to highest seen.
9. **Return** — `{ facts, contentHash, truncated }`. Server does **not** write to Cloud SQL or local SQLite; client owns persistence (matches v1 `memoryWrite` diff-return pattern, preserves offline-first invariant + sets up local LLM v2 swap).
10. **Billing** — document ingest consumes **no user credits** (matches v1 librarian); cost capped by daily rate limit instead.

### Input Sanitization & Security

**1. Prompt injection defense (highest risk)**

Document content is fed directly to an LLM. A crafted document could attempt to override the extraction system prompt or plant malicious facts into future conversation context.

- Wrap each chunk in explicit delimiters in the system prompt: `<DOCUMENT_START>...<DOCUMENT_END>`. Instruct the model that anything between delimiters is *data to extract from*, never *instructions to follow*.
- Before sending to the LLM, strip or escape any token that could escape the delimiter boundary. Tokens to strip/replace: `<DOCUMENT_START>`, `<DOCUMENT_END>`, `[SYSTEM]`, `<|im_start|>`, `<|im_end|>`, `<|endoftext|>`, and any other control/special tokens for the model family in use.
- Use structured output mode (Gemini schema / OpenAI JSON mode) for the extraction call — the model should never be allowed to return freeform text outside the `ExtractedFact[]` schema.
- **Validate every returned field server-side before returning to client**: `title.length ≤ 80`, `body.length ≤ 200`, `tags` is `string[]` with `length ≤ 6` and each tag `≤ 40 chars`, `confidence ∈ { 'certain', 'inferred', 'tentative' }`. Drop any entry that fails validation; do not propagate injected content.

**2. Filename sanitization**

`filename` is stored as `source_ref`, displayed in toasts, and written to the DB.

- Server: strip path separators (`/`, `\`), null bytes, and non-printable characters. Allow only `[A-Za-z0-9._\- ]`. Truncate to 255 chars.
- Client: apply same sanitization before dispatching to the machine (defense in depth). Treat filename as plain text in all UI surfaces — never render as markdown or HTML.

**3. Unicode normalization**

Inconsistent Unicode forms between client and server will cause hash mismatches and break dedup.

- **Normalize to NFC** on both client and server *before* hashing. This must happen in the same order: normalize → hash → (server) truncate if needed → re-hash.
- Strip BOM (`\uFEFF`) consistently — strip before normalization on both sides.
- Strip null bytes (`\u0000`) — they are valid Unicode but break some SQLite TEXT column behavior.
- Zero-width characters (`\u200B–\u200F`, `\u202E`, etc.) are preserved in storage (they may be intentional in some documents) but the BOM strip covers the most common accidental case.

**4. Entropy / binary content heuristic**

A 200K file of repeated characters (or binary data misidentified as text) wastes 100 LLM calls and produces garbage facts.

- After reading the file and before hashing: if `new Set(content).size < 10` and `content.length > 5_000` → reject with `HttpsError('invalid-argument', 'Document appears to be binary or repetitive content')`.
- Server repeats this check as defense in depth before chunking.

**5. No full-content logging**

Cloud Function logs must not emit `content` at any log level. Log only metadata: filename (sanitized), char count (post-normalization), chunk count, truncated flag, and extraction result count. This prevents PII in document content (names, addresses, journal entries) from appearing in Cloud Logging.

**6. PII disclosure**

Show a one-time disclosure in the action sheet or a persistent note in the UI: `"Document text is sent to our AI provider for processing."` Use a provider operating under a no-training data agreement (e.g., Vertex AI hosted Gemini). Verify current contract terms before shipping.

### Constants

```ts
const MAX_DOCUMENT_CHARS = 200_000;           // ~50KB markdown after parsing
const MAX_DOCUMENTS_PER_DAY = 5;              // per user, across all characters
const MAX_CHUNKS = 100;
const CHUNK_TARGET_CHARS = 2000;
const EXTRACTION_CONCURRENCY = 4;
```

## Client: `documentIngestMachine`

New `src/machines/documentIngestMachine.ts`. Real XState v5 machine (mirror [src/machines/termsMachine.ts](/src/machines/termsMachine.ts), [src/machines/characterMachine.ts](/src/machines/characterMachine.ts)). One actor per `characterId`, stored in `Map<string, ActorRef>` like `wikiHealMachine`.

### States

```
idle
  → INGEST { characterId, userId } → picking

picking         [invoked: DocumentPicker.getDocumentAsync via expo-document-picker]
  → cancelled by user        → idle
  → file picked              → reading
  → error                    → error → idle

reading         [fromPromise: read file via expo-file-system, compute SHA-256]
  → done                     → checkingDuplicate
  → error                    → error → idle
  → CANCEL                   → idle

checkingDuplicate [fromPromise: wikiDatabase.findEntriesBySourceRef(characterId, filename)]
  → no match                 → extracting
  → match found              → confirmingDuplicate
  → CANCEL                   → idle

confirmingDuplicate  [presents action sheet: Replace | Add Anyway | Cancel]
                     [no timeout — modal stays until user responds; CANCEL event also exits]
  → REPLACE   → purging       (soft-delete prior entries with this filename/sourceRef, then extract)
  → ADD       → extracting    (proceed without purge; new entries get same sourceRef)
  → CANCEL    → idle

purging         [fromPromise: forgetMemory({ sourceRef: filename }) — soft-deletes prior entries by source_ref]
  → done                     → extracting
  → error                    → error → idle

extracting      [fromPromise: documentExtract callable]
  → done                     → applying
  → error                    → error → idle
  → CANCEL                   → idle  (callable promise abandoned; client-side facts discarded)

applying        [fromPromise: bulk insert facts → wiki_entries with source_type='user_document', source_hash, source_ref=filename; emit memory_events row event_type='action' summary='Ingested document <filename>' source_ref=filename]
  → done                     → success
  → error                    → error → idle

success         [fires Toast "Added N facts from <filename>", invalidates queryClient ['memoryBundle', characterId]]
  → after 0ms                → idle

error           [stores last error message in context for UI surfacing via toast]
  → after 0ms                → idle
```

### Context

```ts
interface DocumentIngestContext {
  characterId: string;
  userId: string;
  filename: string | null;
  contentHash: string | null;
  content: string | null;        // cleared after extracting completes (memory hygiene)
  facts: ExtractedFact[];        // from extracting → applying
  duplicateEntryCount: number;   // from checkingDuplicate; drives action sheet copy
  progress: number;              // 0..1, derived from current state for UI
  errorMessage: string | null;
}
```

### Cancellation

`CANCEL` event accepted in `reading`, `checkingDuplicate`, `confirmingDuplicate`, `extracting`. Always returns to `idle`. In-flight promises are not awaited; results discarded on resolve. `applying` is intentionally not cancellable (would leave partial state in SQLite).

### Dedup at machine layer

`Map<characterId, ActorRef>`. Sending `INGEST` for a `characterId` whose machine is in non-`idle` state = no-op (no second picker opens). Mirrors `wikiHealMachine` and `activeSummaryJobs` patterns.

## Client Service Extensions

### `src/services/memoryService.ts`

Extend `forgetMemory` signature:

```ts
type ForgetTarget =
  | { entryId: string }
  | { taskId: string }
  | { sourceRef: string }     // NEW: soft-delete all entries with matching source_ref
  | { clearAll: true };

export async function forgetMemory(characterId: string, target: ForgetTarget): Promise<void>
```

When `target` is `{ sourceRef }`, callable soft-deletes both local SQLite and (if cloud-synced) Cloud SQL rows where `wiki_entries.source_ref = sourceRef AND character_id = characterId`. Client also invalidates `['memoryBundle', characterId]`.

### `src/services/documentIngestService.ts` (new)

Thin wrapper around the `documentExtract` callable matching the [src/services/chatReplyService.ts](/src/services/chatReplyService.ts) pattern:

```ts
const documentExtractFn = httpsCallable(functionsInstance, 'documentExtract');
export async function extractDocument(input: DocumentExtractInput): Promise<DocumentExtractOutput>
```

`await appCheckReady` before calling, identical to `chatReplyService`. No fire-and-forget — invoker is the machine actor.

### `src/database/wikiDatabase.ts` extensions

```ts
export async function findEntriesByHash(characterId: string, hash: string): Promise<LocalWikiEntry[]>
export async function findEntriesBySourceRef(characterId: string, sourceRef: string): Promise<LocalWikiEntry[]>
export async function bulkInsertEntries(entries: LocalWikiEntry[]): Promise<void>  // single transaction
```

`bulkInsertEntries` wraps all inserts (and FTS5 trigger fan-out) in one SQLite transaction so an `applying`-phase crash leaves nothing partial.

## UI: `ChatComposer` "+" action

Modify [src/components/ChatComposer.tsx](/src/components/ChatComposer.tsx).

### Button placement

Add a `+` icon button on the left side of the composer text input, before the send button. Visible **only when** `usage.hasUnlimited` is true (resolved via existing `useCurrentPlan` hook). Non-premium users see no button — discoverable upgrade path lives in the existing subscribe surfaces.

### Action sheet

Tap → native action sheet with options:
- **Add document to memory** → dispatches `INGEST` to `documentIngestMachine` for the active character
- **Cancel**

(Single-option sheet today is intentional — leaves room for v3 additions like "Add image", "Record voice note" without re-architecting.)

### Progress surface

Use plain `useState<number>(0)` driven by selecting `progress` from the machine context via `useSelector(actorRef, (s) => s.context.progress)`. Render as a thin horizontal bar above the composer, hidden when `state === 'idle'`. **No Reanimated** — progress updates are coarse (handful per ingest), 60fps animation is unnecessary.

Progress mapping (deterministic from state):
- `picking` → 0.0
- `reading` → 0.1
- `checkingDuplicate` → 0.2
- `confirmingDuplicate` / `purging` → 0.3
- `extracting` → 0.5 (single value; per-chunk granular progress is noise)
- `applying` → 0.9
- `success` → 1.0 then hide

### Done toast

On `success` state entry, fire existing toast helper: `"Added {factCount} memories from {filename}"`. On `error`, fire toast with `errorMessage`.

## `memoryHeal` Heal-Skip Behavior

Modify `memoryHealHandler` in `functions/src/memoryFunctions.ts`:

- **Contradiction pass**: skip pairs where either entry has `source_type='user_document'`. User-supplied source material is treated as authoritative anchor; conversational entries that disagree get downgraded against the document, not the other way around.
- **Stale claims pass**: skip entries with `source_type='user_document'` (they don't decay from disuse — user explicitly added them).
- **Orphan pass**: skip entries with `source_type='user_document'` (no soft-delete by inactivity; user owns the lifecycle via `memoryForget({ sourceRef })`).
- **Missing concepts pass**: unchanged — may still seed new tentative entries; document entries serve as input context for the LLM here.

Document this skip behavior at the top of `memoryHealHandler`.

## File / Library Choices

- **`expo-document-picker`** — already established Expo pattern. Add to client `package.json` dependencies. MIME filter: `['text/plain', 'text/markdown']`. Accepted extensions: `.txt`, `.md`, `.markdown`. Note: on some Android devices `.md` files may not have a registered MIME type; if the system picker returns no results the user should rename the file to `.txt` before uploading. Additional formats (csv, tsv, json, yaml) deferred to v3 once cross-platform MIME support is validated.
- **`expo-file-system`** — already installed (`~55.0.16`). Use for reading picked file as UTF-8 string.
- **Encoding constraint** — `TextDecoder` on native (Hermes) supports **UTF-8 only** (not spec-compliant per Expo docs). Files saved as UTF-16 or Windows code pages (common on Windows `.txt` exports) will decode as garbage. No polyfill added in v2 — document this limitation in the UI or help text. v3 can add the `text-encoding` polyfill if needed.
- **SHA-256** — use Web Crypto `crypto.subtle.digest('SHA-256', ...)` on web; on native use `expo-crypto` (`Crypto.digestStringAsync(SHA256, ...)`). `expo-crypto` may not yet be installed — add to dependencies.
- **No PDF library this round** — binary formats (PDF, DOCX, images) deferred to v3. v2 supports UTF-8 plain-text formats only (see accepted extensions above). v3 picks between `unpdf` (server-side, Cloud Storage upload) and `react-native-pdf-extract` (client-side text extraction).
- **No Reanimated additions** — plain `useState` for progress.
- **Server LLM** — reuse the existing extraction prompt from `memoryWrite`. The prompt scaffold should accept a `source` hint (`"document: <filename>"` vs `"conversation"`) so the LLM knows to extract verbatim factual content for documents rather than inferring intent.

## Files Touched

**New**:
- `src/machines/documentIngestMachine.ts`
- `src/services/documentIngestService.ts`
- `src/components/composer/IngestProgressBar.tsx` (small enough to colocate, but separate keeps `ChatComposer` lean)
- `functions/src/documentExtract.ts`
- `__tests__/documentIngestMachine.test.ts`
- `__tests__/documentIngestService.test.ts`
- `functions/src/documentExtract.test.ts`

**Modified**:
- [src/database/schema.ts](/src/database/schema.ts) — bump `SCHEMA_VERSION` → 16; add `MIGRATIONS[13]` (ALTER `wiki_entries` add `source_hash`), `MIGRATIONS[14]` (add `source_ref`), `MIGRATIONS[15]` (swap `source_hash` to partial index), `MIGRATIONS[16]` (add partial index on `source_ref`); extend `LATEST_SCHEMA_REQUIRED_COLUMNS['wiki_entries']`
- [functions/src/db/schema.ts](/functions/src/db/schema.ts) — add `sourceHash` column + index to `wikiEntries` table; new Drizzle migration generated at `functions/drizzle/000X_document_source_hash.sql`
- `src/database/wikiDatabase.ts` — add `findEntriesByHash`, `findEntriesBySourceRef`, `bulkInsertEntries`; extend `LocalWikiEntry` interface and `source_type` union
- `src/services/memoryService.ts` — extend `ForgetTarget` union with `{ sourceRef }`; pass through to `memoryForget` callable
- `functions/src/memoryFunctions.ts` — `memoryForgetHandler` accepts `sourceRef` parameter; `memoryHealHandler` adds source_type skip logic for contradiction/stale/orphan passes
- [src/components/ChatComposer.tsx](/src/components/ChatComposer.tsx) — add premium-gated `+` button + action sheet + progress bar mount
- [functions/src/index.ts](/functions/src/index.ts) — export `documentExtract` callable
- [src/config/firebaseConfig.ts](/src/config/firebaseConfig.ts) — register `documentExtract` httpsCallable
- `package.json` — add `expo-document-picker`, `expo-crypto`
- `functions/src/types.ts` (or equivalent shared types file) — extend `SourceType` union
- `__tests__/wikiDatabase.test.ts` — tests for `findEntriesByHash`, `findEntriesBySourceRef`, `bulkInsertEntries` transaction rollback

**Unchanged**:
- v1 `wikiHealMachine` — no changes; document ingest is an independent flow
- v1 callables (`memoryRead`, `memoryWrite`, `memoryHeal`) — only `memoryHeal` handler internals change
- `aiChatService.ts` — no pre-turn or post-turn changes; document entries flow into existing `fetchMemoryBundle` reads automatically

## Tests

Match existing patterns:

- **State machine** (Jest): assert transitions for picker cancel, file read failure, no-duplicate path, duplicate-replace path, duplicate-add path, extract failure, applying failure, `CANCEL` event from each cancellable state, dedup on duplicate `INGEST` events
- **Service** (Jest): mock `httpsCallable`, assert appCheckReady awaited, payload shape, error mapping
- **Backend handler** (Node `node:test`, mirror `functions/src/memoryFunctions.test.ts`): premium gate, rate limit gate (mock usage doc), size truncation flag, hash mismatch rejection, empty content rejection, character ownership check, chunking boundary cases (single-paragraph, exact-cap, just-over-cap), parallel extraction with one chunk failing → others succeed, MAX_CHUNKS overflow guard
- **DB unit** (Jest): `findEntriesByHash` returns only matching character_id, `bulkInsertEntries` rolls back fully on simulated mid-insert error, soft-delete by `sourceRef` does not affect other source_ref rows
- **Heal-skip** (Node `node:test`): `memoryHealHandler` does not downgrade `source_type='user_document'` entries during contradiction / stale / orphan passes; does still seed new entries during missing-concepts pass
- **Schema migration** (Jest): v11 → v12 adds `source_hash` column and index; idempotent on re-run via skip guard

## Acceptance Criteria

- [ ] `SCHEMA_VERSION=16`; `MIGRATIONS[13]` adds `wiki_entries.source_hash`; `MIGRATIONS[14]` adds `source_ref`; `MIGRATIONS[15]` converts `source_hash` index to partial index; `MIGRATIONS[16]` adds partial index on `source_ref`; all reflected in `LATEST_SCHEMA_REQUIRED_COLUMNS`
- [ ] Drizzle Cloud SQL schema mirrors `source_hash` column + index; new migration generated
- [ ] `documentExtract` callable enforces: premium gate, daily rate limit (5/user/day), size cap (200K chars with truncation flag), hash verification, character ownership, chunk count ceiling
- [ ] Server-side parallel extraction succeeds when one chunk LLM call fails (returns partial facts; partial-failure flag surfaced in response or logged — TBD during impl)
- [ ] `documentIngestMachine` handles full happy path + cancel from each cancellable state + duplicate Replace/Add/Cancel + applying-phase atomicity
- [ ] Client computes SHA-256 over UTF-8 normalized content (Web Crypto on web, `expo-crypto` on native); matches server recomputation
- [ ] `wikiDatabase.bulkInsertEntries` is fully transactional — on simulated mid-insert error, no rows visible after rollback
- [ ] `memoryForget({ sourceRef })` soft-deletes all matching entries locally and (when cloud-synced) in Cloud SQL
- [ ] `memoryHealHandler` skips `source_type='user_document'` entries in contradiction/stale/orphan passes; covered by tests
- [ ] `ChatComposer` `+` button visible only for `usage.hasUnlimited` users; action sheet → picker → ingest flow works end-to-end on iOS, Android, Web
- [ ] Progress bar uses `useState`, no Reanimated additions
- [ ] Toast on `success` shows fact count + filename; toast on `error` shows error message
- [ ] `npm run typecheck && npm run lint && npm run test` green at root
- [ ] `cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/documentExtract.test.js && node --test lib/memoryFunctions.test.js` green

## UX Flow

```mermaid
flowchart TD
    A([User taps + in ChatComposer]) --> B{Premium?
usage.hasUnlimited}
    B -- No --> Z([Button not rendered])
    B -- Yes --> C[Action sheet:\nAdd document to memory]
    C -- Cancel --> N([idle])
    C -- Add document --> D[expo-document-picker\n.txt .md MIME filter]
    D -- Cancelled --> N
    D -- File picked --> E[Read file as UTF-8\nCompute SHA-256]
    E -- Error --> ER[Toast error] --> N
    E -- Done --> F[wikiDatabase.findEntriesByRef\n(filename / source_ref)]
    F -- No match --> H[documentExtract callable]
    F -- Match --> G{Action sheet:\nReplace · Add · Cancel}
    G -- Cancel --> N
    G -- Replace --> P[forgetMemory sourceRef\nsoft-delete prior entries]
    P --> H
    G -- Add --> H
    H -- 5xx / abort --> ER
    H -- Rate limited --> ER
    H -- Hash mismatch --> ER
    H -- Done\n facts payload --> I[bulkInsertEntries\nsource_type=user_document\nsource_hash + source_ref]
    I -- Tx rollback --> ER
    I -- Done --> J[Append memory_events action\nInvalidate memoryBundle queryKey]
    J --> K([Toast: Added N memories from filename])
    K --> N

    %% Cancellation paths
    E -. CANCEL .-> N
    F -. CANCEL .-> N
    G -. CANCEL .-> N
    H -. CANCEL .-> N

    classDef premium fill:#7c3aed,color:#fff,stroke:#5b21b6
    classDef callable fill:#1d4ed8,color:#fff,stroke:#1e40af
    classDef local fill:#065f46,color:#fff,stroke:#064e3b
    classDef decision fill:#92400e,color:#fff,stroke:#78350f
    classDef terminal fill:#1f2937,color:#fff,stroke:#111827

    class B,G decision
    class H,P callable
    class F,I,J local
    class A,N,Z,ER,K terminal
    class C,D,E premium
```
