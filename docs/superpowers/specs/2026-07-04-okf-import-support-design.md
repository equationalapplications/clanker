# Spec: OKF Import — Restoring and Cloning Character Memory

**Date:** 2026-07-04
**Status:** Implemented
**Branch:** `feat/okf-import`
**Related:** `2026-07-03-okf-export-design.md`, `@equationalapplications/core-llm-wiki`

## Problem

Users can export a character's complete memory graph to an OKF zip bundle (`2026-07-03-okf-export-design.md`, shipped), but there is no way to bring a bundle back in. Users cannot restore backups, nor share pre-trained character memory templates with others.

## Verification Against Installed Package (2026-07-04)

The draft this spec is based on assumed `wiki.importDump(dump, { merge })` and `parseOkfBundle` exist and behave a certain way. Both were verified directly against `node_modules/@equationalapplications/core-llm-wiki/dist/{index,chunk-AV2ZNKEA}.mjs` rather than taken on faith — this changes two load-bearing details of the original draft.

### `importDump` exists and already does exactly what a "merge/replace restore" needs

```typescript
declare class WikiMemory {
  importDump(dump: MemoryDump, opts?: { merge?: boolean }): Promise<void>
}
```

Internals (`ImportExportService.doImportEntity`, `chunk-AV2ZNKEA.mjs:1708`):

- **`merge: false` ("Replace"):** before importing, `bulkSoftDeleteByEntityId` on facts and tasks, `bulkDeleteByEntityId` (hard delete) on edges, `deleteCheckpoint`. **Events are never cleared** — there is no bulk-delete for events in either mode; old episodic events remain regardless of merge/replace. This is a real gap in the underlying package, not a choice we get to make — the UI copy for "Replace Memory" must not claim event history is wiped, only facts/tasks/edges.
- **`merge: true`:** per fact/task, `if (merge && safeUpdatedAt <= existing.updated_at) continue` — otherwise upsert. So "Merge Backup" already means exactly "update if the imported item is newer," confirming the draft's UI copy without further work needed.
- **Events and edges** always go through `addIgnoreDuplicate` (by `id`) in both modes — never updated once present, only inserted if the id is new.

### Cross-entity ID collision is actively guarded — and this _is_ the reason cloning needs ID remap

For every fact/task, before upserting: `existingFactsById.get(fact.id)` is looked up **across the whole local database, not scoped to the importing entity**. If found and `existing.entity_id !== entityId`, the row is logged via `_warnCrossEntityCollision` and **skipped** — never imported, never overwritten:

```javascript
if (existing) {
  if (existing.entity_id !== entityId) {
    this._warnCrossEntityCollision('entry', fact.id, existing.entity_id, entityId)
    continue
  }
  if (merge && safeUpdatedAt <= existing.updated_at) continue
}
```

Concretely: if a user exports character A, then tries to "clone" that bundle into new character B **on the same device**, every fact/task whose id still exists under A gets silently skipped. The result is a near-empty or fully-empty B, not a corrupted graph — but also not a working clone. This confirms and sharpens the draft's premise: **ID remapping is not a nice-to-have for cloning, it is required for the clone to contain any data at all when the source character is still present on-device.**

### `parseOkfBundle` takes the target `entityId` as an argument — it already stamps ownership

```typescript
declare function parseOkfBundle(
  entityId: string,
  files: OkfFile[],
  options?: OkfImportOptions,
): MemoryDump
```

Every fact/task/edge/event produced by `parseOkfBundle` already has `entity_id` set to whatever `entityId` you pass in — this is not something the remap step needs to rewrite itself. For facts and tasks, what `parseOkfBundle` does **not** do is regenerate the `id` fields — those come straight from each concept file's frontmatter `id:` (`resolvedId`), i.e. the _original_ character's ids. That's the collision surface described above.

This simplifies the original draft's `cloneOkfDumpForEntity` step list — `entity_id` rewriting is a side effect of which `entityId` you pass to `parseOkfBundle`, not a separate rewrite pass.

### Import can throw synchronously if the entity is busy

