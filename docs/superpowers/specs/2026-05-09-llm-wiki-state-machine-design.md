# LLM Wiki State Machine + v4 Upgrade Design

**Date:** 2026-05-09
**Status:** Phase 3 in PR review (#372). Phases 1, 2a, 2b, 2c merged to staging.
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
- Replace 5s status polling with `subscribeEntityStatus` where available; fall back to `getEntityStatus` polling for tests and partial-upgrade environments.
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
  input: { entityId, wiki, busyRetryDelayMs?, statusPollIntervalMs? }
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
    statusPollIntervalMs: number // default 5000; 0 = initial only
  }
  root-level invoked actor: subscribeStatus (fromCallback)
    → uses subscribeEntityStatus(entityId, cb) if available on wiki instance
    → falls back to getEntityStatus polling at statusPollIntervalMs
    → reports error if neither API is available
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

### Status subscription fallback

`subscribeEntityStatus` shipped in `expo-llm-wiki@4.1.0`, but the `Wiki` type still marks it as optional for forward compatibility with tests, older bundles, and partial upgrades. When unavailable, the machine falls back to `getEntityStatus` polling at `statusPollIntervalMs` (default 5000ms; `0` = initial status only, no repeating timer). If neither API exists, the machine reports via `reportError` and runs without status updates.

**Phase 5 cleanup:** Once `expo-llm-wiki` minimum is `>=4.1.0` in production, drop the optional typing and the polling fallback branch.

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

`useCharacterWikiSync` — standalone hook used by the character edit screen (`characters/[id]/edit.tsx`) for manual one-off sync. Bypasses the orchestrator and calls `wiki.exportDump`/`wiki.importDump` directly. **Phase 5 cleanup candidate:** migrate this to `useCharacterWiki.sync()` and delete the standalone hook.

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
`subscribeStatus` (fromCallback) invoked once at machine creation; dispatches `STATUS` events updating `context.status`. `ChatView` reads `useCharacterWiki(charId).status` for the banner. When `subscribeEntityStatus` is available: no polling, immediate updates. When falling back to `getEntityStatus`: polls at `statusPollIntervalMs`.

### Sync path (premium, cloud-linked)

Two code paths use sync:

1. **Background sync** (`characterSyncService.syncWikiForCloud`): Triggered by `syncAllToCloud` on startup and network reconnect. Iterates cloud-linked characters sequentially (concurrency=1), calling `wikiOrchestrator.syncAll` per character. The `runRemoteSync` callback remaps local↔cloud entity IDs and calls the `wikiSync` cloud function.

2. **Manual sync** (`useCharacterWikiSync` in character edit screen): Direct `exportDump`/`importDump` bypass, not orchestrator-based. Phase 5 cleanup candidate.

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
- **TODO (no owning task yet):** Machine actor stopped when character soft-deleted (after `forget(clearAll)`). Needs wiring into the character soft-delete flow — track as Phase 5 or standalone issue.
- `subscribeEntityStatus` / polling fallback unsubscribed on machine stop.

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
**Status:** In PR review (#372).
**1 PR.** Replace package-hook calls in `ChatView`, `ChatComposer`, `useAIChat`, `characterSyncService.syncWikiForCloud` to go through `useCharacterWiki(entityId)` / `wikiOrchestrator`. Delete 5s polling in `ChatView`. Route `syncWikiForCloud` through `wikiOrchestrator.syncAll` (sequential per-character, concurrency=1).

**Scope note:** `useCharacterWikiSync` (used by character edit screen) is **not** migrated in Phase 3 — it remains a direct `exportDump`/`importDump` path. Migration to orchestrator is Phase 5 cleanup.

### Phase 4 — Enhancements (parallel, after P3)
- **P4a:** Batch sync concurrency — change `syncWikiForCloud` from sequential per-character `syncAll` calls (concurrency=1) to a single `syncAll` call with all cloud-linked characters and concurrency=2. Add network-reconnect and startup trigger wiring. Validate against `wikiSync` cloud function for race conditions.
- **P4b:** Memory inspector UI — `/settings/memory/[characterId]` route listing facts/tasks/events with delete via `wiki.forget`.

### Phase 5 — Cleanup (sequential, last)
**1 PR.**
- Remove `useCharacterWikiSync` standalone hook; migrate character edit screen to `useCharacterWiki.sync()`.
- Wire `wikiOrchestrator.stop(entityId)` into character soft-delete flow.
- Drop `subscribeEntityStatus` optional typing and polling fallback (once `expo-llm-wiki` minimum is `>=4.1.0`).
- Remove any remaining unused hooks.
- Update `AGENTS.md`, add architecture doc reference.

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
- **Concurrent sync:** `syncWikiForCloud` previously serial; Phase 4a's concurrency=2 may surface race conditions in `wikiSync` cloud function. Validate before P4a lands.

## Open Questions

1. **Free-tier librarian cost:** With `autoLibrarianThreshold: 5` and memory ungated, librarian LLM calls will increase significantly. Has `wikiLlmProvider` credit accounting been validated for the increased volume? If cost is prohibitive, should librarian be scoped to premium?
2. **`useCharacterWikiSync` migration timing:** The standalone hook bypasses the orchestrator. Is Phase 5 the right time to migrate the character edit screen, or should it happen sooner?
3. **Actor stop on character delete:** No phase currently wires `wikiOrchestrator.stop(entityId)` into the soft-delete flow. Assign to Phase 5 or track as a standalone issue?

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
- `statusPollIntervalMs: number` - Polling interval when subscribeEntityStatus unavailable (default 5000; 0 = initial only)

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
- **Status subscription:** Uses `subscribeEntityStatus` if available; else polls `getEntityStatus` on `statusPollIntervalMs` (default 5000ms, `0` = initial only)
- **Cleanup:** Unsubscribes from status on actor stop

### wikiOrchestrator Implementation

**File:** `src/services/wikiOrchestrator.ts`

**API:**
- `getOrSpawn(entityId, wiki, machineOptions?): WikiActor` - Get or create actor for entity (cached); optional `busyRetryDelayMs` / `statusPollIntervalMs` apply only on first spawn
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

Extended `Wiki` type for forward compatibility:
```typescript
export type Wiki = BaseWiki & {
  subscribeEntityStatus?: (
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

6. **subscribeEntityStatus:** Shipped in `@equationalapplications/expo-llm-wiki@4.1.0`. Clanker still types it as optional on `Wiki` and `wikiMachine` falls back to `getEntityStatus` polling on `statusPollIntervalMs` (default 5000ms; `0` = initial sample only) when the runtime wiki instance does not expose it (tests, older bundles, or partial upgrades). Missing both subscription and `getEntityStatus` is reported via `reportError`.

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
- Status fallback with neither API calls `reportError` with `wiki:<id>:statusSubscription`
- `statusPollIntervalMs: 0` polls `getEntityStatus` only once (no interval)

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
