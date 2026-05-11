# LLM Wiki State Machine + v4 Upgrade Design

**Date:** 2026-05-09
**Status:** Implemented
**Owner:** equationalapplications

## Problem

Clanker's character memory uses `@equationalapplications/expo-llm-wiki@^3.0.0`. Symptoms and gaps:

1. **Facts never appear.** New users see no recall because:
   - Memory writes/reads gated on `hasUnlimited` (premium subscription). Subscription state can flicker during bootstrap, silently dropping writes.
   - `autoLibrarianThreshold: 20` — first 19 observations never consolidate into facts.
   - Observation errors swallowed via `console.warn`; no observability.
2. **Polling for status.** `ChatView` polls `getEntityStatus(entityId)` every 5s, causing up to 5s of UI lag and wasted renders.
3. **No orchestration.** Wiki ops scattered across `wikiService`, `useAIChat`, `ChatComposer`, `ChatView`, `useCharacterWiki`, `characterSyncService`. No single source of truth for in-flight state, no serialization guarantees, no retry path for `WikiBusyError`.
4. **`runHeal` never called.** Stale/contradictory facts accumulate.
5. **Memory budget unbounded** for mobile devices.

Package v4.1.0 introduces `subscribeEntityStatus` (issue #8, released), `runPrune`, `runReembed`, and `WikiBusyError` semantics that enable a clean fix.

## Goals

- Upgrade to `@equationalapplications/expo-llm-wiki@4.1.0`.
- Per-character XState `wikiMachine` actor managing all wiki operations for that entity.
- Replace 5s status polling with `subscribeEntityStatus` (required since Phase 5).
- Drop the `hasUnlimited` gate on memory read/write/ingest. `hasUnlimited` continues to gate paid features (subscribe redirect, cloud sync); only memory operations are ungated.
- Tight mobile-first prune defaults; lower librarian threshold; auto-heal via package threshold.
- Centralized error reporting via `reportError`.
- In-app memory inspector UI per character.

## Non-Goals

- Custom embedding provider changes.
- Server-side memory storage.
- Web-only memory (out of scope for this spec).
- Reactive observable beyond `subscribeEntityStatus` callback.

## Architecture

```
app/_layout.tsx
  └─ WikiProvider (wiki instance @4.1.0)
        └─ wikiOrchestrator service (singleton)
              ├─ Map<entityId, ActorRef<wikiMachine>>
              ├─ getOrSpawn(entityId, wiki, machineOptions?): WikiActor
              ├─ stop(entityId): void
              └─ syncAll(items: SyncAllItem[], wiki, concurrency, timeoutMs, options?): Promise<void>

SyncAllItem: { entityId, runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null> }

wikiMachine (XState v5, one actor per character)
  input: { entityId, wiki, busyRetryDelayMs? }
  context: {
    entityId: string
    wiki: Wiki
    status: EntityStatus         // { ingesting, librarian, heal }
    lastError: Error | null
    lastReadAt: number | null
    lastReadResult: ReadResult | null
    lastIngestResult: IngestResult | null
    pendingEvents: WikiSerializedEvent[]
    currentEvent: WikiSerializedEvent | null
    busyRetryDelayMs: number     // default 1000
  }
  root-level invoked actor: subscribeStatus (fromCallback)
    → uses subscribeEntityStatus(entityId, cb) (required on Wiki)
    → reports error if subscribeEntityStatus is not a function at runtime
  root-level event handlers (queuing path):
    STATUS → assign context.status (always handled)
    READ/WRITE/INGEST/SYNC/FORGET → enqueue to pendingEvents when not idle
  states:
    idle
      entry: flushPending (dequeue + raise next event)
      on READ   → reading   (storeCurrentEvent)
      on WRITE  → writing   (storeCurrentEvent)
      on INGEST → ingesting (storeCurrentEvent)
      on SYNC   → syncing   (storeCurrentEvent)
      on FORGET → forgetting (storeCurrentEvent)
    reading     → invoke readActor   → idle (assign lastReadResult, lastReadAt) | busyRetry | error
    writing     → invoke writeActor  → idle | busyRetry | error
    ingesting   → invoke ingestActor → idle (assign lastIngestResult) | busyRetry | error
    forgetting  → invoke forgetActor → idle | busyRetry | error
    syncing     → invoke syncActor   → idle | busyRetry | error
      syncActor: exportDump → runRemoteSync → importDump (busy-retry loop) → runPrune (busy-retry loop)
    busyRetry
      after BUSY_RETRY_DELAY → idle (re-flushes requeued event)
    error
      entry: reportError(lastError, 'wiki:<entityId>:<op>') for non-WikiBusyError
      on RETRY → idle (clears lastError)
      after 30000 → idle (clears lastError)
  guards:
    isBusyError: event.error instanceof WikiBusyError → target busyRetry + requeueCurrentEvent
  serialization:
    all operations (read/write/ingest/sync/forget) serialized via pendingEvents queue
    WikiBusyError → requeue to front + busyRetry delay → idle → re-flush
```

### SYNC event contract

The `SYNC` event carries a `runRemoteSync` callback instead of a `cloudId` string. The caller (hook or sync service) is responsible for assembling the cloud↔local entity-ID remap inside `runRemoteSync`. This decouples the machine from cloud-specific concerns.

```ts
{ type: 'SYNC', runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null> }
```

### Status subscription

`subscribeEntityStatus` is required on the `Wiki` type since Phase 5 (`expo-llm-wiki@4.1.0` is the minimum version). The machine uses it directly via a `fromCallback` actor. If `subscribeEntityStatus` is not a function at runtime (e.g. a misconfigured test mock), the machine reports via `reportError` and runs without status updates.

> **Historical note:** Before Phase 5, `subscribeEntityStatus` was typed as optional and the machine included a `getEntityStatus` polling fallback at a configurable `statusPollIntervalMs`. That fallback and the associated input/context field were removed in PR #374.

### Hooks

`src/hooks/useCharacterWiki.ts` — canonical hook, replaces direct package-hook usage in `ChatView`, `ChatComposer`, `useAIChat`, `characterSyncService`:

```ts
export function useCharacterWiki(entityId: string) {
  const wiki = useWiki()
  const actor = useMemo(
    () => (wiki ? wikiOrchestrator.getOrSpawn(entityId, wiki) : null),
    [entityId, wiki],
  )
  // subscribe to actor snapshots via useState + actor.subscribe
  return {
    status,       // WikiStatus from context.status
    isBusy,       // !snapshot.matches('idle')
    isIngesting,  // snapshot.matches('ingesting')
    error,        // context.lastError
    read,         // send READ + waitForActorOperation → lastReadResult
    write,        // send WRITE + waitForActorOperation
    ingest,       // send INGEST + waitForActorOperation → lastIngestResult
    forget,       // send FORGET + waitForActorOperation
    sync,         // send SYNC (assembles runRemoteSync with entity-ID remap) + waitForActorOperation
    hasChanged,   // delegates to wiki.hasChanged (no machine involvement)
  }
}
```

`useCharacterWikiSync` was removed in Phase 5. The character edit screen now uses `useCharacterWiki(entityId).sync(cloudEntityId)` for manual sync.

## Data Flow

### Read path (chat send)
```
useAIChat.sendMessage
  → useCharacterWiki(charId).read(query)
    → wikiMachine: idle → reading → idle
    → wiki.read → lastReadResult → formatContext({maxFacts:10,maxTasks:5,maxEvents:10})
  → sendMessageWithAIResponse({ memoryBlock, onWriteObservation })
  → onWriteObservation(text)
    → useCharacterWiki(charId).write(text)  // awaited but fire-and-forget semantically
```

### Status path
`subscribeStatus` (fromCallback) invoked once at machine creation; uses `subscribeEntityStatus` to dispatch `STATUS` events updating `context.status`. `ChatView` reads `useCharacterWiki(charId).status` for the banner. No polling — immediate updates via subscription.

### Sync path (premium, cloud-linked)

Two code paths use sync:

1. **Background sync** (`characterSyncService.syncWikiForCloud`): Triggered by `syncAllToCloud` on startup and network reconnect. Batches all cloud-linked characters into a single `wikiOrchestrator.syncAll` call with concurrency=2. The `runRemoteSync` callback remaps local↔cloud entity IDs and calls the `wikiSync` cloud function.

2. **Manual sync** (`useCharacterWiki.sync()` in character edit screen): Routes through the orchestrator via the hook's `sync(cloudEntityId)` method. (Before Phase 5, a standalone `useCharacterWikiSync` hook bypassed the orchestrator with direct `exportDump`/`importDump` — now removed.)

Cloud sync is gated on `save_to_cloud + cloud_id` UUID at the call site (`characterSyncService`), not in the orchestrator or machine.

### Ingest path
Unchanged user flow (`+` button → `DocumentPicker`). Goes through `useCharacterWiki(charId).ingest(...)`.

## Configuration Changes

`wikiService.setupWiki` config — values chosen for mobile-first retention with faster librarian trigger:

```ts
{
  tablePrefix: 'llm_wiki_',
  autoLibrarianThreshold: 5,        // was 20; reduced so facts appear after fewer messages
  autoHealThreshold: 100,           // was unset (default); triggers auto-heal for contradiction cleanup
  pruneRetainSoftDeletedFor: 3,     // was unset (default 7); tighter mobile storage
  pruneEventsAfter: 14,             // was unset (default 30); tighter mobile storage
  orphanAfterDays: 14,              // was unset (default 30); tighter mobile storage
  staleInferredAfterDays: 30,       // was unset (default 60); recycle old inferences sooner
  preFilterLimit: 300,              // unchanged
  hybridWeight: 0.7,                // unchanged
}
```

`autoLibrarianThreshold: 5` is the most consequential change — it means free-tier users trigger librarian LLM calls after just 5 observations instead of 20. The `wikiLlmProvider` credit accounting must handle the increased volume. See Risks § Free-tier load.

## Invariants

- One operation per entity at a time (READ, WRITE, INGEST, SYNC, FORGET) — serialized via `pendingEvents` queue.
- `WikiBusyError` from package = requeue + busyRetry delay; never user-facing crash.
- Memory writes/reads/ingest never gated on subscription state.
- Cloud sync gated on `save_to_cloud + cloud_id` UUID — enforced at the call site in `characterSyncService.syncWikiForCloud`, not in the orchestrator or machine.
- All errors flow through `reportError(err, 'wiki:<entityId>:<op>')` for non-WikiBusyError.
- Machine actor stopped when character soft-deleted: `characterMachine`'s `deleteCharacterActor` calls `wikiOrchestrator.stop(entityId)` after DB soft-delete. Note: `forget(clearAll)` is not called — wiki entries are cleaned up by prune defaults (`orphanAfterDays: 14`, `pruneRetainSoftDeletedFor: 3`).
- `subscribeEntityStatus` unsubscribed on machine stop.

## Phases & PRs

### Phase 1 — Package upgrade (sequential, blocks rest)
**Status:** Merged.
**1 PR.** Bump to 4.1.0, audit migration, update `wikiService` config to new defaults. Smoke tests pass.

v3→v4 migration: `source_type` enum values renamed (`user_document` → `immutable_document`, `agent_inferred` → `librarian_inferred`). Idempotent SQL migration runs before `wiki.setup()` in `initWiki`. Validated on populated test DB.

### Phase 2 — Independent foundations (parallel)
- **P2a:** `wikiMachine` + `wikiOrchestrator`, no call-site changes. Unit tests with mocked wiki. **Status:** Merged (#369).
- **P2b:** Drop `hasUnlimited` gate on memory in `useAIChat`, `ChatComposer`, `ChatView`. Cloud sync gate unchanged. Tests for free-tier path. **Status:** Merged (#370).
- **P2c:** Replace `console.warn('[wiki]…')` with `reportError`. `WikiBusyError` discrimination. No behavior change. **Status:** Merged (#368).

### Phase 3 — Wire call-sites (sequential, after P2a + P2b)
**Status:** Merged (#372).
**1 PR.** Replace package-hook calls in `ChatView`, `ChatComposer`, `useAIChat`, `characterSyncService.syncWikiForCloud` to go through `useCharacterWiki(entityId)` / `wikiOrchestrator`. Delete 5s polling in `ChatView`. Route `syncWikiForCloud` through `wikiOrchestrator.syncAll`.

### Phase 4 — Enhancements (parallel, after P3)
**Status:** Merged (#373).
- **P4a:** Batch sync concurrency — single `syncAll` call with all cloud-linked characters and concurrency=2. Network-reconnect and startup trigger wiring.
- **P4b:** Memory inspector UI — `/characters/[id]/memory` route listing facts/tasks/events with delete via `wiki.forget`. Includes `useMemoryBundle` hook and "View Memory" button on edit screen.

### Phase 5 — Cleanup (sequential, last)
**Status:** Merged (#374).
**1 PR.**
- Removed `useCharacterWikiSync` standalone hook; edit screen uses `useCharacterWiki.sync()`.
- Wired `wikiOrchestrator.stop(entityId)` into character soft-delete flow (`characterMachine`).
- Made `subscribeEntityStatus` required on `Wiki` type; removed polling fallback.
- Deleted unused `useWikiExport` hook.
- Added `docs/WIKI_ARCHITECTURE.md` with README link.

## Testing

- **Unit:** `wikiMachine.test.ts` covers all transitions, busy serialization, `WikiBusyError` retry, status event flow, status fallback paths. `wikiOrchestrator.test.ts` covers spawn/stop, `syncAll` concurrency, error-before-sync fail-fast, batch cleanup. Existing `useAIChat`, `ChatComposer`, `ChatView` tests updated to use mocked machine.
- **Integration:** Chat send triggers READ + WRITE on machine; ChatView banner reflects STATUS events without polling. Free-tier user gets memory recall after 5 messages.
- **Manual QA (by phase):**
  - **P2b:** Send 5 messages on free tier → librarian fires → 6th send shows fact.
  - **P3:** Ingest doc → banner appears immediately (no 5s delay). Status banner updates without polling.
  - **P4a:** Offline → online → no duplicate facts after sync. Kill app mid-write → restart → no orphan busy state.

## Risks

- **v3 → v4 migration:** Schema changes possible. P1 must verify `wiki.setup()` migrates existing on-device data without loss. Block landing P1 until validated on a populated test DB. **Resolution:** Idempotent SQL migration implemented; validated.
- **Subscription leak:** `subscribeEntityStatus` must unsubscribe on actor stop. Test-cover this. **Resolution:** Covered in wikiMachine tests (actor stop unsubscribes).
- **Free-tier load:** Memory ops now run for all users; LLM calls for librarian still cost credits. Confirm `wikiLlmProvider` accounting handles the increased volume, or scope librarian to premium if cost is prohibitive. **Status: Unresolved — needs validation after P2b lands in production.**
- **Concurrent sync:** `syncWikiForCloud` previously serial; Phase 4a's concurrency=2 may surface race conditions in `wikiSync` cloud function. **Resolution:** Validated and merged in PR #373.

## Open Questions

1. **Free-tier librarian cost:** With `autoLibrarianThreshold: 5` and memory ungated, librarian LLM calls will increase significantly. Has `wikiLlmProvider` credit accounting been validated for the increased volume? If cost is prohibitive, should librarian be scoped to premium? **Status: Unresolved — needs production validation.**
2. ~~**`useCharacterWikiSync` migration timing:**~~ **Resolved in Phase 5 (PR #374).** Hook removed; edit screen uses `useCharacterWiki.sync()`.
3. ~~**Actor stop on character delete:**~~ **Resolved in Phase 5 (PR #374).** `characterMachine`'s `deleteCharacterActor` calls `wikiOrchestrator.stop(entityId)` after DB soft-delete.

---

## Phase 2a Implementation Notes

**Status:** Implemented
**PR:** #369
**Commits:** 33f2013, dbc5c73, f94164c, 8fcd394, 3615cd2, 3e0197d, 322f307

### Implementation Summary

Phase 2a delivers `wikiMachine` and `wikiOrchestrator` as pure additive code with no existing call-site changes. All tests passing.

### wikiMachine Implementation

**File:** `src/machines/wikiMachine.ts`

**Context:**
- `entityId: string` - Entity identifier
- `wiki: Wiki` - Wiki instance
- `status: EntityStatus` - Current entity status (ingesting, librarian, heal)
- `lastError: Error | null` - Last error encountered (cleared on recovery/success)
- `lastReadAt: number | null` - Timestamp of last successful read
- `lastReadResult` - Result of last successful read (for caller retrieval)
- `lastIngestResult` - Result of last successful ingest (chunk count)
- `pendingEvents: WikiSerializedEvent[]` - Queue for serializing operations (READ, WRITE, INGEST, SYNC, FORGET)
- `currentEvent: WikiSerializedEvent | null` - Currently processing event (for re-enqueue on busy)
- `busyRetryDelayMs: number` - Delay before retrying after WikiBusyError (default 1000)

**States:**
- `idle` - Ready to accept operations; flushes pending events on entry
- `reading` - Executing READ operation
- `writing` - Executing WRITE operation
- `ingesting` - Executing INGEST operation
- `syncing` - Executing SYNC operation (export → runRemoteSync → import → prune)
- `forgetting` - Executing FORGET operation
- `busyRetry` - Waiting `busyRetryDelayMs` before transitioning to idle (re-flushes requeued event)
- `error` - Error state with auto-recovery (RETRY event or after 30s)

**Events:**
- `READ { query }` - Query wiki for entity
- `WRITE { summary }` - Write observation to wiki
- `INGEST { doc }` - Ingest document into wiki
- `SYNC { runRemoteSync }` - Sync entity with remote via caller-provided callback
- `FORGET { args }` - Remove document from wiki
- `STATUS { status }` - Update entity status (from subscription)
- `RETRY` - Manually retry from error state

**Key Behaviors:**
- **Serialization:** All operations (READ, WRITE, INGEST, SYNC, FORGET) are queued via `pendingEvents` and flushed on `idle` entry to ensure consistent ordering
- **WikiBusyError handling:** Re-enqueues operation via `requeueCurrentEvent` action, transitions to `busyRetry` for automatic retry after delay
- **Error recovery:** `lastError` cleared on successful operations and recovery transitions
- **Status subscription:** Uses `subscribeEntityStatus` (required on `Wiki`); reports via `reportError` if not a function at runtime
- **Cleanup:** Unsubscribes from status on actor stop

### wikiOrchestrator Implementation

**File:** `src/services/wikiOrchestrator.ts`

**API:**
- `getOrSpawn(entityId, wiki, machineOptions?): WikiActor` - Get or create actor for entity (cached); optional `busyRetryDelayMs` applies only on first spawn
- `stop(entityId): void` - Stop and remove actor from cache
- `syncAll(items, wiki, concurrency=2, timeoutMs=60000, options?): Promise<void>` - Sync multiple entities with bounded parallelism; `options.stopActorsSpawnedForBatch` stops actors that did not exist before the batch; `options.machineOptions` forwarded on spawn

**SyncAllItem Interface:**
```typescript
{
  entityId: string
  runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
}
```

**Key Behaviors:**
- Actors cached by `entityId` in a Map
- `syncAll` uses work-queue pattern to limit concurrent syncs
- Sends `RETRY` before `SYNC` for actors in error state, then `waitFor` `idle` so queued work is drained before the SYNC waiter runs
- Waits for each actor to complete a `syncing` snapshot for this cycle (`idle` or `error`) before resolving
- If a new `SYNC` was sent and the actor hits `error` before ever entering `syncing` (e.g. in-flight or queued non-sync work fails first), rejects immediately instead of waiting for the full timeout
- Optional batch cleanup: `stopActorsSpawnedForBatch` removes only actors absent from the map at `syncAll` entry (safe with duplicate `entityId`s in the batch); runs in `finally` so batch-only actors are still stopped when `syncAll` rejects

### Type Extensions

**File:** `src/services/wikiService.ts`

Extended `Wiki` type with `subscribeEntityStatus` (required since Phase 5):
```typescript
export type Wiki = BaseWiki & {
  subscribeEntityStatus: (
    entityId: string,
    callback: (status: EntityStatus) => void,
  ) => () => void
}
```

### Implementation Deviations from Design

1. **IngestArgs/ForgetArgs:** Not exported by `@equationalapplications/expo-llm-wiki@4.1.0`. Derived locally as `Parameters<Wiki['ingestDocument']>[1]` and `Parameters<Wiki['forget']>[1]`.

2. **WikiBusyError constructor:** Signature is `(operation: WikiBusyOperation, entityId: string)`, not `(message: string)`.

3. **Wiki.write API:** Two-argument signature `write(entityId, event)`, not single-object `write({ entity_id, ...event })`.

4. **Event queuing:** XState v5 doesn't buffer unhandled events automatically. Implemented manual `pendingEvents` queue with `enqueueActions(flushPending)` on idle entry.

5. **cloudId parameter:** Removed from SYNC event. SYNC carries `runRemoteSync` callback instead; caller handles cloud↔local entity-ID remap.

6. **subscribeEntityStatus:** Shipped in `@equationalapplications/expo-llm-wiki@4.1.0`. Phase 5 made it required on the `Wiki` type and removed the `getEntityStatus` polling fallback. The machine still includes a defensive runtime `typeof` check and reports via `reportError` if `subscribeEntityStatus` is not a function.

7. **busyRetry state:** Spec originally showed WikiBusyError going to idle with "defer + retry next tick". Implementation adds an explicit `busyRetry` state with a configurable delay (`busyRetryDelayMs`, default 1000ms) before transitioning to idle to re-flush the requeued event.

### Test Coverage

**wikiMachine.test.ts:**
- READ → reading → idle and calls wiki.read
- WRITE → writing → idle and calls wiki.write
- INGEST → ingesting → idle and calls wiki.ingestDocument
- FORGET → forgetting → idle and calls wiki.forget
- SYNC runs export → runRemoteSync → import → prune in order
- SYNC WikiBusyError on import retries import without re-running export/remote
- SYNC WikiBusyError on prune retries prune without re-calling importDump
- Mutation while in flight is queued (serialized)
- WikiBusyError → re-enqueues and retries automatically
- Non-busy error → error state with assigned lastError
- STATUS event updates context.status
- Actor stop unsubscribes from status
- `subscribeEntityStatus` missing at runtime calls `reportError` with `wiki:<id>:statusSubscription`
- `subscribeEntityStatus` non-function at runtime calls `reportError`

**wikiOrchestrator.test.ts:**
- getOrSpawn returns same actor for repeat entityId
- getOrSpawn returns distinct actors for distinct entityIds
- stop removes the actor and unsubscribes status
- `syncAll` skips holes in a sparse `items` array without stopping workers early
- `syncAll` runs at most `concurrency` syncs in flight
- `syncAll` resolves when a second item shares an actor already syncing
- `stopActorsSpawnedForBatch` still stops batch-only actors when `syncAll` rejects (e.g. timeout)
- `stopActorsSpawnedForBatch` stops actors created for the batch only
- `syncAll` rejects when `RETRY` cannot drain queued work before `SYNC`
- `syncAll` rejects fast when the actor errors before `SYNC` runs (queued `SYNC`)
- `syncAll` runs `SYNC` after `RETRY` drains queued writes
- `stopActorsSpawnedForBatch` does not stop actors that existed before `syncAll`
- `syncAll` rejects when the sync invoke fails (e.g. `exportDump` rejects)

State-transition assertions use `waitFor` from XState for deterministic behavior; the orchestrator concurrency coverage may still use a short `setTimeout` helper where appropriate.
