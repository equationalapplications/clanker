# Offline Support Architecture

This document describes the offline-first architecture implemented in the app. All deprecated hooks referenced here have already been removed — this file records the design decisions and how the system works.

## Architecture Overview

| Layer | Technology | Role |
|---|---|---|
| Local DB | expo-sqlite (SQLite) | Source of truth for characters + messages |
| Query cache | TanStack Query v5 | In-memory cache with offlineFirst for local queries |
| Cache persistence | expo-sqlite/kv-store | Survives app restarts — queries served offline immediately |
| Network detection | @react-native-community/netinfo | Drives `onlineManager`, triggers reconnect sync |
| Cloud backup | Supabase `clanker_characters` | Backup/restore for characters only |

Messages are **never synced to cloud** (privacy by design).

## Key Files

| File | Purpose |
|---|---|
| `src/config/networkManager.ts` | Bridges NetInfo → `onlineManager`; calls optional reconnect callback |
| `src/config/queryPersister.ts` | `Persister` impl using `expo-sqlite/kv-store`; key `tanstack-query-cache` |
| `src/config/queryClient.ts` | `gcTime: 24h` (matches persister `maxAge`); queries default `online`, mutations `offlineFirst` |
| `app/_layout.tsx` | Wraps app in `PersistQueryClientProvider`; sets up network manager + reconnect sync |
| `src/hooks/useCharacters.ts` | `networkMode: offlineFirst` — reads from SQLite, always works offline |
| `src/hooks/useMessages.ts` | `networkMode: offlineFirst` — reads from SQLite, always works offline |
| `src/services/characterService.ts` | Canonical character CRUD; talks to SQLite via `characterDatabase.ts` |
| `src/services/characterSyncService.ts` | `syncAllToCloud()` / `restoreFromCloud()`; called on reconnect + explicitly |
| `src/database/schema.ts` | Schema v2: adds `deleted_at INTEGER` to characters table |
| `src/database/characterDatabase.ts` | Soft-delete (`deleteCharacter` sets `deleted_at`); `hardDeleteCharacterLocal` runs post-sync |
| `src/components/NetworkStatusBanner.tsx` | Renders an offline indicator bar; subscribes to `onlineManager` |

## How offline works

### App restart while offline

1. `PersistQueryClientProvider` restores the previous cache from kv-store synchronously
2. All queries that were previously fetched show their cached data immediately
3. Network-dependent queries (`networkMode: 'online'`) are paused — stale cache is shown
4. Characters and messages (`networkMode: 'offlineFirst'`) re-read from SQLite immediately

### Characters

- `getUserCharacters` reads from SQLite, filtered to exclude soft-deleted rows
- Creating, updating characters works fully offline — optimistic UI updates immediately
- Changes are stored in SQLite with `synced_to_cloud = 0`
- On reconnect → `syncAllToCloud()` is called automatically

### Messages

- All messages live in local SQLite only, forever
- `networkMode: 'offlineFirst'` means chat history is always available
- Sending a message while offline: user message saved to SQLite; AI generation attempted immediately — if offline, a placeholder reply is saved and the user can retry when back online

> **Future: Offline AI Queueing** — A future iteration may queue failed AI requests and retry them automatically on reconnect. Currently, AI generation requires network connectivity.

### User profile / credits

- These are Supabase cloud queries (`networkMode: 'online'`)
- When offline, the persisted cache from the last successful fetch is shown
- No offline writes supported for profile (only online)

## Character cloud sync

### What gets synced

Only characters, not messages. Sync direction: **local → cloud** (local is source of truth).

### Conflict resolution

**Last-write-wins** by `updated_at`. Since characters are per-user and stored locally, conflicts are rare.

### Sync triggers

