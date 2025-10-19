# Navigation

This document captures the current navigation structure for Clanker using [Expo Router](https://docs.expo.dev/router/). It reflects the refactored drawer + tabs architecture that ships with the latest app layout.

## High-Level Flow

1. `app/_layout.tsx` sets up the global providers and wraps navigation with `Stack`.
2. `Stack.Protected` gates the authenticated drawer (`/(drawer)`) behind the Firebase user from `useAuth()`.
3. When a signed-in user still needs to accept terms, `app/(drawer)/_layout.tsx` routes them to `/accept-terms` before exposing the drawer content.
4. The drawer hosts bottom tabs plus profile, settings, and subscription flows.

## Root Layout (`app/_layout.tsx`)

- Renders the React Query, Theme, Auth, and Subscription providers.
- Uses `Stack` with two `Stack.Protected` wrappers:
  - `guard={!!user}` exposes the `(drawer)` group when a Firebase user exists.
  - `guard={!user}` exposes the `sign-in` route for logged-out users.
- `privacy` and `terms` modals remain globally accessible regardless of auth state.
- There is no root `index.tsx`; navigation starts from the drawer once the guard passes.

## Drawer Layout (`app/(drawer)/_layout.tsx`)

- Hosts the main drawer navigator.
- Checks `useSubscriptionStatus()` on mount. When `needsTermsAcceptance` is true (and loading finished) it redirects to `/accept-terms` with `router.replace`.
- Drawer items:
  - `(tabs)` — entry point to the bottom tab navigator (labeled “Chats”).
  - `profile` — user profile screen.
  - `settings` — preferences and configuration screen.
  - `subscribe` — subscription management modal.
  - `accept-terms` — hidden from the drawer list but routable for direct access.

## Tabs Layout (`app/(drawer)/(tabs)/_layout.tsx`)

- Defines a two-tab bottom navigator.
- `index` — chats overview (list of characters with last message preview and link to `/characters/[id]/chat`).
- `characters` — entry to the character management stack.
- Headers are suppressed at the tab level; child stacks control their own headers as needed.

## Characters Stack (`app/(drawer)/(tabs)/characters`)

```
characters/
├── _layout.tsx       # Stack wrapper (header hidden, initial route = index)
├── index.tsx         # Character list + create flow
└── [id]/             # Nested group per character
    ├── chat.tsx      # Conversation UI for the selected character
    └── edit.tsx      # Character editor
```

- The stack exposes both edit and chat screens so deep links such as `/characters/123/chat` work naturally.
- `createNewCharacter` uses `router.push('/characters/{id}')` after creation to land in the character editor by default.

## File Structure Snapshot

```plaintext
app/
├── _layout.tsx              # Root providers + Stack.Protected guards
├── privacy.tsx              # Modal: Privacy policy
├── sign-in.tsx              # Public sign-in screen
├── terms.tsx                # Modal: Terms of service
└── (drawer)/
    ├── _layout.tsx          # Drawer navigator + terms redirect
    ├── accept-terms.tsx     # Modal: Terms acceptance flow
    ├── profile.tsx          # Drawer screen: Profile
    ├── settings.tsx         # Drawer screen: Settings
    ├── subscribe.tsx        # Drawer screen: Subscription/credits
    └── (tabs)/
        ├── _layout.tsx      # Bottom tab navigator
        ├── index.tsx        # Chats tab
        └── characters/
            ├── _layout.tsx  # Characters stack
            ├── index.tsx    # Character list & create FAB
            └── [id]/
                ├── chat.tsx # Character chat screen
                └── edit.tsx # Character edit screen
```

## Auth & Terms Flow

1. **User opens the app** — providers initialise in `RootLayout`.
2. **Firebase user exists?**
   - Yes → `(drawer)` routes become available.
   - No → `sign-in` is the only protected route that renders.
3. **Inside the drawer layout** we evaluate `useSubscriptionStatus()`:
   - `needsTermsAcceptance` → redirect to `/accept-terms` (modal lives in `app/(drawer)/accept-terms.tsx`).
   - otherwise render the drawer + tabs normally.
4. **Acceptance modal** is optimistic: the UI proceeds immediately while Supabase claims update in the background.

## Deep Linking Reference

- `/sign-in`
- `/privacy`
- `/terms`
- `/characters` (list)
- `/characters/<id>/edit`
- `/characters/<id>/chat`
- `/subscribe`
- `/accept-terms`

Expo Router automatically infers additional routes when nested groups are used.

## Best Practices

- Use `router.replace` for modal redirects (`accept-terms`) so the back stack stays clean.
- Keep auth logic centralised in `useAuth` and avoid duplicate Firebase checks in screens; rely on the provider state injected at the root.
- Reserve new `.web.ts` / `.native.ts` files for true platform differences. Navigation files stay platform-agnostic.
- Regenerate Expo Router types after structural changes with `npx expo start --clear`.
- When adding new drawer or tab screens, update the drawer options to include icons from `react-native-paper` for consistent theming.

## Troubleshooting Notes

- **Stuck on accept-terms:** Ensure Supabase JWT claims are refreshing; the optimistic modal depends on the background call to `grantAppAccess`.
- **Drawer not appearing:** Confirm the Firebase user is available in `useAuth()` and that `Stack.Protected`'s guard resolves to `true`.
- **Route type errors:** Clear the Expo Router cache so the generated type definitions match the updated file tree.

## References

- [Expo Router Basics](https://docs.expo.dev/router/)
- [Protected Routes](https://docs.expo.dev/router/advanced/authentication/)
- [Drawer Navigation](https://docs.expo.dev/router/advanced/drawer/)
- [Nested Routes & Groups](https://docs.expo.dev/router/advanced/nesting/)
