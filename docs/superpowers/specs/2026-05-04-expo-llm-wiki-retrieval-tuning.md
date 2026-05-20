# Spec: Upgrade @equationalapplications/expo-llm-wiki — Retrieval Tuning (v2.6.0)

**Date:** 2026-05-04
**Status:** Draft — blocked on expo-llm-wiki retrieval-tuning PR merge + publish
**Follows:** `2026-05-04-expo-llm-wiki-upgrade.md` (v2.5.0 hooks-first refactor)
**Package spec:** `expo-llm-wiki/docs/superpowers/specs/2026-05-04-retrieval-tuning.md`

> **Note:** This spec was written for an earlier upgrade plan. The current repository now uses `@equationalapplications/expo-llm-wiki@4.9.0`.

> **Version note (2026-05-05):** `^2.6.0` in this spec is a placeholder. v2.6.0 of
> `@equationalapplications/expo-llm-wiki` was already published (CI fixes + integration
> tests only; no retrieval-tuning features). The retrieval-tuning branch (`feat/retrieval-tuning`)
> is still in code review. When merged, the expo/react packages will publish as the next
> minor (likely `^2.7.0`). Update all version references below once the actual version is known.

---

## Background

`expo-llm-wiki` v2.6.0 ships five retrieval improvements to `packages/core` — all additive,
no breaking changes:

1. **BLOB embedding storage** — `embedFact()` writes `Float32Array` bytes to a new
   `embedding_blob BLOB` column; JSON `embedding TEXT` preserved for backward reads until
   `runReembed()` migrates them.
2. **Two-phase SELECT in `read()`** — phase 1 fetches scoring columns only for all N rows;
   phase 2 fetches `SELECT *` only for the top `maxResults` winners. Eliminates loading full
   fact bodies/tags/embeddings for every row on every read.
3. **In-memory vector cache** — `WikiMemory` keeps parsed `Float32Array` vectors in a per-entity
   `Map` across calls; invalidated on any mutation. Eliminates repeated JSON/BLOB parse on
   repeated reads within a session.
4. **`preFilterLimit`** — caps the O(N) cosine scan by running MiniSearch first and limiting
   cosine scoring to the top-K keyword candidates. Recommended for entities with >500 facts.
5. **`hybridWeight`** — blends cosine and BM25 keyword scores (`weight × semantic + (1−weight) × keyword`).
   `hybridWeight: 0` skips `embed()` entirely (pure keyword, no LLM API call).

New public API surface added by v2.6.0:

```typescript
// New interface — per-call overrides
interface ReadOptions {
  maxResults?: number;
  preFilterLimit?: number | null;  // null = disable config-level preFilterLimit for this call
  hybridWeight?: number;
}

// WikiConfig — two new optional fields
interface WikiConfig {
  preFilterLimit?: number;   // default undefined (full scan)
  hybridWeight?: number;     // default undefined (pure semantic when embed provided)
}

// wiki.read() — optional third parameter
wiki.read(entityId: string, query: string, options?: ReadOptions): Promise<MemoryBundle>

// New public method on WikiMemory
wiki.clearVectorCache(): void
```

All existing call sites (`wiki.read(characterId, message.text)`) are unaffected — the third
parameter is optional and existing `WikiConfig` configs require no changes to continue working.

---

## Goals

- Bump `@equationalapplications/expo-llm-wiki` from `^2.5.0` to `^2.6.0`.
- Configure `preFilterLimit` in `wikiService.ts` `WikiConfig` to cap cosine scans for characters
  with large fact stores.
- Pass `ReadOptions` to `wiki.read()` in `useAIChat.ts` to enable hybrid scoring for the
  pre-turn context read, improving retrieval quality when a message contains precise terminology
  (character names, ability names, locations) alongside conceptual meaning.
- Verify the DB migration (v3 `embedding_blob` column) runs cleanly on app startup.
- All existing tests pass. No regression in chat memory or cloud sync.

---

## Scope

### Included

- Dependency bump to `^2.6.0`.
- Add `preFilterLimit: 300` to `WikiConfig` in `wikiService.ts`. This limits cosine scoring to
  at most 300 keyword-matched candidates before performing the embedding comparison, capping
  O(N) growth for characters who accumulate >300 facts. No effect on characters with fewer facts
  (MiniSearch returns all candidates when the total is below the limit).
- Add `hybridWeight: 0.7` to `WikiConfig` in `wikiService.ts` as the default blend weight for
  all `wiki.read()` calls. This gives 70% weight to semantic similarity and 30% to keyword
  overlap, improving recall for queries with specific terminology that might score low on
  pure-cosine retrieval.
- Verify `npm run typecheck` passes with the new `ReadOptions`/`WikiConfig` fields.
- Verify all tests pass.

### Excluded

- Calling `wiki.runReembed()` explicitly — migration is lazy. Old TEXT embeddings are served
  correctly until the librarian naturally re-embeds them. No forced backfill.
- Calling `wiki.clearVectorCache()` — no bulk read workloads in this app; the automatic cache
  is net-positive for session performance.
- Per-call `ReadOptions` overrides in `useAIChat.ts` — the `WikiConfig` defaults cover the
  only `wiki.read()` call site. Per-call overrides would be needed only if a second call site
  with different requirements is added.
