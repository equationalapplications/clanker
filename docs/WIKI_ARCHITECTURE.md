# Wiki State Machine Architecture

The character memory system uses `@equationalapplications/expo-llm-wiki@4.1.0` with an XState v5 state machine per character to serialize all wiki operations.

## Components

- **`wikiMachine`** (`src/machines/wikiMachine.ts`) — One actor per character. States: `idle`, `reading`, `writing`, `ingesting`, `syncing`, `forgetting`, `busyRetry`, `error`. All operations are queued via `pendingEvents` and flushed sequentially from `idle`. `WikiBusyError` triggers automatic retry after a configurable delay.

- **`wikiOrchestrator`** (`src/services/wikiOrchestrator.ts`) — Singleton that manages wiki machine actors. API: `getOrSpawn(entityId, wiki, machineOptions?)`, `stop(entityId)`, `syncAll(items, wiki, concurrency?, timeoutMs?, options?)` where `options` accepts `{ stopActorsSpawnedForBatch?, machineOptions? }`. Actors are cached by entity ID.

- **`useCharacterWiki`** (`src/hooks/useCharacterWiki.ts`) — React hook wrapping the orchestrator. Returns `{ status, isBusy, isIngesting, error, read, write, ingest, forget, sync, hasChanged }`. All call sites (chat, sync service, edit screen) use this hook or the orchestrator directly.

- **`wikiService`** (`src/services/wikiService.ts`) — Wiki singleton setup with mobile-optimized config (`autoLibrarianThreshold: 5`, tight prune defaults).

## Data Flow

1. **Chat send:** `useAIChat` → `useCharacterWiki.read(query)` → machine: idle→reading→idle → format context → send with AI → `useCharacterWiki.write(observation)`.
2. **Status:** `subscribeEntityStatus` callback → `STATUS` events update `context.status` → `useCharacterWiki.status` for UI banner.
3. **Cloud sync:** `characterSyncService.syncWikiForCloud` → `wikiOrchestrator.syncAll` with entity-ID remap in `runRemoteSync` callback.
4. **Character delete:** `characterMachine` DELETE → soft-delete in DB → `wikiOrchestrator.stop(entityId)`.

## Key Design Decisions

- **No subscription gate on memory:** All users get memory read/write/ingest. Cloud sync remains gated on `save_to_cloud + cloud_id`.
- **SYNC carries a callback:** `runRemoteSync` decouples the machine from cloud-specific entity-ID remapping.
- **`subscribeEntityStatus` required:** Polling fallback removed since `expo-llm-wiki@4.1.0` is the minimum version.

## Spec

Full design: [`docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md`](superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md)
