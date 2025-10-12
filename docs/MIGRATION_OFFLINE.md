# Migration Guide: Adding Offline Support

This guide helps you migrate existing code to use the new React Query hooks with offline support.

## Quick Reference

| Old Hook             | New Hook               | Location                |
| -------------------- | ---------------------- | ----------------------- |
| `useCharacterList()` | `useCharacters()`      | `~/hooks/useCharacters` |
| `useCharacter()`     | `useCharacter()`       | `~/hooks/useCharacters` |
| `useChatMessages()`  | `useMessages()`        | `~/hooks/useMessages`   |
| `useUserPublic()`    | `useUserPublicData()`  | `~/hooks/useUser`       |
| `useUserPrivate()`   | `useUserPrivateData()` | `~/hooks/useUser`       |

## Migration Patterns

### Pattern 1: Character List

**Before:**

```typescript
import { useCharacterList } from '~/hooks/useCharacterList'

function CharactersList() {
  const characters = useCharacterList()

  if (!characters.length) return <Text>No characters</Text>

  return (
    <>
      {characters.map((char) => (
        <CharacterCard key={char.id} character={char} />
      ))}
    </>
  )
}
```

**After (Recommended):**

```typescript
import { useCharacters } from '~/hooks/useCharacters'

function CharactersList() {
  const { characters, isLoading, error, refetch } = useCharacters()

  if (isLoading) return <LoadingIndicator />
  if (error) return <ErrorView error={error} onRetry={refetch} />
  if (!characters.length) return <EmptyState />

  return (
    <>
      {characters.map((char) => (
        <CharacterCard key={char.id} character={char} />
      ))}
    </>
  )
}
```

**Benefits:**

- Loading states for better UX
- Error handling with retry
- Automatic caching
- Offline support

### Pattern 2: Character Detail

**Before:**

```typescript
import { useCharacter } from '~/hooks/useCharacter'

function CharacterDetail({ id }: { id: string }) {
  const character = useCharacter({ id })

  if (!character) return <Text>Loading...</Text>

  return <CharacterView character={character} />
}
```

**After (Recommended):**

```typescript
import { useCharacter } from '~/hooks/useCharacters'

function CharacterDetail({ id }: { id: string }) {
  const { character, isLoading, error } = useCharacter(id)

  if (isLoading) return <LoadingIndicator />
  if (error) return <ErrorView error={error} />
  if (!character) return <Text>Character not found</Text>

  return <CharacterView character={character} />
}
```

### Pattern 3: Creating Characters

**Before:**

```typescript
import { createCharacter } from '~/services/characterService'

async function handleCreate() {
  setLoading(true)
  try {
    const newChar = await createCharacter({
      name: 'New Character',
      appearance: '...',
      // ...
    })
    // Manually trigger refetch or update state
    setLoading(false)
  } catch (error) {
    setError(error)
    setLoading(false)
  }
}
```

**After (Recommended):**

```typescript
import { useCreateCharacter } from '~/hooks/useCharacters'

function CreateCharacterButton() {
  const createCharacter = useCreateCharacter()

  async function handleCreate() {
    await createCharacter.mutateAsync({
      name: 'New Character',
      appearance: '...',
      // ...
    })
    // No need to manually update - optimistic update + cache invalidation
  }

  return (
    <Button
      onPress={handleCreate}
      disabled={createCharacter.isPending}
    >
      {createCharacter.isPending ? 'Creating...' : 'Create Character'}
    </Button>
  )
}
```

**Benefits:**

- Optimistic update (appears immediately)
- Automatic cache update
- Error rollback
- Loading state built-in

### Pattern 4: Updating Characters

**Before:**

```typescript
import { updateCharacter } from '~/services/characterService'

async function handleUpdate(id: string, updates: any) {
  setLoading(true)
  try {
    await updateCharacter(id, updates)
    // Manually refetch
    setLoading(false)
  } catch (error) {
    setError(error)
    setLoading(false)
  }
}
```

**After (Recommended):**

```typescript
import { useUpdateCharacter } from '~/hooks/useCharacters'

function EditCharacterForm({ characterId }: { characterId: string }) {
  const updateCharacter = useUpdateCharacter()

  async function handleUpdate(updates: any) {
    await updateCharacter.mutateAsync({ id: characterId, updates })
    // Cache updated automatically with optimistic update
  }

  return (
    <Form onSubmit={handleUpdate} disabled={updateCharacter.isPending} />
  )
}
```

### Pattern 5: Sending Messages

**Before:**