- UI surface for `hybridWeight`/`preFilterLimit` tuning — deferred.
- Any other `packages/expo` or `packages/react` API changes (none shipped in v2.6.0).

---

## Integration touchpoints

### `src/services/wikiService.ts`

The only file that needs a code change. Add `preFilterLimit` and `hybridWeight` to the `config`
block passed to `createWiki`:

```typescript
_wiki = createWiki(db, {
  llmProvider: createWikiLlmProvider(),
  config: {
    tablePrefix: 'llm_wiki_',
    autoLibrarianThreshold: 20,
    preFilterLimit: 300,
    hybridWeight: 0.7,
  },
})
```

### `src/hooks/useAIChat.ts`

No code change required. `wiki.read(character.id, message.text)` continues to work unchanged;
the new `WikiConfig` defaults apply automatically.

### DB migration

`WikiMemory.setup()` (called via `wiki.setup()` in `initWiki()`) runs migration v3 on first
launch after the upgrade. The migration is additive — `ALTER TABLE ... ADD COLUMN embedding_blob BLOB`
— and idempotent (checks `PRAGMA table_info` before adding). No user data is affected.

---

## Risk areas

- **`hybridWeight` + `preFilterLimit` interaction:** When both are set and MiniSearch returns
  zero candidates, `read()` returns an empty facts array (by design — documented in the package
  spec). At `hybridWeight: 0.7` and `preFilterLimit: 300`, this can only occur when the query
  has zero keyword overlap with any of the character's facts. In practice this is rare and an
  empty context block is already handled by the `if (bundle)` guard in `useAIChat.ts`.
- **Migration on existing devices:** `ALTER TABLE ... ADD COLUMN` is safe on SQLite with
  `expo-sqlite`. The migration is guarded by `PRAGMA table_info` for idempotency. No data loss.
- **`hybridWeight` on characters without embeddings:** When `embed` is absent or throws,
  `hybridWeight` is ignored and MiniSearch fallback runs unchanged (existing behavior). The
  `onRetrievalFallback` callback fires if configured.
- **Backward compatibility:** The retrieval-tuning release is additive from Clanker's perspective —
  `read()` third param is optional, `WikiConfig` fields are optional, migration is additive-only.
  Note: `packages/core` was bumped to v3.0.0 internally (breaking: `WikiBusyOperation` union
  extended with `'import'` and `'forget'`), but Clanker uses only `instanceof WikiBusyError` checks
  — no exhaustive switches on `.operation` exist in the codebase. No code changes required.
- **Version number:** v2.6.0 is already published (CI fixes only). Confirm actual published version
  before executing and update `package.json` reference accordingly.

---

## Acceptance criteria

- `package.json` references `^<actual-version>`; `npm install` succeeds.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test` passes with no regressions in `wikiService`, `characterSyncWiki`, `aiChatService`,
  `chatComposer` test suites.
- `wikiService.ts` `WikiConfig` includes `preFilterLimit: 300` and `hybridWeight: 0.7`.
- Manual verification: DB migration runs cleanly on a device/simulator with existing data
  (no crash, no data loss; `embedding_blob` column present in schema after first launch).

---

## Verification steps

1. Confirm published version: `npm view @equationalapplications/expo-llm-wiki versions --json | tail -5`.
   Use the version that contains the retrieval-tuning features (will be newer than `2.6.0`).
2. Bump `@equationalapplications/expo-llm-wiki` in `package.json` from `^2.5.0` to `^<actual-version>`.
3. Run `npm install`.
4. Check `node_modules/@equationalapplications/expo-llm-wiki/CHANGELOG.md` for retrieval-tuning
   features (`embedding_blob`, `ReadOptions`, `preFilterLimit`, `hybridWeight`). Note: `packages/core`
   bumped to v3.0.0 internally; no Clanker code changes needed (all `WikiBusyError` usage is
   `instanceof`-only, no exhaustive switches on `.operation`).
5. Run `npm run typecheck` — verify `WikiConfig` accepts `preFilterLimit` and `hybridWeight`.
6. Add `preFilterLimit: 300` and `hybridWeight: 0.7` to `WikiConfig` in `wikiService.ts`.
7. Run `npm run lint`.
8. Run `npm test -- --testPathPattern="wikiService|characterSyncWiki|aiChatService|chatComposer" --runInBand`.
9. Manual: fresh simulator run → confirm `llm_wiki_entries` has `embedding_blob` column after
   first launch (inspect via DB browser or add a debug log to confirm migration ran).

---

## Notes

- `preFilterLimit: 300` is a conservative starting value. At 300 keyword candidates the cosine
  scan is already 40× faster than a 12 000-fact full scan. Tune up if recall degrades at scale.
- `hybridWeight: 0.7` was chosen to match the package spec example for a balanced retrieval
  use case that still prioritises semantic meaning. Characters in Clanker often have rich,
  context-specific fact stores where exact terminology matters (names, abilities, story arcs).
- The `ReadOptions.preFilterLimit: null` escape hatch (disabling config-level pre-filter for
  a single call) is available but not needed now. Relevant if a future "full semantic search"
  feature is added.
- `wiki.clearVectorCache()` is available for future use (e.g., after a large ingest batch),
  but auto-invalidation on `ingestDocument()` already handles that case.
