# Navigation

This document describes the navigation structure of the Yours Brightly AI app, following [Expo Router's common navigation patterns](https://docs.expo.dev/router/basics/common-navigation-patterns/).

## Navigation Architecture

### 🔒 Root Layout (`app/_layout.tsx`)
**This is where ALL authentication logic happens** - the single source of truth for auth state.

- Uses `Stack.Protected` with `guard={isLoggedIn}` to control access
- Protected routes (only accessible when logged in):
  - `(app)` - Main app with drawer/tabs
  - `subscribe` - Subscription modal
  - `accept-terms` - Terms acceptance modal (requires auth to accept)
- Public routes (only accessible when logged out):
  - `sign-in` - Sign in screen
- Always available:
  - `privacy` - Privacy policy
  - `terms` - Terms of service
  - `index` - Root redirect (tries to go to app, guard handles auth)

**Important:** The loading state while checking auth is handled in `RootLayoutNav`. The `index.tsx` does NOT duplicate auth checks - it simply redirects to the app, and `Stack.Protected` handles whether that's allowed.

### 📋 Terms Acceptance Check (`app/(app)/_layout.tsx`)
**This is the ONLY place where terms acceptance is checked** - happens AFTER authentication.

- Uses `useSubscriptionStatus()` to check if user needs to accept terms
- If terms not accepted, redirects to `/accept-terms` modal
- **Uses optimistic UI**: When user accepts terms, they proceed immediately without waiting for JWT refresh
- Database write happens asynchronously in the background
- Next natural JWT refresh will include the updated subscription claims
- This ensures terms are only checked for authenticated users inside protected routes

**Why Optimistic?** Terms acceptance is a legal checkbox, not a security boundary. We trust the client-side click and verify server-side when needed (RLS policies, API calls). This provides:
- ✅ Instant navigation (better UX)
- ✅ Offline support (sync later)
- ✅ Industry-standard pattern
- ✅ Server-side enforcement where it matters

### 📱 Main App Structure

#### Drawer Navigator (`app/(app)/_layout.tsx`)
Primary navigation for the authenticated app:
- **Home** - Bottom tab navigator (Chats & Characters)
- **Settings** - App settings
- **Profile** - User profile

#### Bottom Tab Navigator (`app/(app)/(tabs)/_layout.tsx`)
Main task-based navigation:
- **Chats** - Conversation list and chat interface
- **Characters** - Character management with nested stack

#### Stack Navigator (`app/(app)/(tabs)/characters/_layout.tsx`)
Nested stack for character-related screens:
- **Characters List** (`index.tsx`) - Browse and create characters
- **Character Details** (`[id].tsx`) - Unified screen for viewing, editing, and chatting with a character

## File Structure

## File Structure

```plaintext
app/
├── _layout.tsx                    # Root layout with auth protection
├── index.tsx                      # Landing/redirect page (auth-based)
├── sign-in.tsx                    # Authentication screen
├── accept-terms.tsx               # Terms acceptance modal
├── subscribe.tsx                  # Subscription modal
├── privacy.tsx                    # Privacy policy
├── terms.tsx                      # Terms of service
└── (app)/                         # Protected routes (requires auth)
    ├── _layout.tsx                # Drawer navigator
    ├── (drawer)/                  # Drawer screens group
    │   ├── profile/
    │   │   └── index.tsx          # Profile screen
    │   └── settings/
    │       └── index.tsx          # Settings screen
    └── (tabs)/                    # Tab navigator group
        ├── _layout.tsx            # Bottom tab configuration
        ├── chats.tsx              # Chats tab screen
        └── characters/            # Characters tab with stack
            ├── _layout.tsx        # Stack navigator for characters
            ├── index.tsx          # Characters list screen
            └── [id].tsx           # Character details (dynamic route)
```

## Navigation Patterns

### Authentication Flow (Step by Step)

1. **User lands at `/` (index.tsx)**
   - `index.tsx` checks auth state using `useAuth()`
   - If `user` exists: redirects to `/(app)/(tabs)/chats`
   - If no `user`: redirects to `/sign-in`
   - This provides immediate feedback while `Stack.Protected` provides the guard

2. **Stack.Protected enforces access control in `_layout.tsx`**
   - Even if someone tries to manually navigate to `(app)` routes
   - `Stack.Protected` checks `isLoggedIn` state
   - If `isLoggedIn === false`: Access denied, redirect to first available route
   - If `isLoggedIn === true`: Access granted, proceed to step 3

3. **Inside `(app)/_layout.tsx` (Protected Route)**
   - NOW checks `useSubscriptionStatus()` for terms acceptance
   - If terms not accepted:
     - Redirects to `/accept-terms` modal
   - If terms accepted:
     - Renders the Drawer navigator with tabs

**Key Principle:** 
- Root `index.tsx` provides immediate routing based on auth
- `Stack.Protected` guards provide defense-in-depth protection
- Auth check happens FIRST at root, terms check happens SECOND inside protected route

### Root Index Behavior
The root `index.tsx` uses a hybrid approach for best UX:
- Checks auth state using `useAuth()`
- Provides immediate redirect based on current auth state
- Authenticated users → `/(app)/(tabs)/chats`
- Unauthenticated users → `/sign-in`
- Works in tandem with `Stack.Protected` guards for defense-in-depth
- Prevents blank screen while auth state loads

### Deep Linking
The app supports deep linking to any screen:
- `/` - Landing page (redirects based on auth)
- `/sign-in` - Sign in screen
- `/characters` - Characters list
- `/characters/123` - Specific character details
- `/chats` - Chats list

### Dynamic Routes
Character details use Expo Router's dynamic route pattern:
- File: `app/(app)/(tabs)/characters/[id].tsx`
- URL: `/characters/123`
- Access param: `const { id } = useLocalSearchParams<{ id: string }>()`

### Protected Routes
Using `Stack.Protected` to control access:
```tsx
<Stack.Protected guard={isLoggedIn}>
  <Stack.Screen name="(app)" options={{ headerShown: false }} />
</Stack.Protected>
```

### Navigation Methods
```tsx
// Navigate to character details
router.push(`/characters/${characterId}`)

// Go back
router.back()

// Replace current route
router.replace('/sign-in')
```

## Best Practices

1. **Stack in Tabs**: Characters tab uses a nested stack for multi-screen navigation while keeping tabs visible
2. **Initial Route**: Stack navigator sets `initialRouteName: 'index'` to ensure proper default routing
3. **Clean URLs**: Dynamic routes create semantic URLs (`/characters/123` instead of `/characters/details/123`)
4. **Type Safety**: Expo Router generates TypeScript types for all routes (run `npx expo start --clear` to regenerate)
5. **Explicit Redirects**: Root index handles auth-based redirects explicitly rather than relying solely on `Stack.Protected`

## Troubleshooting

### Blank Screen on Web
If you see a blank screen at the root URL:
- Ensure `app/index.tsx` has explicit redirect logic
- Check that `useAuth()` is returning auth state correctly
- Clear cache with `npx expo start --clear`

### Reanimated Issues
For drawer/animation issues:
- Ensure `react-native-reanimated/plugin` is in `babel.config.js` (must be last)
- Web uses CSS animations (native driver warning is expected and harmless)
- Run `npx expo start --clear` after babel config changes

### Type Errors
If navigation routes show TypeScript errors:
- Run `npx expo start --clear` to regenerate typed routes
- Ensure all routes have proper file structure
- Check that dynamic routes use the `[param]` pattern

## References

- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)
- [Common Navigation Patterns](https://docs.expo.dev/router/basics/common-navigation-patterns/)
- [Protected Routes](https://docs.expo.dev/router/advanced/authentication/)
- [Dynamic Routes](https://docs.expo.dev/router/advanced/dynamic-routes/)
- [Drawer Navigator](https://docs.expo.dev/router/advanced/drawer/)
- [React Native Reanimated](https://docs.expo.dev/versions/latest/sdk/reanimated/)