`importDump` calls `jobManager.acquireImportLocks(entityIds)` up front, which throws `WikiBusyError(operation, entityId)` **synchronously, before any DB write**, if a librarian/heal/prune/reembed/ingest/forget/import job is already active for that entity, or if a global import is already in flight. This is not a vague "locked/busy DB" case to hand-wave in error handling — it's a specific, typed, importable error class (`WikiBusyError`) the hook must catch and translate into a "try again in a moment" toast, not a generic failure toast.

`WikiBusyError`'s re-export path is confirmed, not just plausible: `expo-llm-wiki/dist/index.mjs` does `export * from '@equationalapplications/core-llm-wiki'`, and `core-llm-wiki/dist/index.mjs`/`index.d.ts` both list `WikiBusyError` in their export set. The `instanceof` check in the hook works as written — no duck-typing fallback needed.

### Events duplicate on every restore — no idempotency, unlike facts/tasks/edges (gap, requires a decision)

`parseOkfBundle` regenerates **every event's `id`** on each parse via `generateId("evt_")` (`index.mjs:2691`) — `log.md` carries no persisted event id, unlike facts/tasks (frontmatter `id:`) or edges (derived from source/target/type, see below). The events table's only constraint is the `id` primary key (`core-llm-wiki/dist/index.mjs:60-67` — no `UNIQUE` beyond that), and `EventRepository.addIgnoreDuplicate` is a plain `INSERT OR IGNORE` keyed on that fresh, always-new id.

Edges don't have this problem despite also getting fresh ids from `parseOkfBundle` (`generateId()`, `index.mjs:2663`) — the edges table has `UNIQUE(entity_id, source_id, target_id, edge_type)` (`index.mjs:55`), so `INSERT OR IGNORE` is content-idempotent regardless of the id. Events have no equivalent tuple constraint.

**Consequence:** restoring a merge-mode backup onto a character that still has its existing data duplicates every event in the bundle, every time. Replace mode doesn't help — it never clears events (see above) — so repeated restores grow the timeline unboundedly with duplicate rows. This hits the primary "restore my backup" path, not just the wrong-file edge case the collision guard covers.

**Decision:** before calling `importDump`, the import pipeline diffs `dump.entities[entityId].events` against the target entity's existing events (fetch via `wiki.exportDump([entityId])` — a second local-only read, cheap) and drops any event whose `(event_type, summary, UTC-day of created_at)` tuple already exists. This mirrors the granularity `parseLogMd`/`buildLogMd` actually preserve (log entries are date-stamped, not timestamped), so it doesn't require a schema or upstream change. Applies to both merge and replace paths — replace doesn't clear events either, so the same duplication risk applies there too.

## Goals

- Local-first import pipeline using `expo-document-picker` + `JSZip` (both already installed — `jszip@^3.10.1`, `expo-document-picker@~56.0.4` — no new dependency).
- **Existing-Character Import (Restore):** "Merge" (default) or "Replace" (destructive, behind confirmation) into an existing character, via `wiki.importDump(parseOkfBundle(characterId, files), { merge })`.
- **New-Character Import (Cloning):** create a new character seeded by a bundle, remapping fact/task ids and their relationship references so the import isn't silently gutted by the cross-entity collision guard described above.
- Preview step (fact/task/event/edge counts, warnings) before any DB write.
- Defend against untrusted zip input (bomb, malformed files) before it ever reaches `parseOkfBundle`.

## Non-Goals (V1)

