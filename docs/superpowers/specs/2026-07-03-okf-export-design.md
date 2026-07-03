# Spec: OKF Export — Character Memory as Portable Bundle

**Date:** 2026-07-03  
**Status:** Design Complete  
**Branch:** feat  
**Related:** [@equationalapplications/core-okf](https://www.npmjs.com/package/@equationalapplications/core-okf), Cloud Ontology & Graph Traversal Design Spec

## Problem

Users have rich, graph-connected memory stored locally in Clanker (`wiki_entries`, `agent_tasks`, `memory_events`). No way to:

- Export for backup/portability
- Share with external knowledge systems (OKF-aware tools)
- Integrate memory into other platforms
- Inspect/audit memory structure offline

## Goals

- Enable users to export full character memory as OKF bundle (ZIP containing markdown facts, tasks, timeline log)
- Client-side generation (local-first, offline-safe, zero server load)
- Leverage existing `MemoryBundle` cache to avoid re-fetching
- Graph-aware: serialize `llmWikiEdges` as markdown links in concept docs
- Support both web and mobile platforms (browser download + expo-file-system)
- V1 scope: facts + tasks + episodic timeline. Defer ontology serialization to Phase 2.

## Non-Goals (V1)

- Ontology manifest serialization (Phase 2 when UI ships)
- Cloud function endpoint (keep client-side)
- Scheduled/batched export (manual UI trigger only)
- Re-import logic (read OKF bundles back in) — separate feature
- Compression formats beyond ZIP

## Architecture

### Data Flow

1. User taps "Export Memory as OKF" in character settings
2. Hook `useExportCharacterOKF(characterId)` fetches cached `MemoryBundle` (including `edges?: WikiEdge[]`)
3. Map wiki_entries → OKF fact documents
4. Map agent_tasks → OKF task documents
5. Compile memory_events + task state changes → chronological log
6. Generate root index via `buildRootIndexMd`
7. Package into ZIP via `jszip`
8. Platform-specific save:
   - **Web:** Standard HTML5 blob download (`<a href=blob>`)
   - **Mobile:** Write to device filesystem (`expo-file-system`), trigger share sheet (`expo-sharing`)

### Key Design Decisions

#### Client-Side Generation

**Why:** Clanker is local-first; `@equationalapplications/core-okf` is zero-dependency, edge-optimized. OKF bundles are plain text (~few MB for 10k facts/tasks). Zero server load, guaranteed offline support, avoids stale-sync data.

#### MemoryBundle as Source of Truth

**Why:** Bundle already includes `edges?: WikiEdge[]`. No separate database query needed. Avoids race conditions with ongoing `wikiSync`.

#### Platform-Aware Download

**Why:** Expo/React Native environment differs from web. Mobile needs filesystem + share sheet; web uses standard blob download.

## Data Mapping

### wiki_entries → OKF Fact Documents

Each `wiki_entry` becomes a concept document at `facts/{entry.id}.md`:

```markdown
---
type: fact
id: entry_abc123
title: "Fact Title"
created_at: 2026-07-03T10:00:00Z
updated_at: 2026-07-03T14:30:00Z
confidence: certain
source_type: user_stated
---

# Fact Title

Entry body text (markdown preserved).

## Related

- [knows](./entry_xyz789.md)
- [prerequisite_for](../tasks/task_ghi789.md)
```

**Frontmatter:** Serialized via `@equationalapplications/core-okf`'s `serializeFrontmatter()` with fields: `type`, `id`, `title`, `created_at`, `updated_at`, `confidence`, `source_type`.

**Body:** Raw markdown from `entry.body`.

**Related Section:** Links appended from `bundle.edges` where `sourceId === entry.id`.
- **Same-type link** (fact → fact): `[edge_type](./target_id.md)`
- **Cross-type link** (fact → task): `[edge_type](../tasks/target_id.md)`

Built via `buildConceptDocument()` from core-okf.

### agent_tasks → OKF Task Documents

Each `agent_task` becomes a concept document at `tasks/{task.id}.md`:

```markdown
---
type: task
id: task_ghi789
title: "Task Description"
status: pending
priority: 0
created_at: 2026-07-03T11:00:00Z
updated_at: 2026-07-03T11:30:00Z
due_context: "next conversation"
---

# Task Description

Task description (markdown).

## Related

- [related_to](../facts/fact_abc123.md)
```

Frontmatter includes `status`, `priority`, `due_context` fields in addition to standard OKF fields.

### memory_events → Chronological Log

All `memory_events` and task state transitions compile into `timeline.log.md` via `buildLogMd()`:

```markdown
# Memory Timeline

## 2026-07-03

- observation: User mentioned preference for coffee over tea.
- decision: Added fact about beverage preferences.
- task_created: "Research local coffee shops"
- task_completed: "Review onboarding notes"
```

Entries sorted by `created_at`, grouped by date. Includes event type and summary text.

## Bundle Structure

ZIP filename: `{character_name}_{YYYY-MM-DD}.okf.zip`

Contents:

```
├── index.md                    # Root catalog (via buildRootIndexMd)
├── timeline.log.md             # Chronological events + task changes
├── README.md                   # Usage guide + OKF explanation
├── facts/
│   ├── fact_abc123.md
│   ├── fact_def456.md
│   └── ...
└── tasks/
    ├── task_ghi789.md
    ├── task_jkl012.md
    └── ...
```

**index.md:** Generated via `buildRootIndexMd('0.1', sections)` where sections enumerate:
- Fact count and directory
- Task count and directory
- Event log reference

Example:

```markdown
# {Character Name} Memory Bundle

**Exported:** 2026-07-03  
**Format:** OKF v0.1

## Contents

### Facts (42 entries)

Directory: [facts/](facts/)

### Tasks (8 entries)

Directory: [tasks/](tasks/)

### Timeline

See [timeline.log.md](timeline.log.md) for chronological event log.
```

**README.md:** Brief explanation:
- What is OKF (Open Knowledge Format)
- How to inspect the bundle locally
- How to re-import into Clanker (or other OKF tools)
- License/metadata info

## UI Integration

### Character Settings Screen

Add button in settings near privacy/data management section:

**"Export Memory as OKF"**

Styling: Secondary button (outline style), icon + text.

States:
- **Enabled:** When `useMemoryBundle` has loaded (`!isLoading`)
- **Disabled:** While bundle loading or export in progress
- **Loading:** Spinner modal ("Generating bundle...")
- **Success:** Toast message + auto-download
- **Error:** Error toast with retry option

### Hook Implementation

```typescript
export function useExportCharacterOKF(characterId: string) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const { bundle, isLoading } = useMemoryBundle(characterId)

  const export = useCallback(async () => {
    setIsExporting(true)
    setError(null)
    try {
      // Map bundle to OKF
      // Generate ZIP
      // Platform-specific save
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsExporting(false)
    }
  }, [bundle, characterId])

  return { export, isExporting, error }
}
```

## Error Handling

### Bundle Empty

- Still generate valid OKF structure
- Toast: "Empty bundle exported. Add memories to enrich future exports."

### Dangling Edges

- Entry referenced by edge no longer exists (soft-delete)
- Skip link in "Related" section
- Log warning; bundle remains valid

### Bundle Fetch Fails

- Button disabled; error message displayed
- Retry option available
- Log error for debugging

### ZIP Generation Fails

- Catch `jszip` errors
- Toast: "Failed to export. Check available storage."
- Log full error

### Platform Write Fails (Mobile)

- `expo-file-system` error or permissions denied
- Toast: "Permission denied or storage full. Retry?"
- Retry button triggers save flow again

### Offline (Mobile)

- If write attempted while offline, queue or defer
- Show "Retry" option; user can try again when online

## Testing Strategy

1. **Unit:** Mapping functions (wiki_entry → OKF doc, edges → markdown links)
2. **Integration:** Full export flow (fetch bundle → generate ZIP → save to disk/download)
3. **Platform:** Web (blob download) and mobile (file-system + share sheet)
4. **Edge cases:** Empty bundle, dangling edges, permission errors, offline scenario

## Future Phases (V2+)

- Ontology manifest serialization (when Phase 2 UI ships)
- Re-import logic (OKF ZIP → character memory)
- Cloud storage integration (auto-upload to Drive/S3)
- Scheduled exports
- Export filtering (select subset of facts/tasks)

## Dependencies

- `@equationalapplications/core-okf` (already available)
- `jszip` (add to package.json if not present)
- `expo-file-system` (existing in React Native/Expo)
- `expo-sharing` (existing in React Native/Expo)

## References

- [@equationalapplications/core-okf NPM](https://www.npmjs.com/package/@equationalapplications/core-okf)
- Cloud Ontology & Graph Traversal Design Spec (2026-06-23)
- LLM Wiki Memory Spec (2026-04-24)
- Character sync patterns: `src/services/characterSyncService.ts`
- Memory bundle usage: `src/hooks/useMemoryBundle.ts`