```typescript
import { sendMessage } from '~/services/messageService'

async function handleSend(message: IMessage) {
  try {
    await sendMessage(characterId, recipientUserId, message)
    // Manually update messages list
  } catch (error) {
    console.error(error)
  }
}
```

**After (Recommended):**

```typescript
import { useSendMessage } from '~/hooks/useMessages'

function ChatScreen({ characterId, recipientUserId }) {
  const sendMessage = useSendMessage(characterId, recipientUserId)

  async function handleSend(messages: IMessage[]) {
    const message = messages[0]
    await sendMessage.mutateAsync(message)
    // Message appears immediately with pending indicator
    // When online, syncs to server and removes indicator
  }

  return (
    <GiftedChat
      onSend={handleSend}
      // ... other props
    />
  )
}
```

### Pattern 6: User Profile Updates

**Before:**

```typescript
import { upsertUserProfile } from '~/services/userService'

async function handleSave(updates: any) {
  setLoading(true)
  try {
    await upsertUserProfile(updates)
    // Manually refetch profile
  } catch (error) {
    setError(error)
  } finally {
    setLoading(false)
  }
}
```

**After (Recommended):**

```typescript
import { useUpdateProfile } from '~/hooks/useUser'

function ProfileEditor() {
  const updateProfile = useUpdateProfile()

  async function handleSave(updates: any) {
    await updateProfile.mutateAsync(updates)
    // Profile updated with optimistic update
    // No need to refetch
  }

  if (updateProfile.isError) {
    return <ErrorBanner error={updateProfile.error} />
  }

  return (
    <Form
      onSubmit={handleSave}
      disabled={updateProfile.isPending}
    />
  )
}
```

## Common Migration Scenarios

### Scenario 1: Loading States

**Before:**

```typescript
const [isLoading, setIsLoading] = useState(false)
const [data, setData] = useState(null)

useEffect(() => {
  setIsLoading(true)
  fetchData().then(setData).finally(() => setIsLoading(false))
}, [])

if (isLoading) return <Loading />
```

**After:**

```typescript
const { data, isLoading } = useQuery({ ... })

if (isLoading) return <Loading />
```

### Scenario 2: Error Handling

**Before:**

```typescript
const [error, setError] = useState(null)

try {
  await mutateData()
} catch (err) {
  setError(err)
}

if (error) return <ErrorView error={error} />
```

**After:**

```typescript
const mutation = useMutation({ ... })

if (mutation.isError) {
  return <ErrorView error={mutation.error} onRetry={mutation.reset} />
}
```

### Scenario 3: Refetching

**Before:**

```typescript
const [refreshing, setRefreshing] = useState(false)

async function onRefresh() {
  setRefreshing(true)
  await fetchData()
  setRefreshing(false)
}

<FlatList
  data={data}
  onRefresh={onRefresh}
  refreshing={refreshing}
/>
```

**After:**

```typescript
const { data, refetch, isRefetching } = useQuery({ ... })

<FlatList
  data={data}
  onRefresh={refetch}
  refreshing={isRefetching}
/>
```

## Breaking Changes

### None!

All legacy hooks still work. They internally delegate to new React Query hooks.

**Migration is opt-in:**

- Old code continues working
- New code can use new hooks
- Migrate gradually as needed

## Performance Improvements

After migration, you should see:

- **Reduced re-renders**: React Query batches updates
- **Fewer network requests**: Aggressive caching
- **Faster navigation**: Data cached from previous screens
- **Better offline UX**: Serve stale data when offline
- **Instant mutations**: Optimistic updates

## Testing Your Migration

### Test Checklist

- [ ] **Online mode**: Data loads and updates correctly
- [ ] **Offline mode**: Cached data visible, mutations queued
- [ ] **Reconnect**: Queued mutations sent, cache refreshed
- [ ] **Optimistic updates**: Changes appear immediately
- [ ] **Error handling**: Errors shown, rollback works
- [ ] **Real-time sync**: Changes from other devices appear
- [ ] **Loading states**: Spinners show during first load
- [ ] **Refetching**: Pull-to-refresh works

### Debug Tips

**Enable query dev tools** (development only):

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

// In app/_layout.tsx
<QueryClientProvider client={queryClient}>
  {children}
  {__DEV__ && <ReactQueryDevtools initialIsOpen={false} />}
</QueryClientProvider>
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

1. **Revert queryClient config** to basic version
2. **Keep legacy hooks** unchanged
3. **Remove new hook imports** from migrated components

No database changes needed - everything is client-side.

## Getting Help

If you encounter issues:

1. Check `docs/OFFLINE_SUPPORT.md` for patterns
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

See `docs/OFFLINE_SUPPORT.md` for advanced patterns.
