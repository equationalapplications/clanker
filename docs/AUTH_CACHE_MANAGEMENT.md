# Authentication and Cache Management

## Auth Flow with React Query Cache

The authentication system now includes proper React Query cache management to ensure no stale data persists after sign out.

### Sign Out Flow

When a user signs out, the following happens in order:

1. **Supabase Sign Out** - Clear Supabase session
2. **Firebase Sign Out** - Clear Firebase auth state
3. **React Query Cache Clear** - Clear all cached data
4. **Auth Manager Reset** - Reset internal auth state

```typescript
const signOut = async () => {
  console.log('🧹 Signing out from Supabase...')
  await supabaseClient.auth.signOut()

  console.log('🔥 Signing out from Firebase...')
  await auth.signOut()
  setUser(null)

  console.log('🗑️ Clearing React Query cache...')
  queryClient.clear() // <-- Critical for offline support

  console.log('🔄 Resetting auth manager...')
  authManager.reset()
}
```

### Why Clear Cache on Sign Out?

With offline support, the app caches user-specific data (characters, messages, profile) for up to 30 minutes. Without clearing the cache on sign out:

1. **Privacy Risk**: Next user could see previous user's cached data
2. **Data Corruption**: Cached data could be associated with wrong user
3. **Stale Sessions**: Old Supabase tokens could remain in cache

The `queryClient.clear()` call ensures:

- All cached queries are removed
- All pending mutations are cancelled
- No stale data persists between sessions

## Navigation Structure

The app uses nested route groups for organization:

```
app/
  _layout.tsx              # Root: Auth protection
  (app)/
    _layout.tsx            # App wrapper: Terms check, Stack navigator
    (drawer)/
      _layout.tsx          # Drawer navigator (Home, Profile, Settings)
      (tabs)/
        _layout.tsx        # Bottom tabs (Chats, Characters)
        chats.tsx
        characters/
          _layout.tsx      # Character stack
          index.tsx        # Character list
          [id].tsx         # Character detail
      profile/
        index.tsx          # Profile screen
      settings/
        index.tsx          # Settings screen
```

### Layout Hierarchy

1. **Root Layout** (`app/_layout.tsx`)
   - Wraps everything in QueryClientProvider
   - Handles auth protection with Stack.Protected
   - Shows public routes when not authenticated

2. **App Layout** (`app/(app)/_layout.tsx`)
   - Checks for terms acceptance
   - Redirects to accept-terms modal if needed
   - Renders Stack with drawer content

3. **Drawer Layout** (`app/(app)/(drawer)/_layout.tsx`)
   - Configures drawer navigation
   - Maps routes to drawer items
   - Provides Home, Profile, Settings navigation

4. **Tabs Layout** (`app/(app)/(drawer)/(tabs)/_layout.tsx`)
   - Configures bottom tabs
   - Provides Chats and Characters navigation

### Route Groups Explained

**Groups with parentheses** like `(app)`, `(drawer)`, `(tabs)` don't add URL segments:

- `(app)` - Logical grouping for authenticated screens
- `(drawer)` - Contains screens accessible via drawer
- `(tabs)` - Contains screens accessible via bottom tabs

**Result**: URLs are clean:

- `/` - Landing/index
- `/characters` - Character list
- `/characters/123` - Character detail
- `/profile` - Profile
- `/settings` - Settings

### Common Navigation Patterns

**Navigate to drawer item:**

```typescript
import { router } from 'expo-router'

// Navigate to profile
router.push('/(app)/(drawer)/profile')

// Or use the simpler path
router.push('/profile')
```

**Open drawer:**

```typescript
import { useNavigation } from '@react-navigation/native'
import { DrawerNavigationProp } from '@react-navigation/drawer'

const navigation = useNavigation<DrawerNavigationProp<any>>()
navigation.openDrawer()
```

**Navigate with params:**

```typescript
router.push({
  pathname: '/characters/[id]',
  params: { id: characterId },
})
```

## Cache Invalidation on Navigation

When navigating between screens, React Query automatically:

1. **Serves cached data immediately** - No loading spinner on back navigation
2. **Refetches in background** - Updates stale data without blocking UI
3. **Invalidates on mutations** - Character updates trigger list refetch

Example: User flow with caching:

1. View character list (fetches from server, caches for 2 min)
2. Tap character (uses cached data from list, fetches detail in background)
3. Edit character (optimistic update, cache invalidation)
4. Back to list (shows updated character from cache, no loading)

## Testing Cache Clearing

### Manual Test

1. Sign in as User A
2. Create characters
3. Navigate through app (populate cache)
4. Sign out
5. Sign in as User B
6. Verify no User A data is visible

### Expected Behavior

- User B should **not** see User A's characters in list
- User B should **not** see User A's messages
- User B should **not** see User A's profile data
- Cache should be completely empty after sign out

### Debugging Cache Issues

If you suspect cache is not clearing:

```typescript
// Check cache contents
import { queryClient } from '~/config/queryClient'

console.log(
  'Cache keys:',
  queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey),
)

// Manually clear if needed (should not be necessary)
queryClient.clear()
```

## Related Documentation

- `docs/OFFLINE_SUPPORT.md` - Complete offline guide
- `docs/NAVIGATION.md` - Navigation architecture details
- `docs/AUTH_FLOW.md` - Authentication flow
- `docs/SUPABASE_AUTH.md` - Multi-tenant auth system
