# LLM Wiki State Machine + v4 Upgrade Design

**Date:** 2026-05-09
**Status:** Draft
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
- Eliminate 5s status polling via `subscribeEntityStatus`.
- Drop the `hasUnlimited` gate on memory read/write/ingest. Cloud sync stays premium.
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
              ├─ getOrSpawn(entityId): ActorRef
              ├─ stop(entityId): void          // on character delete
              └─ syncAll(entityIds, concurrency=2)

wikiMachine (XState v5, one actor per character)
  context: {
    entityId: string
    status: { ingesting: boolean; librarian: boolean; heal: boolean }
    lastError: Error | null
    lastReadAt: number | null
  }
  invoked actor: subscribeEntityStatus(entityId) via fromCallback
  states:
    idle
      on READ      → reading
      on WRITE     → writing
      on INGEST    → ingesting
      on SYNC      → syncing
      on STATUS    → idle (assign context.status)
      on FORGET    → forgetting
    reading        → invoke wiki.read         → idle | error
    writing        → invoke wiki.write        → idle | error
    ingesting      → invoke wiki.ingestDocument → idle | error
    forgetting     → invoke wiki.forget       → idle | error
    syncing        → invoke export → wikiSync → import → prune → idle | error
    error
      entry: assign lastError, reportError(lastError, 'wiki:<op>')
      on RETRY → idle
      after 30000 → idle
  guards:
    isBusyError: WikiBusyError → defer + retry next tick
  serialization:
    mutations (write/ingest/sync/forget) wait for current mutation to settle
    READ events run concurrent (no state change for read; spawned read child actor)
```

### Hooks

`src/hooks/useCharacterWiki.ts` rewritten:

```ts
export function useCharacterWiki(entityId: string) {
  const actor = wikiOrchestrator.getOrSpawn(entityId)
  const status = useSelector(actor, (s) => s.context.status)
  const isBusy = useSelector(actor, (s) => !s.matches('idle'))
  const error = useSelector(actor, (s) => s.context.lastError)

  return {
    status,                                 // { ingesting, librarian, heal }
    isBusy,
    error,
    read: (query: string) => sendAndAwait(actor, { type: 'READ', query }),
    write: (summary: string) => actor.send({ type: 'WRITE', summary }),
    ingest: (doc: IngestArgs) => sendAndAwait(actor, { type: 'INGEST', doc }),
    sync: (cloudId: string) => sendAndAwait(actor, { type: 'SYNC', cloudId }),
    forget: (args: ForgetArgs) => sendAndAwait(actor, { type: 'FORGET', args }),
  }
}
```

Replaces direct package hook usage in `ChatView`, `ChatComposer`, `useAIChat`, `useCharacterWikiSync`.

## Data Flow

### Read path (chat send)
```
useAIChat.sendMessage
  → useCharacterWiki(charId).read(query)
    → wikiMachine: idle → reading → idle
    → wiki.read → bundle → formatContext({maxFacts:10,maxTasks:5,maxEvents:10})
  → sendMessageWithAIResponse({ memoryBlock, onWriteObservation })
  → onWriteObservation(text)
    → wikiMachine.send({ type: 'WRITE', summary: text })  // fire-and-forget
