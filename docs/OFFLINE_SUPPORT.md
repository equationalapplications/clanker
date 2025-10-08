# Offline Support with React Query

The app now has comprehensive offline capabilities powered by `@tanstack/react-query`. This document explains the architecture, patterns, and how to use the offline features.

## Overview

**Key Features:**

- **Aggressive Caching**: Data is cached locally for 5-30 minutes depending on volatility
- **Optimistic Updates**: UI updates immediately before server confirms
- **Offline Queuing**: Mutations are queued when offline and sent when connection returns
- **Background Sync**: Automatic refetch on network reconnection
- **Real-time Updates**: Supabase subscriptions invalidate cache for live updates

## Architecture

### Query Client Configuration

Located in `src/config/queryClient.ts`:

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: 3, // Retry failed queries
      refetchOnReconnect: true, // Sync on reconnect
      networkMode: 'online', // Query only when online
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst', // Queue mutations offline
    },
  },
})
```

### Key Concepts

**Stale Time**: How long data is considered "fresh". Fresh data is served from cache without refetch.

**Garbage Collection Time**: How long unused data stays in cache. Critical for offline access.

**Network Mode**:

- `online` (queries): Only fetch when online, serve stale data offline
- `offlineFirst` (mutations): Queue mutations when offline, send when online

## Query Key Factories

Centralized key management prevents typos and ensures consistency:

**Characters:**

```typescript
characterKeys.all // ['characters']
characterKeys.list(userId) // ['characters', 'list', userId]
characterKeys.detail(characterId) // ['characters', 'detail', characterId]
```

**Messages:**

```typescript
messageKeys.all // ['messages']
messageKeys.list(characterId, recipientUserId) // ['messages', 'list', ...]
```

**User Data:**

```typescript
userKeys.profile(userId) // ['user', 'profile', userId]
userKeys.public(userId) // ['user', 'public', userId]
userKeys.private(userId) // ['user', 'private', userId]
```

## Hook Usage Patterns

### Reading Data (Queries)

**Characters:**

```typescript
import { useCharacters, useCharacter } from '~/hooks/useCharacters'

// Get all user characters
const { characters, isLoading, error, refetch } = useCharacters()

// Get single character
const { character, isLoading, error } = useCharacter('character-id')
```

**Messages:**

```typescript
import { useMessages } from '~/hooks/useMessages'

const { messages, isLoading, error } = useMessages(characterId, recipientUserId)
```

**User Data:**

```typescript
import { useUserProfile, useUserPublicData, useUserPrivateData } from '~/hooks/useUser'

const { profile, isLoading } = useUserProfile()
const { userPublic } = useUserPublicData()
const { userPrivate } = useUserPrivateData() // Includes credits
```

### Mutating Data

**Create Character:**

```typescript
import { useCreateCharacter } from '~/hooks/useCharacters'

const createCharacter = useCreateCharacter()

// Optimistic update - character appears immediately
await createCharacter.mutateAsync({
  name: 'New Character',
  appearance: 'A mysterious figure',
  traits: 'Curious and intelligent',
  emotions: 'Calm and collected',
  context: 'A helpful companion',
  is_public: false,
})

// Check status
if (createCharacter.isPending) {
  /* Show loading */
}
if (createCharacter.isError) {
  /* Show error */
}
if (createCharacter.isSuccess) {
  /* Success! */
}
```

**Update Character:**

```typescript
import { useUpdateCharacter } from '~/hooks/useCharacters'

const updateCharacter = useUpdateCharacter()

await updateCharacter.mutateAsync({
  id: 'character-id',
  updates: { name: 'Updated Name' },
})
```

**Delete Character:**

```typescript
import { useDeleteCharacter } from '~/hooks/useCharacters'

const deleteCharacter = useDeleteCharacter()

await deleteCharacter.mutateAsync('character-id')
```

**Send Message:**

```typescript
import { useSendMessage } from '~/hooks/useMessages'

