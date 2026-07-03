# Spec: OKF Export — Character Memory as Portable Bundle

**Date:** 2026-07-03 (revised after self-review + public docs addendum)  
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
import { useWiki } from '@equationalapplications/expo-llm-wiki'

const wiki = useWiki()
const dump: MemoryDump = await wiki.exportDump([characterId])   // -> { generatedAt, entities: { [characterId]: MemoryBundle } }
const { files } = formatOkfBundle(dump)                          // -> OkfFile[] = { path, content }[]
```

`formatOkfBundle` already handles: frontmatter serialization, concept-document assembly, per-entity fact/task directories, and the event log — using `core-okf` primitives internally. **We do not need a direct dependency on `core-okf`, and we do not hand-roll frontmatter or concept-document assembly.** Our job shrinks to: fetch dump → format → **augment with edge links (gap, see below)** → zip → platform-save.

### Verified file layout produced by `formatOkfBundle`

Read directly from `core-llm-wiki/dist/index.mjs` — not inferred from docs:

```
index.md                              # root catalog (buildRootIndexMd), lists entities
entities/{sanitized-entityId}/index.md
entities/{sanitized-entityId}/log.md  # events, via buildLogMd; each entry links to its
                                       # related fact if event.related_entry_id is set
entities/{sanitized-entityId}/facts/{sanitized-factId}.md
entities/{sanitized-entityId}/tasks/{sanitized-taskId}.md
```

For a single-character export (`exportDump([characterId])`), `dump.entities` has exactly one key, so the bundle is effectively `entities/{characterId}/...` plus the root `index.md`. This nested-by-entity shape (**not** a flat `facts/`/`tasks/`/`timeline.log.md` at bundle root) is what ships — it's also what `parseOkfBundle` expects on the way back in, so we don't flatten it ourselves.

### Gap: `formatOkfBundle` does not serialize graph edges

`MemoryBundle.edges` (`WikiEdge[]`, populated by `exportDump`/`getFullBundle` from the edges table added for "OKF graph import") is **not read by `formatOkfBundle` at all** — verified by reading the function body. Concept-document bodies are written verbatim from `fact.body` (facts) or as an empty string (tasks — `taskFrontmatter` supplies frontmatter only, no body); no `## Related` section is appended from `bundle.edges` anywhere in the adapter.

This matters: edges are a real, already-shipped part of the Cloud Ontology & Graph Traversal work (Phase 1). Exporting a flat list of disconnected text files — dropping every explicit graph relationship — would gut the "graph-aware" value of this feature and lose data on any future round-trip (export → external tool → re-import). `parseOkfBundle`, on the *import* side, does reconstruct edges, but only by scanning concept-document bodies for markdown links via `extractMarkdownLinks`. So: for edges to survive a round trip, **we inject them into the body ourselves before zipping**, in a shape `extractMarkdownLinks`/`parseOkfBundle` can already read back.

**Decision: keep edges in V1.** Add a thin post-processing pass after `formatOkfBundle`, before zipping. This is a small, targeted addition on top of the existing adapter, not a reimplementation of it, and it's what makes this an actual knowledge-graph export rather than a flat file dump.

## Goals

- Client-side generation (local-first, offline-safe, zero server load) — via `wiki.exportDump()` + `formatOkfBundle`
- Round-trip-safe graph edges (append markdown links `parseOkfBundle` can already parse back)
- Support both web and mobile platforms (browser download + expo-file-system/expo-sharing)
- V1 scope: facts + tasks + episodic log + edges. Defer ontology manifest serialization to Phase 2.
- Communicate the feature publicly: landing page, FAQ, dedicated explainer page, privacy policy

## Non-Goals (V1)