```

### Status path
`subscribeEntityStatus(entityId, cb)` invoked once on machine entry; callback dispatches `STATUS` events updating `context.status`. ChatView selector reads `status.ingesting` and `status.librarian` for the banner. No interval, immediate updates.

### Sync path (premium, cloud-linked)
Triggered by network reconnect (`setupNetworkManager`) and startup. `wikiOrchestrator.syncAll(cloudLinkedIds, 2)` sends `SYNC` to each machine; per-entity sync is serialized internally; up to 2 entities sync in parallel.

### Ingest path
Unchanged user flow (`+` button → `DocumentPicker`). Goes through `useCharacterWiki(charId).ingest(...)`.

## Configuration Changes

`wikiService.setupWiki` config:

```ts
{
  tablePrefix: 'llm_wiki_',
  autoLibrarianThreshold: 5,        // was 20
  autoHealThreshold: 100,           // was unset (default)
  pruneRetainSoftDeletedFor: 3,     // was unset (default 7)
  pruneEventsAfter: 14,             // was unset (default 30)
  orphanAfterDays: 14,              // was unset (default 30)
  staleInferredAfterDays: 30,       // was unset (default 60)
  preFilterLimit: 300,              // unchanged
  hybridWeight: 0.7,                // unchanged
}
```

## Invariants

- One mutation per entity at a time. Reads concurrent.
- `WikiBusyError` from package = retry next event; never user-facing crash.
- Memory writes/reads/ingest never gated on subscription state.
- Cloud sync gated on `save_to_cloud + cloud_id` UUID.
- All errors flow through `reportError(err, 'wiki:<op>')`.
- Machine actor stopped when character soft-deleted (after `forget(clearAll)`).
- `subscribeEntityStatus` unsubscribed on machine stop.

## Phases & PRs

### Phase 1 — Package upgrade (sequential, blocks rest)
**1 PR.** Bump to 4.1.0, audit migration, update `wikiService` config to new defaults. Smoke tests pass.

### Phase 2 — Independent foundations (parallel)
- **P2a:** `wikiMachine` + `wikiOrchestrator`, no call-site changes. Unit tests with mocked wiki.
- **P2b:** Drop `hasUnlimited` gate on memory in `useAIChat`, `ChatComposer`, `ChatView`. Cloud sync gate unchanged. Tests for free-tier path.
- **P2c:** Replace `console.warn('[wiki]…')` with `reportError`. `WikiBusyError` discrimination. No behavior change.

### Phase 3 — Wire call-sites (sequential, after P2a + P2b)
**1 PR.** Replace package-hook calls in `ChatView`, `ChatComposer`, `useAIChat`, `useCharacterWiki`, `useCharacterWikiSync`, `characterSyncService.syncWikiForCloud` to go through `useCharacterWiki(entityId)`. Delete 5s polling in `ChatView`.

### Phase 4 — Enhancements (parallel, after P3)
- **P4a:** Cloud sync via machine — move `syncWikiForCloud` per-character loop into `wikiOrchestrator.syncAll`; concurrency cap 2.
- **P4b:** Memory inspector UI — `/settings/memory/[characterId]` route listing facts/tasks/events with delete via `wiki.forget`.

### Phase 5 — Cleanup (sequential, last)
**1 PR.** Remove unused hooks, update `AGENTS.md`, add architecture doc reference.

## Testing

- **Unit:** `wikiMachine.test.ts` covers all transitions, busy serialization, `WikiBusyError` retry, status event flow. `wikiOrchestrator.test.ts` covers spawn/stop, `syncAll` concurrency. Existing `useAIChat`, `ChatComposer`, `ChatView` tests updated to use mocked machine.
- **Integration:** Chat send triggers READ + WRITE on machine; ChatView banner reflects STATUS events without polling. Free-tier user gets memory recall after 5 messages.
- **Manual QA:** Send 5 messages on free tier → librarian fires → 6th send shows fact. Ingest doc → banner appears immediately. Offline → online → no duplicate facts after sync. Kill app mid-write → restart → no orphan busy state.

## Risks

- **v3 → v4 migration:** Schema changes possible. P1 must verify `wiki.setup()` migrates existing on-device data without loss. Block landing P1 until validated on a populated test DB.
- **Subscription leak:** `subscribeEntityStatus` must unsubscribe on actor stop. Test-cover this.
- **Free-tier load:** Memory ops now run for all users; LLM calls for librarian still cost credits. Confirm `wikiLlmProvider` accounting handles the increased volume, or scope librarian to premium if cost is prohibitive.
- **Concurrent sync:** `syncWikiForCloud` previously serial; concurrency=2 may surface race conditions in `wikiSync` cloud function. Validate before P4a lands.

## Open Questions

None at spec sign-off. Re-open if `wiki@4.1.0` changelog reveals migration blockers during P1.

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
- `pendingEvents: WikiMutationEvent[]` - Queue for serializing mutations
- `currentEvent: WikiMutationEvent | null` - Currently processing event (for re-enqueue on busy)

**States:**
- `idle` - Ready to accept operations; flushes pending events on entry
- `reading` - Executing READ operation
- `writing` - Executing WRITE operation
- `ingesting` - Executing INGEST operation
- `syncing` - Executing SYNC operation (export → runRemoteSync → import → prune)
- `forgetting` - Executing FORGET operation
- `error` - Error state with auto-recovery (RETRY event or after 30s)

**Events:**
- `READ` - Query wiki for entity
- `WRITE` - Write observation to wiki
- `INGEST` - Ingest document into wiki
- `SYNC` - Sync entity with remote (no cloudId parameter - removed as unused)
- `FORGET` - Remove document from wiki
- `STATUS` - Update entity status (from subscription)
- `RETRY` - Manually retry from error state

**Key Behaviors:**
- **Serialization:** Mutations queued via `pendingEvents`; flushed on `idle` entry
- **WikiBusyError handling:** Re-enqueues operation via `requeueCurrentEvent` action for automatic retry
- **Error recovery:** `lastError` cleared on successful operations and recovery transitions
- **Status subscription:** Uses `subscribeEntityStatus` if available, falls back to polling `getEntityStatus` every 5000ms (5s)
- **Cleanup:** Unsubscribes from status on actor stop

### wikiOrchestrator Implementation

**File:** `src/services/wikiOrchestrator.ts`

**API:**
- `getOrSpawn(entityId, wiki): WikiActor` - Get or create actor for entity (cached)
- `stop(entityId): void` - Stop and remove actor from cache
- `syncAll(items, wiki, concurrency=2): Promise<void>` - Sync multiple entities with bounded parallelism

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
- Sends `RETRY` before `SYNC` for actors in error state
- Waits for each actor to reach `idle` or `error` before resolving

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

1. **IngestArgs/ForgetArgs:** Not exported by package v3.0.0 (design assumed v4.1.0). Derived locally as `Parameters<Wiki['ingestDocument']>[1]` and `Parameters<Wiki['forget']>[1]`.

2. **WikiBusyError constructor:** Signature is `(operation: WikiBusyOperation, entityId: string)`, not `(message: string)`.

3. **Wiki.write API:** Two-argument signature `write(entityId, event)`, not single-object `write({ entity_id, ...event })`.

4. **Event queuing:** XState v5 doesn't buffer unhandled events automatically. Implemented manual `pendingEvents` queue with `enqueueActions(flushPending)` on idle entry.

5. **cloudId parameter:** Removed from SYNC event as unused in implementation.

6. **subscribeEntityStatus:** Not available in package v3.0.0. Added polling fallback and forward-compatible type extension.

### Test Coverage

**wikiMachine.test.ts (10 tests):**
- READ → reading → idle and calls wiki.read
- WRITE → writing → idle and calls wiki.write
- INGEST → ingesting → idle and calls wiki.ingestDocument
- FORGET → forgetting → idle and calls wiki.forget
- SYNC runs export → runRemoteSync → import → prune in order
- Mutation while in flight is queued (serialized)
- WikiBusyError → re-enqueues and retries automatically
- Non-busy error → error state with assigned lastError
- STATUS event updates context.status
- Actor stop unsubscribes from status

**wikiOrchestrator.test.ts (4 tests):**
- getOrSpawn returns same actor for repeat entityId
- getOrSpawn returns distinct actors for distinct entityIds
- stop removes the actor and unsubscribes status
- syncAll runs at most `concurrency` syncs in flight

All tests use `waitFor` from XState for deterministic state transitions (no flaky `setTimeout` calls).

### Next Steps (Phase 2b+)

Phase 2a is complete and ready for integration. Next phases:
- **P2b:** Drop `hasUnlimited` gate on memory operations
- **P2c:** Replace `console.warn` with `reportError` for wiki errors
- **P3:** Wire call-sites to use `wikiMachine` via updated hooks