const sendMessage = useSendMessage(characterId, recipientUserId)

await sendMessage.mutateAsync({
  _id: 'unique-id',
  text: 'Hello!',
  user: { _id: userId, name: 'User' },
})
```

**Update Profile:**

```typescript
import { useUpdateProfile } from '~/hooks/useUser'

const updateProfile = useUpdateProfile()

await updateProfile.mutateAsync({
  display_name: 'New Name',
  avatar_url: 'https://...',
})
```

## Optimistic Updates Pattern

All mutations include optimistic updates for instant UI feedback:

1. **onMutate**: Cancel in-flight queries, save previous state, update cache immediately
2. **onSuccess**: Update cache with server response
3. **onError**: Rollback to previous state

Example from `useCreateCharacter`:

```typescript
{
  onMutate: async (newCharacter) => {
    // Cancel in-flight queries
    await queryClient.cancelQueries({ queryKey: characterKeys.list(userId) })

    // Save previous state
    const previousCharacters = queryClient.getQueryData(characterKeys.list(userId))

    // Update cache immediately with temp ID
    const optimisticCharacter = { id: `temp-${Date.now()}`, ...newCharacter }
    queryClient.setQueryData(characterKeys.list(userId), [optimisticCharacter, ...old])

    return { previousCharacters, optimisticCharacter }
  },

  onSuccess: (data, variables, context) => {
    // Replace temp character with real one from server
    queryClient.setQueryData(characterKeys.list(userId), (old) =>
      old.map((char) => char.id === context.optimisticCharacter.id ? data : char)
    )
  },

  onError: (error, variables, context) => {
    // Rollback to previous state
    queryClient.setQueryData(characterKeys.list(userId), context.previousCharacters)
  },
}
```

## Real-time Sync Pattern

Supabase subscriptions invalidate React Query cache to trigger refetch:

```typescript
useEffect(() => {
  if (!userId) return

  const channel = supabaseClient
    .channel(`user-characters-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'yours_brightly_characters',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        // Invalidate cache to refetch
        queryClient.invalidateQueries({ queryKey: characterKeys.list(userId) })

        if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
          const characterId = payload.old?.id || payload.new?.id
          queryClient.invalidateQueries({ queryKey: characterKeys.detail(characterId) })
        }
      },
    )
    .subscribe()

  return () => {
    supabaseClient.removeChannel(channel)
  }
}, [userId, queryClient])
```

## Offline Behavior

### When User Goes Offline

**Queries**:

- Serve stale data from cache (if available)
- Show `isLoading: false` with cached data
- Show `error` only if no cached data exists

**Mutations**:

- Queue mutations locally
- Show optimistic updates immediately
- Mark as `pending: true`

### When User Comes Online

**Queries**:

- Automatic refetch on reconnect (`refetchOnReconnect: true`)
- Background sync without blocking UI
- Cache updates with fresh data

**Mutations**:

- Queued mutations sent automatically
- Optimistic updates replaced with server response
- Errors shown if mutation fails on retry

## Legacy Hook Compatibility

Old hooks still work but delegate to new React Query implementation:

**Before:**

```typescript
// Old: useCharacterList.ts (manual state management)
const characters = useCharacterList()
```

**After (internal):**

```typescript
// New: useCharacterList.ts (delegates to React Query)
export function useCharacterList() {
  return useCharacterListQuery() // From useCharacters.ts
}
```

**Migration Path**: No breaking changes. Existing code works with new offline capabilities automatically.

## Cache Management

### Manual Cache Updates

```typescript
import { useQueryClient } from '@tanstack/react-query'
import { characterKeys } from '~/hooks/useCharacters'

const queryClient = useQueryClient()

// Get cached data
const characters = queryClient.getQueryData(characterKeys.list(userId))

// Update cache manually
queryClient.setQueryData(characterKeys.list(userId), newCharacters)

// Invalidate cache to trigger refetch
queryClient.invalidateQueries({ queryKey: characterKeys.list(userId) })

// Remove from cache
queryClient.removeQueries({ queryKey: characterKeys.detail(characterId) })

// Clear all cache (on logout)
queryClient.clear()
```

### Cache Invalidation Strategy

**When to invalidate:**

- After successful mutation (let React Query refetch)
- On real-time events (Supabase subscription)
- On auth state change (login/logout)

**When NOT to invalidate:**

- During optimistic updates (use `setQueryData` instead)
- On error (rollback via context)

## Performance Optimization

### Initial Data from List

Detail queries try to get initial data from list cache:

```typescript
useQuery({
  queryKey: characterKeys.detail(id),
  queryFn: () => getCharacter(id),
  initialData: () => {
    const listsCache = queryClient.getQueriesData({
      queryKey: characterKeys.lists(),
    })
    for (const [, characters] of listsCache) {
      const character = characters?.find((c) => c.id === id)
      if (character) return character
    }
  },
})
```

This avoids network request if data already in cache.

### Stale Time Tuning

Different data types have different stale times:

- **Characters**: 2-5 minutes (rarely change)
- **Messages**: 30 seconds (change frequently)
- **Credits**: 30 seconds (change frequently)
- **Profile**: 5 minutes (rarely change)

Adjust based on real-world usage patterns.

## Testing Offline Mode

### Simulate Offline

**Chrome DevTools:**

1. Open DevTools → Network tab
2. Select "Offline" from throttling dropdown

**React Native:**

```typescript
import NetInfo from '@react-native-community/netinfo'

// Simulate offline
NetInfo.fetch().then((state) => {
  console.log('Network:', state.isConnected)
})
```

### Test Checklist

- [ ] View cached characters while offline
- [ ] Create character offline (appears immediately)
- [ ] Go online (character syncs to server)
- [ ] Delete character offline (removed immediately)
- [ ] Send message offline (queued with pending indicator)
- [ ] Network reconnect (queued message sent)
- [ ] Error handling (mutation fails, rollback occurs)
- [ ] Real-time sync (change on another device appears)

## Troubleshooting

**Cache not updating:**

- Check query keys match (use key factories)
- Verify `invalidateQueries` called after mutation
- Ensure real-time subscription is set up

**Optimistic update not rolling back:**

- Check `onError` receives context from `onMutate`
- Verify `previousState` is saved correctly

**Mutations not queuing offline:**

- Check `networkMode: 'offlineFirst'` in mutation options
- Verify React Query version supports offline mode

**Real-time not working:**

- Check Supabase channel subscription is active
- Verify RLS policies allow realtime events
- Ensure cleanup function removes channel

## Best Practices

1. **Always use query key factories** - Prevents typos and ensures consistency
2. **Include optimistic updates** - Instant UI feedback improves UX
3. **Handle error states** - Show user what went wrong
4. **Set appropriate stale times** - Balance freshness vs. cache hits
5. **Clean up subscriptions** - Return cleanup function from useEffect
6. **Test offline behavior** - Verify queuing and sync work correctly
7. **Use initialData** - Avoid redundant network requests
8. **Log cache operations** - Console.log helps debug cache issues

## Future Enhancements

- **Persistence**: Add `persistQueryClient` with AsyncStorage for true offline-first
- **Conflict Resolution**: Handle optimistic update conflicts when offline mutation fails
- **Prefetching**: Prefetch related data (e.g., character details when viewing list)
- **Pagination**: Add infinite query for large message lists
- **Background Sync**: Use background tasks to sync while app is closed
- **Cache Size Management**: Implement LRU eviction for large caches

## Related Documentation

- `docs/CHARACTERS.md` - Character data model and queries
- `docs/SUPABASE_AUTH.md` - Authentication and RLS policies
- `docs/NAVIGATION.md` - App navigation and routing
- [React Query Docs](https://tanstack.com/query/latest/docs/react/overview)
- [Offline Mutations](https://tanstack.com/query/latest/docs/react/guides/mutations#persisting-offline-mutations)
