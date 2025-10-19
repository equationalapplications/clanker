# Firebase Platform-Specific Configuration

## Overview

Firebase is configured with **platform-specific implementations** that expose a small, shared helper API. Metro resolves `index.web.ts` or `index.native.ts` automatically, so application code imports from `~/config/firebaseConfig` without caring which SDK (Firebase Web vs React Native Firebase) is in use.

## File Structure

```
src/config/firebaseConfig/
├── index.web.ts      # Web: Firebase Web SDK
└── index.native.ts   # Native: React Native Firebase
```

## Exported API

Both implementations export the same helpers:

```typescript
import {
  firebaseApp,
  getCurrentUser,
  onAuthStateChanged,
  signOut,
  functions,
  exchangeToken,
  getCallable,
} from '~/config/firebaseConfig'
```

- `firebaseApp` — the underlying Firebase app instance for the active platform
- `getCurrentUser()` — returns the current Firebase user (or `null`)
- `onAuthStateChanged(listener)` — subscribes to auth changes, returns the unsubscribe function
- `signOut()` — signs out the active Firebase user
- `functions` — callable cloud functions instance (exposed for advanced use cases)
- `getCallable(name)` — returns a typed `httpsCallable` wrapper for the supplied function name
- `exchangeToken` — pre-bound callable that wraps the `exchangeToken` HTTPS function (used to mint Supabase JWTs)

> ℹ️ Application code should prefer the `useAuth` hook for user state. The helpers above exist for utilities and services that cannot use React hooks but still need access to Firebase primitives.

## Usage Examples

### Subscribe to Auth Changes
```typescript
import { onAuthStateChanged } from '~/config/firebaseConfig'

useEffect(() => {
  const unsubscribe = onAuthStateChanged((firebaseUser) => {
    if (firebaseUser) {
      console.log('Signed in:', firebaseUser.email)
    } else {
      console.log('Signed out')
    }
  })

  return unsubscribe
}, [])
```

### Access the Current User in a Utility
```typescript
import { getCurrentUser } from '~/config/firebaseConfig'

const currentUser = getCurrentUser()
if (!currentUser) {
  throw new Error('No authenticated user')
}

console.log('UID:', currentUser.uid)
```

### Call Firebase Functions
```typescript
import { getCallable } from '~/config/firebaseConfig'

const generateReply = getCallable('generateReply')
const { data } = await generateReply({ text, characterId })
```

### Exchange Firebase Session for Supabase Session
```typescript
import { exchangeToken } from '~/config/firebaseConfig'

const { data } = await exchangeToken({ appName: 'yours-brightly' })
```

### Sign Out Anywhere in the App
```typescript
import { signOut } from '~/config/firebaseConfig'

await signOut()
```

## Platform-Specific Notes

- **Web (`index.web.ts`)** uses the Firebase Web SDK. It memoises the initialized app, auth, and functions clients, exporting lightweight wrappers around them.
- **Native (`index.native.ts`)** uses the React Native Firebase modules. It mirrors the same helper surface area so shared code can remain platform-agnostic.
- `exchangeToken` is exported directly so the Supabase authentication flow does not need its own platform-specific entrypoints.

## Best Practices

1. **Reach for `useAuth` first.** Components should rely on context-provided state instead of calling Firebase helpers directly.
2. **Keep services framework-agnostic.** Utilities that cannot use hooks should call `getCurrentUser()` and handle the `null` case explicitly.
3. **Avoid duplicating `.web` / `.native` files.** When a difference is limited to Firebase APIs, add the logic here instead of forking consumers.
4. **Revalidate Supabase after auth changes.** `AuthProvider` handles this automatically by invoking `exchangeToken`. Other modules should not attempt to call the function directly unless they manage Supabase sessions intentionally.

## Files Depending on These Helpers

- `src/auth/useAuth.tsx`
- `src/auth/getSupabaseUserSession.ts`
- `src/utilities/createNewCharacter.ts`
- `src/utilities/updateCharacter.ts`
- `src/utilities/getUserCredits.ts`
- `src/utilities/getIsPremium.ts`
- `src/utilities/postStripeReceipt.ts`
- `src/components/AcceptTerms.tsx`
- `src/components/CustomFallback.tsx`
- `src/utilities/generateReply.ts`
- `src/utilities/makePackagePurchase.ts`

## Testing

```bash
# Test native (iOS/Android)
npm run start

# Test web
npm run web
```

Verify auth flows on both platforms: sign in, accept terms, sign out, and confirm Supabase session refresh succeeds through `exchangeToken`.
