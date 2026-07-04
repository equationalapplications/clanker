# OKF Import & Export

Clanker can export a character's complete memory graph (facts, tasks, episodic
events, and graph edges) to an OKF (Open Knowledge Format) zip bundle, and
import that bundle back in — either restoring it into the same character or
cloning it into a brand-new one.

See `docs/superpowers/specs/2026-07-03-okf-export-design.md` and
`docs/superpowers/specs/2026-07-04-okf-import-support-design.md` for the full
design history and verification notes. This page is the quick-reference.

## Bundle Layout

```text
index.md
README.md
entities/
  {characterId}/
    index.md
    log.md
    facts/{factId}.md
    tasks/{taskId}.md
```

## Restore vs. Clone

| Mode | Target | Behavior |
|------|--------|----------|
| Merge (default) | existing character | Upserts facts/tasks whose imported `updated_at` is newer than the local row. Events/edges are inserted if new (by id/tuple), never updated. |
| Replace | existing character | Soft-deletes existing facts/tasks, hard-deletes edges, before importing. **Events are never cleared in either mode** — there is no bulk-delete for events in the underlying package. |
| Clone | brand-new character | Regenerates fact/task ids before import (see ID Remapping) so the new character's rows can't collide with the source character's still-existing rows. |

## Known Gaps in the Underlying Package

- **Replace doesn't clear events.** `ImportExportService.doImportEntity` has no
  bulk-delete for events in either merge or replace mode. UI copy for
  "Replace Memory" must say "facts, tasks, and relationships" — never
  "everything."
- **Events duplicate on every restore without dedup.** `parseOkfBundle`
  regenerates every event's `id` on each parse, and the events table has no
  uniqueness constraint beyond `id` (unlike edges, which have
  `UNIQUE(entity_id, source_id, target_id, edge_type)`). `okfImportDedupe.ts`
  works around this by filtering events whose `(event_type, summary, UTC-day
  of created_at)` tuple already exists on the target entity before import.
- **Cross-entity id collision is silently skipped, not merged or overwritten.**
  `doImportEntity` looks up each fact/task id across the *entire* local
  database, not scoped to the importing entity. If a row with that id exists
  under a different, still-live entity, the import skips it — no exception,
  no count of what was skipped. This is why cloning requires
  `okfImportRemap.ts`: without it, cloning a character while its source is
  still on-device would silently produce a near-empty clone.

## ID Remapping for Cloning (`src/utilities/okfImportRemap.ts`)

`remapOkfDumpIds(dump, newCharacterId)` regenerates every fact/task id via
`randomUUID()`, rewrites edge `source_id`/`target_id` through the resulting
map (dropping any edge whose endpoint isn't in the map), and rewrites event
`related_entry_id` the same way. Event ids themselves are never touched —
`parseOkfBundle` already regenerates them on every parse, so there's no old
event id to collide with in the first place.

## Untrusted Input Caps (`src/utilities/okfImport.ts`)

Before any content reaches `parseOkfBundle`: raw zip file size capped at
`MAX_OKF_ZIP_RAW_BYTES` (50MB), entry count capped at `MAX_OKF_ZIP_ENTRIES`
(5,000), and total decompressed content capped at
`MAX_OKF_TOTAL_UNCOMPRESSED_BYTES` (100MB) — checked against a running total
of actual decompressed length, not just the zip's (attacker-controlled)
declared size metadata. Paths are filtered to an exact allow-list
(`index.md`, `entities/{id}/index.md`, `entities/{id}/log.md`,
`entities/{id}/facts/*.md`, `entities/{id}/tasks/*.md`) — this excludes the
export bundle's own `README.md`, which would otherwise parse as a junk fact
with `id: "README"` (`resolveRoute`'s fallback in `core-llm-wiki` treats any
unrecognized concept-file path as a fact). Bundles containing more than one
`entities/{id}/` directory are rejected — V1 only supports single-character
bundles.