- Ontology manifest import (Phase 2, matches export's own deferral).
- Cloud-based import — all parsing stays on-device.
- Immediate re-sync after import (existing `wikiSync` background loop picks it up).
- Multi-entity bundles (V1 targets single-character bundles, matching `formatOkfBundle`'s single-entity export UI).

---

## Architecture & Data Flow

### The Pipeline (`src/utilities/okfImport.ts`)

1. **Pick:** `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ['application/zip', 'application/x-zip-compressed'] })` — mirrors the picker call already used in `src/components/ChatComposer.tsx:62` for document ingest, including its `size` pre-check against a byte cap before reading (see `MAX_DOCUMENT_RAW_BYTES` precedent at `src/components/documentMimeTypes.ts:4`, currently `9_000_000` for plain-text ingest; OKF bundles are zipped archives of many small files, so this needs its own, larger constant — see Defensive Filtering below).
2. **Read:** `new File(uri).arrayBuffer()` (the `expo-file-system` v56 `File` class already used in `okfSave.ts` and `ChatComposer.tsx` — the legacy string-path API throws at runtime on this `expo-file-system` version) → `JSZip.loadAsync(arrayBuffer)`.
3. **Defensive Filtering** (before any content is handed to `parseOkfBundle`):
   - Cap total entry count in the zip (e.g. 5,000 — an OKF bundle is one fact/task file per entry plus a couple of index files; 5,000 comfortably covers any real character while rejecting a crafted zip with hundreds of thousands of empty entries).
   - Cap total decompressed size across all entries, checked via each entry's `zipObject._data.uncompressedSize` _before_ calling `.async('string')` on it — reading the size metadata JSZip already parsed from the central directory costs nothing, so this is a cheap first gate. **But `_data` is a private, untyped JSZip internal, and the value is attacker-controlled header metadata** — a crafted zip can declare a small `uncompressedSize` while actually inflating to something huge (or the field can be absent/wrong on some encoders). Treat it as a fast pre-filter only: also track a running total of actual `content.length` after each entry's `.async('string')` resolves, and abort the moment the running total crosses the cap. This is the real zip-bomb defense; the pre-check just avoids doing that work for the obviously-oversized case.
   - Filter to an **exact allow-list** of OKF path shapes, not a loose "`.md` plus structural files" rule: `index.md`, `entities/{id}/index.md`, `entities/{id}/log.md`, `entities/{id}/facts/*.md`, `entities/{id}/tasks/*.md`. This must exclude the bundle's own `README.md` (added by the export pipeline at bundle root, see export spec) — `README.md` is a `.md` file that is neither `index.md` nor `log.md`, so a looser filter lets it through. Because `resolveRoute` falls back to `defaultSchema ?? "fact"` for any concept-file path it doesn't recognize as `/facts/` or `/tasks/` (`core-llm-wiki/index.mjs:2544-2551`), an admitted `README.md` parses as a fact with `id: "README"` and the entire README text as its body — a real, reproducible bug when re-importing a bundle this same feature exported, not a hypothetical. The exact allow-list above prevents it structurally.
   - Reject bundles containing more than one `entities/{id}/` directory. V1 targets single-entity bundles only (see Non-Goals), but `parseOkfBundle` has no such guard itself — it folds every concept file matching the allow-list into whatever single `entityId` is passed to it, regardless of which `entities/{id}/` directory it came from. Picking a multi-character export bundle would silently merge multiple characters' facts/tasks/events into the one target entity. Count distinct `entities/{id}/` prefixes during filtering; if more than one, reject with "This bundle contains multiple characters — multi-character import isn't supported yet."
4. **Parse & Preview:** `parseOkfBundle(targetEntityId, sanitizedFiles)` → `MemoryDump`. Build a preview from `dump.entities[targetEntityId]`: fact/task/event counts, plus a count of edges reconstructed via markdown-link scanning (fidelity note carried over from the export spec: only `source_id`/`target_id`/`edge_type` survive the round trip — `id`/`created_at` are regenerated by `parseOkfBundle` itself via `generateId()`/`Date.now()`, this is unrelated to and unaffected by our own clone-remap step below).

   **Clone path caveat:** on the restore path, `targetEntityId` is the existing character's real id at preview time, so this step is exactly as described. On the **clone path it is not** — per the UI flow below, the new character record doesn't get created until _after_ preview/confirm, so no real `targetEntityId` exists yet when preview needs to run. The pipeline must not parse-and-cache a `MemoryDump` keyed to a placeholder id for later reuse: `remapOkfDumpIds` reads `dump.entities[targetEntityId]` (step 1 below) and does not rewrite `entity_id` itself (it's already stamped by whichever id was passed to `parseOkfBundle` — see "ID Remapping" below), so a dump parsed against a placeholder would need its every fact/task/event's `entity_id` fixed up too, which is exactly the rewrite step this design deliberately avoids doing separately. Instead: cache the sanitized **files**, not the parsed dump. Preview counts are id-independent (they only need array lengths), so preview can parse with any placeholder id (or count concept files directly by allow-listed path, skipping `parseOkfBundle` entirely for the count). At commit time, once the new character id is known, parse for real: `parseOkfBundle(newCharacterId, cachedFiles)` → `remapOkfDumpIds(dump, newCharacterId)` → `importDump`. Re-parsing is cheap (pure string/regex work, no I/O), so doing it twice (once for preview, once for commit) is not a meaningful cost.

5. **Remap (clone path only):** see below.
6. **Commit:** `wiki.importDump(dump, { merge })` — `merge` only meaningful for the restore path. The clone path passes a dump whose ids are already known-new, so there's nothing to merge against or replace on a brand-new character — but `importDump`'s default (`opts?.merge ?? false`, `chunk-AV2ZNKEA.mjs:1668`) is _replace_, which still runs `bulkSoftDeleteByEntityId`/`bulkDeleteByEntityId`/`deleteCheckpoint` against the new (empty) entity before importing. These are harmless no-ops against an entity with no existing rows, but to avoid the pointless queries and to make the intent explicit in the call site, the clone path passes `{ merge: true }` explicitly rather than omitting `opts`.

### ID Remapping for Cloning (`remapOkfDumpIds`, not `cloneOkfDumpForEntity`)

Renamed from the draft's `cloneOkfDumpForEntity` because, per the verification above, entity ownership is already correct coming out of `parseOkfBundle(newCharacterId, files)` — this function's only job is regenerating primary keys so the new character's rows don't collide with the source character's still-existing rows.

Given `dump.entities[newCharacterId]` (already entity-scoped correctly by `parseOkfBundle`):

1. For every fact and task, generate a new id via `randomUUID()` from `expo-crypto` (the id-generation utility already used elsewhere in this codebase, e.g. `src/utilities/makePackagePurchase.ts:71` — no new dependency). Build `oldId -> newId`.
2. Rewrite each edge's `source_id`/`target_id` through the map; drop edges where either endpoint isn't in the map (defensive — shouldn't happen since `parseOkfBundle` only produces edges between concept files it parsed, but a dangling reference should be dropped, not silently written with a stale id).
3. Rewrite each event's `related_entry_id` through the map when present; leave `null` alone.
4. Events need no id-remap step here — unlike facts/tasks, `parseOkfBundle` already regenerates every event's `id` on each parse (`generateId("evt_")`, no id survives from the source bundle's `log.md`), so there is no "old event id" to collide in the first place. (This also means event _deduplication_ is a separate, unrelated concern from remapping — see the events-duplicate-on-restore gap above, which affects the restore path, not clone: a clone always targets a brand-new, empty entity, so there's nothing for the new events to collide or duplicate against.)
5. `entity_id` is **not** rewritten here — it's already correct from step in the pipeline above.

## UI Integration

### 1. Existing-Character Restore

**Location:** `app/(drawer)/(tabs)/characters/[id]/edit.tsx`, next to the existing Export button (`~line 561`, `mode="outlined"`, `icon="export-variant"`, `style={styles.shareButton}` — new Import button follows the identical `Button` shape/style, `icon="import"` or similar, placed directly after it).

- **Flow:** tap "Import OKF Backup" → picker → preview.
- **Preview:** "Ready to import 42 facts, 5 tasks, 120 timeline events, 18 relationships."
- **Actions:**
  - **"Merge Backup" (default):** `parseOkfBundle(characterId, files)` → `importDump(dump, { merge: true })`.
  - **"Replace Memory" (destructive, secondary confirmation):** same parse, `importDump(dump, { merge: false })`. Confirmation copy must say "facts, tasks, and relationships" — **not** "everything" — since events are never cleared by replace mode (verified above).

### 2. New-Character Cloning

**Location:** `app/(drawer)/(tabs)/characters/list.tsx`, near the existing "New Character" creation action (`~line 33`, `create({ name: 'New Character', is_public: false })`).

- **Flow:** tap "Create from OKF Bundle" → picker → preview → confirm.
- **Actions:** preview parses the picked/sanitized files with a placeholder id (or counts allow-listed concept files directly) for display purposes only — see the clone-path caveat under Pipeline step 4, the parsed-with-placeholder dump is never passed to `importDump`. On confirm: create character record locally (reuse the existing `create()` call, feeding it a name derived from the bundle's `index.md` if present) → `parseOkfBundle(newCharacterId, cachedFiles)` (real parse, using the now-known new character id) → `remapOkfDumpIds(dump, newCharacterId)` → `importDump(remappedDump, { merge: true })` → navigate to the new character's chat screen.

## Hook Layer (`src/hooks/useImportCharacterOKF.ts`)

Modeled on the real `useExportCharacterOKF` (`src/hooks/useExportCharacterOKF.ts`), including its in-flight guard (`inFlightRef`) and error-normalization pattern — not the draft's simplified sketch:

```typescript
import { useCallback, useRef, useState } from 'react'
import { useWiki, parseOkfBundle, type OkfFile } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import { pickAndReadOkfBundle, OkfPickCancelledError } from '~/utilities/okfImport'
import { remapOkfDumpIds } from '~/utilities/okfImportRemap'
import { dedupeEventsAgainstExisting } from '~/utilities/okfImportDedupe'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'

export interface OkfPreviewStats {
  facts: number
  tasks: number
  events: number
  edges: number
}

type ImportMode = 'merge' | 'replace' | 'clone'

export function useImportCharacterOKF() {
  const wiki = useWiki()
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [preview, setPreview] = useState<OkfPreviewStats | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [didImport, setDidImport] = useState(false)
  // Cache raw files, not a parsed MemoryDump — the clone path doesn't know
  // the real target entity id until after the character record is created
  // (see the clone-path caveat under Pipeline step 4), so parsing happens
  // once at preview (for display counts only) and again for real at commit.
  const filesRef = useRef<OkfFile[] | null>(null)
  const inFlightRef = useRef(false)

  const handlePickAndPreview = useCallback(async (previewEntityId: string) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setIsParsing(true)
    setError(null)
    setPreview(null)
    setDidImport(false)
    try {
      const files = await pickAndReadOkfBundle()
      filesRef.current = files
      // previewEntityId is the real character id on the restore path, or a
      // throwaway placeholder on the clone path — counts are id-independent.
      const dump = parseOkfBundle(previewEntityId, files)
      const entity = dump.entities[previewEntityId]
      setPreview({
        facts: entity?.facts.length ?? 0,
        tasks: entity?.tasks.length ?? 0,
        events: entity?.events.length ?? 0,
        edges: entity?.edges?.length ?? 0,
      })
    } catch (err) {
      if (err instanceof OkfPickCancelledError) return
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, 'okf-import:preview')
    } finally {
      inFlightRef.current = false
      setIsParsing(false)
    }
  }, [])

  const handleCommitImport = useCallback(
    async (targetEntityId: string, mode: ImportMode) => {
      if (!filesRef.current || inFlightRef.current) return
      inFlightRef.current = true
      setIsImporting(true)
      setError(null)
      try {
        // Real parse against the real target id — required on the clone path
        // (targetEntityId only exists now, post character-creation) and
        // harmless-but-consistent on the restore path (same id as preview).
        let dump = parseOkfBundle(targetEntityId, filesRef.current)
        if (mode === 'clone') {
          dump = remapOkfDumpIds(dump, targetEntityId)
        } else {
          // Events have no stable id across parses (parseOkfBundle regenerates
          // them every time) and no uniqueness constraint beyond id, so a
          // merge/replace restore duplicates every event unless we filter
          // against what's already there first. Clone always targets a
          // brand-new, empty entity, so this step is skipped for it.
          dump = await dedupeEventsAgainstExisting(wiki, targetEntityId, dump)
        }
        await wiki.importDump(dump, mode === 'replace' ? { merge: false } : { merge: true })
        filesRef.current = null
        setPreview(null)
        setDidImport(true)
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err))
        // Keep the original message intact for reportError/telemetry; carry the
        // user-facing copy separately so the busy-retry case doesn't clobber
        // the underlying WikiBusyError(operation, entityId) detail.
        setError(
          err instanceof WikiBusyError
            ? Object.assign(normalized, {
                displayMessage: 'Memory is busy right now — try again in a moment.',
              })
            : normalized,
        )
        reportError(normalized, `okf-import:${targetEntityId}`)
      } finally {
        inFlightRef.current = false
        setIsImporting(false)
      }
    },
    [wiki],
  )

  const handleCancel = useCallback(() => {
    filesRef.current = null
    setPreview(null)
    setError(null)
  }, [])

  return {
    isParsing,
    isImporting,
    preview,
    error,
    didImport,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel,
  }
}
```

`didImport` is what the UI branches on for the success toast — mirrors the export spec's `lastResult`/`didExport` pattern (export spec line ~199) and exists for the identical reason: `error === null` is also true before any import has run, so it can't drive a success toast by itself. `filesRef` is cleared and `preview` reset on successful commit so a second tap of the (now-stale) commit button doesn't silently re-import the same bundle.

## Error Handling

### Zip Safeguards Trip

- Entry-count or uncompressed-size cap exceeded → reject before any decompression, distinct toast ("Bundle too large or malformed").

### Malformed / Non-OKF Zip

- No concept files survive filtering, or `parseOkfBundle` throws on unparseable frontmatter → toast: "This doesn't look like a valid OKF backup."

### Cross-Entity Collision on Restore (not clone)

- Restoring a backup for character A using a bundle whose ids somehow belong to a _different_ still-live character B (e.g. user picked the wrong export file) → rows silently skipped per the collision guard, no exception thrown, no report. `importDump` returns `Promise<void>` — there is no count of what was skipped vs. upserted, and no public API to preflight it (`findExistingMetadataByIds` is internal to `ImportExportService`, not exposed on `WikiMemory`). A pre/post row-count diff was considered but rejected: it can't distinguish "skipped due to collision" from "updated in place" (merge mode leaves count unchanged in both cases). **Decision: generic "Import complete" toast, no skipped-count claim.** The collision case only arises when restoring the wrong file into the wrong character while the source character is still on-device — rare, and the guard already prevents data corruption, which was the actual risk worth engineering against. Building exact skip-tracking for this would require a new public method on `WikiMemory` in `core-llm-wiki` — out of scope for this feature; revisit only if user reports of "my restore did nothing" show up in practice.

### `WikiBusyError` (entity mid-maintenance)

- Thrown synchronously by `acquireImportLocks` before any write. Toast: "Try again in a moment" with retry, not a generic failure message — this is an expected, recoverable condition (librarian/heal/prune/ingest job in flight), not a bug.

### Cancellation

- Picker cancel (`pickerResult.canceled`) → `OkfPickCancelledError`, swallowed silently (same pattern as `OkfSaveCancelledError` in `okfSave.ts`), no toast.

## Documentation Updates

### Developer Documentation

- **New file:** `docs/okf-import-export.md` — bundle shape (link to export spec's verified layout), merge/replace/clone semantics including the events-not-cleared-on-replace gap, the events-duplicate-without-dedup gap, the cross-entity collision guard, the id-remap rules for cloning, untrusted-input caps.
- Link from `README.md` and the LLM Wiki section of `docs/ai-and-chat.md`.

### Public & User-Facing Documentation

- **`public/memory-export-with-okf/index.html`:** retitle "Import and Export Character Memory with OKF"; keep the existing route.
- **`src/components/LandingPage/FeaturesSection.tsx`:** update the existing OKF feature card body from "Export any character's complete memory..." to cover import/restore/clone.
- **`app/support.tsx`:** extend the existing OKF FAQ `Text`/`Text` pair (see the export spec's verified shape — hand-written `Card`, `Linking.openURL` for outbound links, no raw `<a>`) to mention restoring backups and cloning from shared bundles.
- **`src/config/privacyConfig.ts`:** extend the "Data Portability" section added by the export spec to note bundles can be re-imported; bump `PRIVACY.version` again.
- **`src/constants/okfReadmeContent.ts`:** the README already written into every export bundle should explain how to bring the same bundle back in (restore vs. clone), since that's the first place a user encounters this question.

## Testing Strategy

### Utility Layer (`src/utilities/okfImport.ts`, `okfImportRemap.ts`, `okfImportDedupe.ts`)

- Zip safeguards: mocked entry with a huge declared `uncompressedSize` is rejected without calling `.async()` on it (assert the mock's decompression method was never invoked — that's the actual bomb defense, not just "throws eventually"); separately, an entry with a small/absent declared `uncompressedSize` but large actual decompressed content is caught by the running-total check, proving the pre-check alone isn't load-bearing.
- Filtering: only the exact allow-listed OKF path shapes survive (`index.md`, `entities/{id}/index.md`, `entities/{id}/log.md`, `entities/{id}/facts/*.md`, `entities/{id}/tasks/*.md`); a bundle-root `README.md` is dropped (regression test for the junk-fact bug above — feed a real exported bundle, including its README, back through the filter and assert no `README` fact appears in the parsed dump); a bundle containing more than one `entities/{id}/` directory is rejected before parsing.
- Remap: old ids fully absent from the output dump; edges/events resolve to new ids; an edge whose endpoint isn't in the id map is dropped, not left dangling.
- Round-trip: remapped dump fed through `importDump` (against a real or in-memory `WikiMemory`, not a mock) into a fresh entity, assert no `_warnCrossEntityCollision` path is hit (spy on `console.warn` or the equivalent) when the _source_ character's original rows still exist in the same DB — this is the actual regression test for the bug this whole remap step exists to prevent.
- Event dedup: importing the same bundle twice in merge mode against a character that already has the bundle's events produces no duplicate rows on the second import; importing two bundles whose events genuinely differ (different `event_type`/`summary`/day) does not cross-filter them.

### Hook Layer

- Merge flow re-parses with the real target id, runs event dedup, then passes `{ merge: true }`; replace flow re-parses, runs event dedup, then passes `{ merge: false }`; clone flow re-parses with the newly-created character id, runs remap (not dedup), then passes `{ merge: true }`.
- `WikiBusyError` surfaces a distinct retry-toast message from other errors, without losing the original error message for `reportError`.
- Cancel and successful commit both clear `filesRef`/`preview`; a second tap of a stale commit button after success is a no-op (`filesRef.current` is `null`).
- `didImport` flips to `true` only after `importDump` resolves without throwing, and resets to `false` at the start of the next `handlePickAndPreview`.

### CI

- `npm run typecheck && npm run lint && npm run test`.

## Dependencies

- `expo-document-picker` (`~56.0.4`), `jszip` (`^3.10.1`), `expo-file-system` (`~56.0.7`) — all already installed, all already used by the export/ingest features this mirrors. No new package needed.
- `expo-crypto`'s `randomUUID` for id regeneration — already a dependency, already used at `src/utilities/makePackagePurchase.ts:71`.

## References

- `node_modules/@equationalapplications/core-llm-wiki/dist/chunk-AV2ZNKEA.mjs:1631-1929` — `ImportExportService.importDump`/`doImportEntity` (read directly, 2026-07-04)
- `node_modules/@equationalapplications/core-llm-wiki/dist/chunk-AV2ZNKEA.mjs:518-537` — `acquireImportLocks`/`WikiBusyError` semantics
- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs:2620` — `parseOkfBundle` implementation
- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs:48-67` — `edges`/`events` table schema (`UNIQUE(entity_id, source_id, target_id, edge_type)` on edges; no equivalent on events beyond the `id` primary key — the basis for the events-dedup gap above)
- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs:1303,1392` — `EventRepository`/`EdgeRepository.addIgnoreDuplicate` bodies (plain `INSERT OR IGNORE` vs. tuple-checked)
- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs:2492-2551` — `isConceptFile`/`resolveRoute` (basis for the `README.md`-as-junk-fact bug above)
- `docs/superpowers/specs/2026-07-03-okf-export-design.md` — bundle layout, edge round-trip fidelity notes this spec inherits
- `src/hooks/useExportCharacterOKF.ts`, `src/utilities/okfSave.ts` — hook/utility patterns mirrored here
- `src/components/ChatComposer.tsx:62` — existing `expo-document-picker` usage pattern
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx:561`, `app/(drawer)/(tabs)/characters/list.tsx:33` — UI insertion points
