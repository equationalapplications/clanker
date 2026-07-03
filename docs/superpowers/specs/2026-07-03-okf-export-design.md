# Spec: OKF Export — Character Memory as Portable Bundle

**Date:** 2026-07-03 (revised after self-review)  
**Status:** Design Complete  
**Branch:** feat  
**Related:** [@equationalapplications/core-okf](https://www.npmjs.com/package/@equationalapplications/core-okf), Cloud Ontology & Graph Traversal Design Spec (2026-06-23)

## Problem

Users have rich, graph-connected memory stored locally in Clanker (facts, tasks, episodic events, and graph edges — managed by `@equationalapplications/expo-llm-wiki`). No way to:

- Export for backup/portability
- Share with external knowledge systems (OKF-aware tools)
- Integrate memory into other platforms
- Inspect/audit memory structure offline

## Prior Art in Installed Dependencies (verified 2026-07-03)

**This is the most important section of the spec.** An earlier draft designed a from-scratch OKF serializer using `@equationalapplications/core-okf`'s low-level primitives (`buildConceptDocument`, `serializeFrontmatter`, `buildLogMd`, `buildRootIndexMd`) directly. Inspection of the already-installed `node_modules/@equationalapplications/core-llm-wiki` package (a transitive part of `expo-llm-wiki`, already a dependency) showed that adapter **already exists and is re-exported**:

```typescript
import { formatOkfBundle, parseOkfBundle, type MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { useWikiExport } from '@equationalapplications/expo-llm-wiki' // react-llm-wiki re-export

const { execute } = useWikiExport()
const dump: MemoryDump = await execute([characterId])   // -> { generatedAt, entities: { [characterId]: MemoryBundle } }
const { files } = formatOkfBundle(dump)                  // -> OkfFile[] = { path, content }[]
```

`formatOkfBundle` already handles: frontmatter serialization, concept-document assembly, per-entity fact/task directories, and the event log — using `core-okf` primitives internally. **We do not need a direct dependency on `core-okf`, and we do not hand-roll frontmatter or concept-document assembly.** Our job shrinks to: fetch dump → format → **augment with edge links (gap, see below)** → zip → platform-save.

### Verified file layout produced by `formatOkfBundle`

```
index.md                              # root catalog (buildRootIndexMd), lists entities
entities/{sanitized-entityId}/index.md
entities/{sanitized-entityId}/log.md  # events, via buildLogMd; each entry links to its
                                       # related fact if event.related_entry_id is set
entities/{sanitized-entityId}/facts/{sanitized-factId}.md
entities/{sanitized-entityId}/tasks/{sanitized-taskId}.md
```

For a single-character export (`execute([characterId])`), `dump.entities` has exactly one key, so the bundle is effectively `entities/{characterId}/...` plus the root `index.md`. This nested-by-entity shape (not a flat `facts/`/`tasks/` at bundle root, as the earlier draft assumed) is what ships — it's also what `parseOkfBundle` expects on the way back in, so we should not flatten it ourselves.

### Gap: `formatOkfBundle` does not serialize graph edges

`MemoryBundle.edges` (`WikiEdge[]`, populated by `exportDump`/`getFullBundle` from the edges table added for "OKF graph import") is **not read by `formatOkfBundle` at all** — verified by reading the function body in `core-llm-wiki/dist/index.mjs`. Concept-document bodies are written verbatim from `fact.body` / (empty string for tasks); no "Related" section is appended from `bundle.edges`.

This matters because edges are a real, already-shipped part of the Cloud Ontology & Graph Traversal work (Phase 1), and losing them silently on export would make round-trips (export → external tool → re-import) lossy for anything using explicit graph relationships. `parseOkfBundle`, on the *import* side, does reconstruct edges — but only by scanning concept-document bodies for markdown links via `extractMarkdownLinks`. So: if we want edges to survive a round trip, **we must inject them into the body ourselves before zipping**, in a shape `extractMarkdownLinks`/`parseOkfBundle` can already read back.

**Decision:** add a thin post-processing pass after `formatOkfBundle`, before zipping — see [Edge Augmentation](#edge-augmentation) below. This is a small, targeted addition on top of the existing adapter, not a reimplementation of it.

## Goals

- Client-side generation (local-first, offline-safe, zero server load) — via `useWikiExport()` + `formatOkfBundle`
- Round-trip-safe graph edges (append markdown links `parseOkfBundle` can already parse back)
- Support both web and mobile platforms (browser download + expo-file-system/expo-sharing)
- V1 scope: facts + tasks + episodic log + edges. Defer ontology manifest serialization to Phase 2.

## Non-Goals (V1)

- Ontology manifest serialization (Phase 2, when ontology-editing UI ships — `mode` defaults to `'off'` for all characters today, so there's nothing meaningful to export yet)
- Cloud function endpoint (keep client-side; `useWikiExport`/`formatOkfBundle` are pure client-side calls already)
- Scheduled/batched export (manual UI trigger only)
- Re-import UI (reading OKF bundles back into a character) — `parseOkfBundle` already exists for this, but wiring it to an import UI is a separate feature/spec
- Multi-entity export (bundling several characters into one ZIP) — `formatOkfBundle` supports it structurally, but V1 UI only exposes a single-character export button
- Any change to `@equationalapplications/core-llm-wiki` itself (the edge gap is worked around at the call site, not patched upstream, to avoid taking a dependency-version bump mid-feature)

## Architecture

### Data Flow

1. User taps "Export Memory as OKF" in character settings
2. `useExportCharacterOKF(characterId)` calls `useWikiExport().execute([characterId])` → `MemoryDump`
3. `formatOkfBundle(dump)` → `{ files: OkfFile[] }` (facts, tasks, per-entity log, per-entity index, root index)
4. **Edge augmentation pass:** for each fact/task file, look up `bundle.edges` where `source_id` matches that concept's id; append a `## Related` markdown section with relative links, using existing sibling-vs-cross-directory logic (`./target.md` within same subfolder, `../tasks/target.md` / `../facts/target.md` across)
5. Add `README.md` at bundle root (static content, explains OKF + how to inspect/re-import)
6. Zip all files (`file.path` as-is becomes the zip entry path) via `jszip`
7. Platform-specific save:
   - **Web:** Standard HTML5 blob download (`<a href=blob>`)
   - **Mobile:** Write ZIP to device via `expo-file-system`, trigger share sheet via `expo-sharing`

### Edge Augmentation

For each `OkfFile` under `entities/{id}/facts/` or `entities/{id}/tasks/`:

1. Derive the concept's id from the frontmatter already embedded in `file.content` (or track id→path during the loop over `bundle.facts`/`bundle.tasks` before calling `formatOkfBundle`, then re-match by path afterward — implementation detail for the plan phase)
2. Find edges where `edge.source_id === conceptId`
3. For each match, compute the relative link:
   - Target is a fact and current file is a fact → `./{ targetSanitizedId }.md`
   - Target is a task and current file is a task → `./{ targetSanitizedId }.md`
   - Cross-type → `../facts/{ targetSanitizedId }.md` or `../tasks/{ targetSanitizedId }.md`
   - Skip (log warning) if `target_id` doesn't resolve to any known fact/task in the bundle (dangling edge, e.g. target soft-deleted)
4. Append:
   ```markdown

   ## Related

   - [edge_type](./target_id.md)
   ```
   to `file.content` (plain string concatenation — `formatOkfBundle`'s concept documents are just frontmatter + body text, so no re-parsing via `core-okf` primitives is needed to append a trailing section)

No direct `core-okf` dependency required for this step — it's string building against a known, already-verified output format.

### Key Design Decisions

#### Client-Side Generation

**Why:** Clanker is local-first. `useWikiExport()` reads directly from local SQLite. Zero server load, offline-safe, no stale-sync risk (vs. reading from a cloud mirror that may lag behind local writes).

#### Use `formatOkfBundle`, Not Hand-Rolled core-okf Calls

**Why:** Confirmed via package inspection that this adapter is already built, already a transitive dependency, and already produces spec-compliant OKF output (frontmatter, concept docs, index, log). Reimplementing it would duplicate ~150 lines of already-tested logic for no benefit.

#### Fetch via `exportDump`, Not the Retrieval-Path `getMemoryBundle`

**Why:** `getMemoryBundle` (used by `useMemoryBundle`, the existing chat-context hook) is a *retrieval* path — it may score, rank, or truncate results for prompt-context purposes. `exportDump`/`getFullBundle({ includeBlobs: true })` is the *completeness* path used by cloud-sync (`wikiMachine.ts`, `liveVoiceMachine.ts`) and is the correct source for "export everything this character knows."

#### Platform-Aware Save

**Why:** Expo/React Native environment differs from web. Mobile needs filesystem write + share sheet; web uses a standard blob anchor download.

## Bundle Structure

ZIP filename: `{character_name}_{YYYY-MM-DD}.okf.zip`

Contents (single-character export, as produced by `formatOkfBundle` + our augmentation + README):

```
├── index.md                              # root catalog (buildRootIndexMd), lists this entity
├── README.md                             # usage guide + OKF explanation (added by us)
└── entities/
    └── {sanitized-characterId}/
        ├── index.md                      # per-entity catalog (facts + tasks + log link)
        ├── log.md                        # episodic events, chronological (buildLogMd)
        ├── facts/
        │   ├── {sanitized-factId}.md      # frontmatter + body + our "## Related" section
        │   └── ...
        └── tasks/
            ├── {sanitized-taskId}.md      # frontmatter + our "## Related" section
            └── ...
```

Example fact file (`entities/{id}/facts/fact_abc123.md`), after augmentation:

```markdown
---
type: fact
title: "Prefers coffee over tea"
tags: ["preferences", "beverages"]
timestamp: "2026-07-03T14:30:00.000Z"
id: fact_abc123
entity_id: char_42
confidence: certain
source_type: user_stated
created_at: 1751500000000
access_count: 3
last_accessed_at: 1751520000000
deleted_at: null
---

User mentioned they prefer coffee over tea, especially in the mornings.

## Related

- [prerequisite_for](../tasks/task_ghi789.md)
```

(Frontmatter fields above reflect the real shape emitted by `factFrontmatter()` in `core-llm-wiki` — not a redesigned schema.)

**README.md** (static, written by our code, not by `formatOkfBundle`):
- What OKF is
- How to inspect the bundle locally (unzip, open in any markdown viewer)
- How to re-import into Clanker in the future (references `parseOkfBundle`, notes it's not yet wired to a UI)
- Notes that ontology/taxonomy info is not included in this version

## UI Integration

### Character Settings Screen

Add button in settings near privacy/data management section:

**"Export Memory as OKF"**

States:
- **Enabled:** default
- **Loading:** spinner modal ("Generating bundle...") while `isExporting`
- **Success:** toast + platform save flow completes
- **Error:** error toast with retry option

### Hook Implementation

```typescript
import { useWikiExport, formatOkfBundle, type OkfFile } from '@equationalapplications/expo-llm-wiki'

export function useExportCharacterOKF(characterId: string) {
  const { execute } = useWikiExport()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const exportOkf = useCallback(async () => {
    setIsExporting(true)
    setError(null)
    try {
      const dump = await execute([characterId])
      const { files } = formatOkfBundle(dump)
      const augmented = augmentWithEdgeLinks(files, dump.entities[characterId]?.edges ?? [])
      const withReadme = [...augmented, { path: 'README.md', content: OKF_README_CONTENT }]
      await zipAndSave(withReadme, characterId)
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `okf-export:${characterId}`)
    } finally {
      setIsExporting(false)
    }
  }, [execute, characterId])

  return { exportOkf, isExporting, error }
}
```

Note this hook does not depend on `useMemoryBundle` or its loading state — `useWikiExport().execute()` performs its own fetch, so there's no separate "wait for bundle to load" gate. The button can be enabled unconditionally; `isExporting` covers the in-flight state.

## Error Handling

### Bundle Empty

- `formatOkfBundle` on an empty entity still produces valid structure (empty facts/tasks dirs skipped naturally since no files are pushed, log.md may be empty)
- Toast: "Empty bundle exported. Add memories to enrich future exports."

### Dangling Edges

- `edge.target_id` doesn't match any fact/task id in the current bundle (soft-deleted target)
- Skip the link in "Related" section; log warning
- Bundle remains valid — no broken links written

### `exportDump` / `useWikiExport` Fails

- Surface via hook's `error` state
- Toast with retry option
- `reportError` call for observability (mirrors `useMemoryBundle` pattern)

### ZIP Generation Fails

- Catch `jszip` errors
- Toast: "Failed to export. Check available storage."
- Log full error

### Platform Write Fails (Mobile)

- `expo-file-system` write error or `expo-sharing` unavailable/permission denied
- Toast: "Couldn't save export. Retry?"
- Retry re-runs the full `exportOkf()` flow (cheap — local-only reads)

### Offline

- No network dependency anywhere in this flow (`exportDump` is local-SQLite-only); offline has no effect on export. Not a distinct error case.

## Testing Strategy

1. **Unit:** edge-augmentation function (same-type vs cross-type link paths, dangling-edge skip)
2. **Integration:** full flow — `execute()` → `formatOkfBundle()` → augment → zip → platform save (mocked filesystem/share APIs)
3. **Platform:** web (blob download triggers correctly) and mobile (file written, share sheet invoked with correct URI)
4. **Edge cases:** empty character (no facts/tasks/events), dangling edge, `jszip` failure, `expo-sharing` unavailable

## Future Phases (V2+)

- Ontology manifest serialization (Phase 2, once ontology-editing UI ships and manifests are non-trivial)
- Re-import UI wiring `parseOkfBundle` to a "restore from OKF bundle" action
- Cloud storage integration (auto-upload to Drive/S3)
- Multi-character export (bundle several characters in one ZIP — `formatOkfBundle` already supports this structurally)
- Export filtering (select subset of facts/tasks/date range)
- Upstream contribution to `core-llm-wiki`'s `formatOkfBundle` to natively serialize `bundle.edges` (would remove the need for our augmentation pass)

## Dependencies

- `@equationalapplications/expo-llm-wiki` (existing dependency; re-exports `useWikiExport`, `formatOkfBundle`, `parseOkfBundle`, `MemoryDump`, `OkfFile` from `core-llm-wiki`/`react-llm-wiki`) — **no version bump or new install needed**
- `jszip` — **not currently installed; must be added**
- `expo-file-system` — already installed (`~56.0.7`)
- `expo-sharing` — **not currently installed; must be added**
- `@equationalapplications/core-okf` — **not needed as a direct dependency.** All required primitives are reached indirectly through `formatOkfBundle`; edge augmentation is done via plain string concatenation, not `core-okf` calls.

## References

- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs` — `formatOkfBundle`/`parseOkfBundle` implementation (read directly during self-review, 2026-07-03)
- Cloud Ontology & Graph Traversal Design Spec (2026-06-23) — introduced `WikiEdge`, `llmWikiOntology`
- LLM Wiki Memory Spec (2026-04-24) — original facts/tasks/events schema
- `src/machines/wikiMachine.ts:432`, `src/machines/liveVoiceMachine.ts:493` — existing `exportDump` call sites (cloud-sync path, not user-facing export)
- `src/hooks/useMemoryBundle.ts` — retrieval-path hook, explicitly *not* used for export (see Key Design Decisions)
