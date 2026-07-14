# Ontology Backfill Adoption — Design

**Date:** 2026-07-14
**Status:** Approved
**Depends on:** expo-llm-wiki 4.21.0 (`runOntologyBackfill`, spec `2026-07-13-ontology-backfill-spec.md` in the expo-llm-wiki repo)

## Problem

Two classes of wiki facts never join the knowledge graph:

1. **Cloud-agent writes.** The cloud-agent `wiki_write` tool inserts finished facts server-side with no `okf_type` and no edges. They reach the device via `wikiSync` → `importDump`, which is a raw upsert — the librarian never sees them.
2. **Pre-ontology facts.** Facts created before the ontology feature shipped have `okf_type = NULL`.

Graph traversal (`wiki_traverse_graph`, ontology-filtered reads) excludes exactly these facts, and the gap grows with every cloud-agent escalation.

expo-llm-wiki 4.21.0 ships `runOntologyBackfill(entityId, options?)`: one batch of up to 25 untyped facts per call, classified in a single LLM call, strictly additive (only fills `okf_type IS NULL`), with a 7-day `ontology_checked_at` cooldown for facts the LLM cannot classify. This spec covers Clanker's adoption of it.

## Decisions

### 1. Dependency bump

`package.json`:

- `@equationalapplications/core-llm-wiki`: `^4.20.0` → `^4.21.0`
- `@equationalapplications/expo-llm-wiki`: `^4.20.0` → `^4.21.0`

`npm install` refreshes `package-lock.json`. 4.21.0 is additive — no API breaks, no migration action required by the host (the `ontology_checked_at` column migration runs inside the library on init).

### 2. Trigger placement: `syncWikiForCloud` after successful `syncAll`

The trigger lives in `src/services/characterSyncService.ts`, in `syncWikiForCloud`, after `wikiOrchestrator.syncAll` returns successfully. Rationale:

- **One insertion point covers both sync paths.** `syncAllToCloud` (periodic/background sync) and `restoreFromCloud` (new-device restore) both call `syncWikiForCloud`.
- **Right side of the merge.** It runs after `importDump` has merged remote facts, so cloud-agent facts pulled in this sync cycle get typed in the same cycle.
- **Right failure coupling.** Backfill is a best-effort extra, never part of sync correctness. Placing it after the sync `try/catch` means a backfill failure cannot fail or misreport the sync. (The rejected alternative — inside the `wikiMachine` `syncActor` next to `runPrune` — would land backfill errors in the machine's `error` state and make the orchestrator misreport the sync as failed.)

The existing `catch (pipelineErr)` block gains an explicit `return` after its current handling. This is behavior-identical today (nothing follows the `try/catch`) and guarantees backfill is skipped when the sync pipeline failed or was busy — no point classifying facts against an unmerged state.

Success path, after the `try/catch`:

```ts
// Best-effort: type facts that bypassed the librarian (cloud-agent writes,
// pre-ontology facts). One batch per sync; backlog converges across syncs.
for (const char of cloudChars) {
    try {
        await wiki.runOntologyBackfill(char.id)
    } catch (err) {
        if (err instanceof WikiBusyError) continue
        reportWikiOpForCharacter(err, `wiki:${char.id}:ontology:backfill`, char.id, 'Ontology backfill failed')
    }
}
```

### 3. Cadence: single pass per sync

One `runOntologyBackfill` call per cloud character per sync — at most 25 facts and **one** credit-costing `wikiLlm` call per character. Large pre-ontology backlogs converge over successive syncs instead of producing a credit burst on the first sync after upgrade. No `while (remaining > 0)` loop.

Sequential loop (no concurrency): each iteration is one LLM round-trip and the wiki serializes internally anyway.

Result counters (`scanned`, `typed`, `failedValidation`, `edgesAdded`, `remaining`, `deferred`) are ignored in v1.

### 4. Error handling

- **`WikiBusyError`** → silent `continue`. Expected contention with the librarian, prune, or another maintenance op; the next sync retries naturally via the cooldown-aware oldest-first queue.
- **Any other error** → `reportWikiOpForCharacter(err, 'wiki:<id>:ontology:backfill', char.id, 'Ontology backfill failed')`, then `continue` to the next character. Matches the existing `ontology:read` / `ontology:write` tag family for Crashlytics searchability.
- The loop never throws out of `syncWikiForCloud`.

## Testing

All in the existing `__tests__/characterSyncWiki.test.ts` harness (mocked wiki + orchestrator):

1. Backfill called once per cloud character after successful `syncAll`.
2. `WikiBusyError` from backfill is swallowed: no `reportError`, remaining characters still backfilled.
3. Non-busy backfill error: reported with tag `wiki:<id>:ontology:backfill`, remaining characters still processed, `syncWikiForCloud` resolves.
4. Backfill not called when `syncAll` throws (pipeline error or `WikiBusyError`).
5. Backfill not called when wiki is unavailable or there are zero cloud characters (existing early returns).
6. `restoreFromCloud` path triggers backfill (integration-style case through `syncWikiForCloud`).

Plus: full client suite, typecheck, lint stay green after the dep bump.

## Out of Scope (v1)

- Convergence loops (`while remaining > 0`) or any multi-batch drain per sync.
- Surfacing backfill result counters in UI or analytics.
- Edge-backfill for already-typed facts (deferred in the library spec too).
- Any cloud-agent/server-side change — the server keeps writing untyped facts; the device types them post-sync.

## Rollout

1. Land this change on a branch off `staging` (`feat/ontology-backfill-adoption`), PR to `staging`.
2. After merge: verify in dev that a character with cloud-agent-written facts gets them typed after one manual sync, and that graph traversal then returns them.