- Ontology manifest serialization (Phase 2, when ontology-editing UI ships — `mode` defaults to `'off'` for all characters today, so there's nothing meaningful to export yet)
- Cloud function endpoint (keep client-side; `wiki.exportDump()`/`formatOkfBundle` are pure client-side calls already)
- Scheduled/batched export (manual UI trigger only)
- Re-import UI wiring `parseOkfBundle` into the app (it already exists in the package, but building a "restore from OKF bundle" UI is a separate feature/spec)
- Multi-entity export (bundling several characters into one ZIP) — `formatOkfBundle` supports it structurally, but V1 UI only exposes a single-character export button
- Any change to `@equationalapplications/core-llm-wiki` itself (the edge gap is worked around at the call site, not patched upstream, to avoid a dependency-version bump mid-feature)
- Localized/translated public-docs copy; blog post or changelog entry; changes to `terms.tsx` (export doesn't alter terms of service)

## Architecture

### Data Flow

1. User taps "Export Memory as OKF" in character settings
2. `useExportCharacterOKF(characterId)` calls `wiki.exportDump([characterId])` → `MemoryDump`
3. `formatOkfBundle(dump)` → `{ files: OkfFile[] }` (facts, tasks, per-entity log, per-entity index, root index)
4. **Edge augmentation pass** (see below): append a `## Related` section to each fact/task file from that entity's `bundle.edges`
5. Add `README.md` at bundle root (static content, explains OKF + how to inspect/re-import)
6. Zip all files (`file.path` as-is becomes the zip entry path) via `jszip`
7. Platform-specific save:
   - **Web:** Standard HTML5 blob download (`<a href=blob>`)
   - **Mobile:** Write ZIP to device via `expo-file-system`, trigger share sheet via `expo-sharing`

### Edge Augmentation

Edges live per-entity: `dump.entities[characterId]?.edges ?? []` (an array of `WikiEdge = { id, entity_id, source_id, target_id, edge_type, created_at }`). `dump` itself has no top-level `edges` field — only `dump.entities[id].edges`.

`formatOkfBundle`'s internal sanitization (`sanitizeConceptId`) means a file's path segment is *not guaranteed* to equal the original fact/task `id` verbatim. But `factFrontmatter`/`taskFrontmatter` both write `id: f.id` (the raw, unsanitized id) into the YAML frontmatter of every concept file. So instead of trying to reverse-engineer the sanitized filename, extract the real id from each file's own frontmatter:

1. After calling `formatOkfBundle(dump)`, do one pass over `files` where `isConceptFile` (i.e. not `index.md`, not `log.md`): parse the `id:` line out of the frontmatter block (a plain regex against the `---\n...\n---` header is sufficient — ids are plain alphanumeric/underscore tokens, no YAML escaping needed) and build two maps: `idToPath: Map<id, path>` and `pathToId: Map<path, id>`
2. For each concept file, look up its own id via `pathToId`, then find edges where `edge.source_id === thatId`
3. For each match, resolve the target's file path via `idToPath.get(edge.target_id)`. If missing (dangling edge — target soft-deleted or otherwise absent from this bundle), skip it and log a warning
4. Compute the relative link from current file's directory to the target's directory:
   - Both under the same `facts/` or `tasks/` subfolder → `./{targetFilename}`
   - Cross-type (fact ↔ task) → `../facts/{targetFilename}` or `../tasks/{targetFilename}`
5. Append to `file.content`:
   ```markdown

   ## Related

   - [edge_type](./target_id.md)
   ```
   Plain string concatenation — `formatOkfBundle`'s concept documents are just frontmatter + body text, so no re-parsing via `core-okf` primitives is needed to append a trailing section.

No direct `core-okf` dependency required for this step — it's string building and regex extraction against a known, already-verified output format.

### Key Design Decisions

#### Client-Side Generation

**Why:** Clanker is local-first. `wiki.exportDump()` reads directly from local SQLite. Zero server load, offline-safe, no stale-sync risk (vs. reading from a cloud mirror that may lag behind local writes).

#### Use `formatOkfBundle`, Not Hand-Rolled core-okf Calls

**Why:** Confirmed via package inspection that this adapter is already built, already a transitive dependency, and already produces spec-compliant OKF output (frontmatter, concept docs, index, log). Reimplementing it would duplicate ~150 lines of already-tested logic for no benefit. We only add the ~20-line edge-augmentation pass it's missing.

#### Fetch via `exportDump`, Not the Retrieval-Path `getMemoryBundle`

**Why:** `getMemoryBundle` (used by `useMemoryBundle`, the existing chat-context hook) is a *retrieval* path — it may score, rank, or truncate results for prompt-context purposes. `exportDump`/`getFullBundle({ includeBlobs: true })` is the *completeness* path used by cloud-sync (`wikiMachine.ts`, `liveVoiceMachine.ts`) and is the correct source for "export everything this character knows."

#### Platform-Aware Save

**Why:** Expo/React Native environment differs from web. Mobile needs filesystem write + share sheet; web uses a standard blob anchor download.

## Bundle Structure

ZIP filename: `{character_name}_{YYYY-MM-DD}.okf.zip`

Contents (single-character export, as produced by `formatOkfBundle` + our edge augmentation + README):

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
            ├── {sanitized-taskId}.md      # frontmatter (empty body) + our "## Related" section
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

(Frontmatter fields above reflect the real shape emitted by `factFrontmatter()` in `core-llm-wiki` — not a redesigned schema. The `## Related` section is ours.)

**README.md** (static, written by our code, not by `formatOkfBundle`):
- What OKF is
- How to inspect the bundle locally (unzip, open in any markdown viewer, e.g. Obsidian)
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
import { useWiki, formatOkfBundle, type OkfFile } from '@equationalapplications/expo-llm-wiki'

export function useExportCharacterOKF(characterId: string) {
  const wiki = useWiki()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const exportOkf = useCallback(async () => {
    setIsExporting(true)
    setError(null)
    try {
      const dump = await wiki.exportDump([characterId])
      const { files } = formatOkfBundle(dump)
      const edges = dump.entities[characterId]?.edges ?? []
      const augmented = augmentWithEdgeLinks(files, edges)
      const withReadme = [...augmented, { path: 'README.md', content: OKF_README_CONTENT }]
      await zipAndSave(withReadme, characterId)
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `okf-export:${characterId}`)
    } finally {
      setIsExporting(false)
    }
  }, [wiki, characterId])

  return { exportOkf, isExporting, error }
}
```

`augmentWithEdgeLinks(files, edges)` implements the id-extraction + relative-link logic described in [Edge Augmentation](#edge-augmentation).

## Error Handling

### Bundle Empty

- `formatOkfBundle` on an empty entity still produces valid structure (empty facts/tasks dirs skipped naturally since no files are pushed, log.md may be empty)
- Toast: "Empty bundle exported. Add memories to enrich future exports."

### Dangling Edges

- `edge.target_id` doesn't resolve via `idToPath` (soft-deleted target, or target excluded from this entity's bundle)
- Skip the link in "Related" section; log warning
- Bundle remains valid — no broken links written

### `exportDump` Fails

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

1. **Unit:** edge-augmentation function (id extraction from frontmatter, same-type vs cross-type link paths, dangling-edge skip)
2. **Integration:** full flow — `exportDump()` → `formatOkfBundle()` → augment → zip → platform save (mocked filesystem/share APIs)
3. **Platform:** web (blob download triggers correctly) and mobile (file written, share sheet invoked with correct URI)
4. **Edge cases:** empty character (no facts/tasks/events), dangling edge, `jszip` failure, `expo-sharing` unavailable

## Public Documentation Updates

Four touchpoints, verified against the actual public-site codebase (not assumed):

### 1. Landing page — `src/components/LandingPage/FeaturesSection.tsx`

New entry in the `FEATURES` array (existing pattern — see `learnMoreHref` on the real-time-voice card):

```typescript
{
  icon: 'export-variant' as const,
  title: 'Own Your Data',
  body: 'Export any character\'s complete memory — facts, tasks, and history — as an open, standard format (OKF). No walled garden. Your data works with any OKF-compatible tool.',
  learnMoreHref: '/memory-export-with-okf',
  isNew: true,
}
```

### 2. New standalone static page — `public/memory-export-with-okf/index.html`

Clanker has two kinds of public pages:
- **Auto-generated** (`/privacy`, `/terms`) — built from `src/config/*Config.ts` by `scripts/generate-static-pages.js`, gitignored output
- **Hand-authored** (`/welcome`, `/real-time-voice`) — static HTML committed directly to `public/{route}/index.html`

This is the second kind. Route: **`/memory-export-with-okf`**. Content:
- What OKF is (plain-language, links to the open spec)
- How to trigger export (Character Settings → "Export Memory as OKF")
- What's in the `.zip` (facts/tasks/log/README, `entities/{id}/...` layout)
- What to do with it: open in Obsidian or any markdown viewer, back it up, use with future OKF-compatible tools
- Notes ontology/graph-taxonomy rules aren't included yet (matches V1 scope — edges *are* included, ontology manifest is not)

Wiring required:
- Add `{ loc: '/memory-export-with-okf', priority: '0.6' }` to the `pages` array in `scripts/generate-static-pages.js` (~line 311) so it's included in the generated `sitemap.xml`
- Add a nav link alongside the existing `/welcome`/`/real-time-voice` footer links (~line 210-212 in the same script)

### 3. FAQ additions — `app/support.tsx`

New compact Q&A pair in the existing FAQ `Card`, linking out to the dedicated page for full detail:

```
Q: Can I export my character's memory?
A: Yes — open Character Settings and tap "Export Memory as OKF" to download
   a complete, standard-format backup of everything your character knows,
   including its facts, tasks, and how they connect. See our data export
   guide for details on what's included and how to use it.
```
"data export guide" links to `/memory-export-with-okf`.

### 4. Privacy policy — `src/config/privacyConfig.ts`

New short section near the existing "Data Deletion" section (~line 111 in `PRIVACY.privacy`):

```
Data Portability
You can export your character's complete memory (facts, tasks, and interaction
history, including how they relate to each other) at any time from Character
Settings, in the Open Knowledge Format (OKF), an open standard. This
self-serve export contains everything associated with that character's
memory.
```

Bump `PRIVACY.version` (1.5 → 1.6) and `lastUpdated`. This alone regenerates `public/privacy/index.html` via the existing build script — no separate edit needed there.

## Future Phases (V2+)

- Ontology manifest serialization (Phase 2, once ontology-editing UI ships and manifests are non-trivial)
- Re-import UI wiring `parseOkfBundle` to a "restore from OKF bundle" action
- Cloud storage integration (auto-upload to Drive/S3)
- Multi-character export (bundle several characters in one ZIP — `formatOkfBundle` already supports this structurally)
- Export filtering (select subset of facts/tasks/date range)
- Upstream contribution to `core-llm-wiki`'s `formatOkfBundle` to natively serialize `bundle.edges` (would remove the need for our augmentation pass)
- Localized copy for the public-facing explainer page

## Dependencies

- `@equationalapplications/expo-llm-wiki` (existing dependency; re-exports `formatOkfBundle`, `parseOkfBundle`, `MemoryDump`, `OkfFile` from `core-llm-wiki`; `useWiki()` exposes `exportDump` directly) — **no version bump or new install needed**
- `jszip` — **not currently installed; must be added**
- `expo-file-system` — already installed (`~56.0.7`)
- `expo-sharing` — **not currently installed; must be added**
- `@equationalapplications/core-okf` — **not needed as a direct dependency.** All required primitives are reached indirectly through `formatOkfBundle`; edge augmentation is done via plain string concatenation and frontmatter-id regex extraction, not `core-okf` calls.

## References

- `node_modules/@equationalapplications/core-llm-wiki/dist/index.mjs` — `formatOkfBundle`/`parseOkfBundle` implementation (read directly during self-review, 2026-07-03)
- Cloud Ontology & Graph Traversal Design Spec (2026-06-23) — introduced `WikiEdge`, `llmWikiOntology`
- LLM Wiki Memory Spec (2026-04-24) — original facts/tasks/events schema
- `src/machines/wikiMachine.ts:432`, `src/machines/liveVoiceMachine.ts:493` — existing `exportDump` call sites (cloud-sync path, not user-facing export)
- `src/hooks/useMemoryBundle.ts` — retrieval-path hook, explicitly *not* used for export (see Key Design Decisions)
- `src/components/LandingPage/FeaturesSection.tsx`, `app/support.tsx`, `src/config/privacyConfig.ts`, `scripts/generate-static-pages.js`, `public/real-time-voice/index.html` — public-docs touchpoints (verified 2026-07-03)