1. **App startup**: `RootLayoutNav` triggers `syncAllToCloud()` when auth resolves and the device is online — catches edits made offline in a previous session
2. **Reconnect**: `setupNetworkManager` in `_layout.tsx` calls `syncAllToCloud()` on offline→online transition during an active session
3. **Explicit**: Call `syncAllToCloud()` / `restoreFromCloud()` from `characterSyncService.ts` directly

### Deletion flow

1. User deletes a character → `deleteCharacter()` sets `deleted_at = now(), synced_to_cloud = 0`
2. Character disappears from UI immediately (filtered out of `getUserCharacters`)
3. On next sync, `syncDeletionsToCloud` deletes from Supabase
4. After cloud confirms deletion, `hardDeleteCharacterLocal` removes from SQLite (+ messages)

### Restore from cloud (new device)

```typescript
import { restoreFromCloud } from '~/services/characterSyncService'

// In a settings screen or onboarding flow:
await restoreFromCloud()
```

All characters from Supabase are imported into local SQLite. Only cloud records with a newer `updated_at` than existing local records are written; local-only or locally-newer characters are preserved.

## NetworkStatusBanner

Add it anywhere in the tree to show an offline indicator:

```tsx
import { NetworkStatusBanner } from '~/components/NetworkStatusBanner'

function AppShell() {
  return (
    <>
      <NetworkStatusBanner />
      {/* rest of app */}
    </>
  )
}
```

Renders nothing when online. Shows a slim dark bar with "You're offline" when the device loses connectivity.

## Hook reference

| Hook | Source | Network mode | Notes |
|---|---|---|---|
| `useCharacters()` | SQLite | offlineFirst | Full CRUD + optimistic updates |
| `useCharacter(id)` | SQLite | offlineFirst | Seeded from list cache |
| `useMessages(charId, userId)` | SQLite | offlineFirst | Polls every 5s for AI responses |
| `useUserPublicData()` | Supabase | online | Persisted cache shown offline |
| `useUserPrivateData()` | Supabase | online | Real-time credits subscription |
| `useUserProfile()` | Supabase | online | Real-time profile subscription |

## Validation Checklist

- [ ] Real-time sync: character changes from other devices appear after restore/sync flows
- [ ] Loading states: first-load spinners still appear where expected
- [ ] Refetching: pull-to-refresh still works on online-backed screens

### Debug Tips

**Enable query dev tools** (development only):

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

// In app/_layout.tsx
<PersistQueryClientProvider client={queryClient} persistOptions={{ persister: kvStorePersister }}>
  {children}
  {__DEV__ && <ReactQueryDevtools initialIsOpen={false} />}
</PersistQueryClientProvider>
```

**Log cache operations:**

```typescript
// In hooks
console.log('📊 Query data:', data)
console.log('🔄 Refetching:', isRefetching)
console.log('⏳ Mutation pending:', isPending)
```

**Check network tab:**

- See how many requests are actually made
- Verify caching is working (fewer requests than renders)

## Rollback Plan

If issues occur, rollback is easy:

1. Revert the persisted query client setup in [app/_layout.tsx](app/_layout.tsx)
2. Revert the network manager bridge in [src/config/networkManager.ts](src/config/networkManager.ts)
3. Revert schema version 2 and the deleted_at migration only with a deliberate database reset or a forward migration

This architecture includes a SQLite schema change for characters, so rollback is not purely client-side once version 2 has shipped.

## Getting Help

If you encounter issues:

1. Check this document and the linked files above for the current implementation
2. Review React Query [error handling guide](https://tanstack.com/query/latest/docs/react/guides/mutations#mutation-side-effects)
3. Enable dev tools to inspect cache state
4. Check console for cache invalidation logs

## Next Steps

After basic migration:

1. **Add persistence**: Use `persistQueryClient` with AsyncStorage
2. **Prefetch data**: Prefetch next screen data for instant navigation
3. **Implement pagination**: Use `useInfiniteQuery` for long lists
4. **Add background sync**: Sync data when app is in background
5. **Optimize stale times**: Tune based on real usage patterns
