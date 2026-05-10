# Wiki State Machine Design (Phase 2a)

**Date:** 2026-05-09  
**Status:** Implemented  
**Related:** [expo-llm-wiki integration](./2026-04-30-expo-llm-wiki-integration.md)

## Overview

Phase 2a introduces a per-entity XState v5 state machine (`wikiMachine`) to serialize wiki operations and a singleton orchestrator (`wikiOrchestrator`) to manage actor lifecycle and coordinate bulk sync operations.

## Goals

1. **Serialize mutations** - Ensure only one wiki operation runs per entity at a time
2. **Handle busy errors gracefully** - Retry operations when wiki is busy (WikiBusyError)
3. **Track entity status** - Subscribe to and expose entity status (ingesting, librarian, heal)
4. **Coordinate bulk sync** - Support syncing multiple entities with concurrency control
5. **Error recovery** - Auto-recover from errors with retry mechanism

## Architecture

### wikiMachine (per-entity actor)

**States:**
- `idle` - Ready to accept operations
- `reading` - Executing READ operation
- `writing` - Executing WRITE operation
- `ingesting` - Executing INGEST operation
- `syncing` - Executing SYNC operation
- `forgetting` - Executing FORGET operation
- `error` - Error state with auto-recovery

**Events:**
- `READ` - Query wiki for entity
- `WRITE` - Write observation to wiki
- `INGEST` - Ingest document into wiki
- `SYNC` - Sync entity with remote
- `FORGET` - Remove document from wiki
- `STATUS` - Update entity status (from subscription)
- `RETRY` - Manually retry from error state

**Context:**
- `entityId` - Entity identifier
- `wiki` - Wiki instance
- `status` - Current entity status
- `lastError` - Last error encountered (null if none)
- `lastReadAt` - Timestamp of last successful read
- `pendingEvents` - Queue of events received while busy

**Behavior:**
- Operations are serialized via a `pendingEvents` queue
- Events received while busy are enqueued and flushed on `idle` entry
- `WikiBusyError` causes transition back to `idle` (operation is re-enqueued by caller)
- Other errors transition to `error` state and call `reportError`
- Error state auto-recovers after 30s or via `RETRY` event
- Status subscription runs continuously via `fromCallback` actor

### wikiOrchestrator (singleton)

**API:**
- `getOrSpawn(entityId, wiki)` - Get or create actor for entity
- `stop(entityId)` - Stop and remove actor
- `syncAll(items, wiki, concurrency)` - Sync multiple entities with bounded parallelism

**Behavior:**
- Caches actors by `entityId`
- `syncAll` uses work-queue pattern to limit concurrent syncs
- Waits for each actor to reach `idle` or `error` before resolving
- Actors in `error` state are sent `RETRY` before `SYNC`

## Implementation Notes

### Type Derivation

`IngestArgs` and `ForgetArgs` are not exported by `@equationalapplications/expo-llm-wiki@4.1.0`, so they are derived locally:

```typescript
export type IngestArgs = Parameters<Wiki['ingestDocument']>[1]
export type ForgetArgs = Parameters<Wiki['forget']>[1]
```

### WikiBusyError Handling

`WikiBusyError` constructor signature is `(operation: WikiBusyOperation, entityId: string)`, not `(message: string)`.

When a `WikiBusyError` is caught, the machine transitions back to `idle` and the operation is re-enqueued by the caller for retry.

### Wiki.write API

The `write` method signature is `write(entityId, event)` (two arguments), not `write({ entity_id, ...event })` (single object).

### Event Queuing

XState v5 does not buffer unhandled events automatically. A manual `pendingEvents` queue is implemented with `enqueueActions(flushPending)` on `idle` entry to ensure serialization.

## Testing

### wikiMachine Tests (10 tests)

- READ → reading → idle
- WRITE → writing → idle
- INGEST → ingesting → idle
- FORGET → forgetting → idle
- SYNC runs export → runRemoteSync → import → prune
- Mutation while in flight is queued (serialized)
- WikiBusyError → defers + retries without reportError
- Non-busy error → error state with lastError
- STATUS event updates context.status
- Actor stop unsubscribes from status

### wikiOrchestrator Tests (4 tests)

- getOrSpawn returns same actor for repeat entityId
- getOrSpawn returns distinct actors for distinct entityIds
- stop removes actor and unsubscribes status
- syncAll runs at most `concurrency` syncs in flight

## Future Work (Phase 2b+)

- Integrate wikiMachine into existing hooks (useCharacterWiki, etc.)
- Replace direct wiki calls with actor.send()
- Add UI indicators for entity status
- Add metrics/telemetry for operation timing
- Consider adding operation history/audit log
