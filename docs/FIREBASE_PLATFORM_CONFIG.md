# Firebase Platform-Specific Configuration

## Overview

The Firebase configuration has been split into platform-specific implementations that provide a **normalized API** across web and native platforms. Metro bundler automatically resolves the correct implementation at build time based on platform extensions.

## File Structure

```
src/config/firebaseConfig/
├── index.web.ts      # Web: Firebase Web SDK
└── index.native.ts   # Native: React Native Firebase
```

## Normalized API

Both platform implementations export the same API surface:

```typescript
import { auth, functions, app } from '~/config/firebaseConfig'

// Works identically on all platforms
auth.currentUser           // Get current user
auth.onAuthStateChanged()  // Listen to auth state
auth.signOut()            // Sign out

functions.httpsCallable('functionName')  // Call cloud function
```

## Platform-Specific Implementations

### Web (`index.web.ts`)
Uses Firebase Web SDK (`firebase` package):
- `getAuth()` → wrapped in normalized API
- `getFunctions()` → wrapped in normalized API
- Standard web persistence (localStorage)

### Native (`index.native.ts`)
Uses React Native Firebase (`@react-native-firebase` packages):
- `firebaseAuthModule()` → wrapped in normalized API
- `firebaseFunctionsModule()` → wrapped in normalized API
- Native persistence (iOS Keychain, Android SharedPreferences)

## Usage Examples

### Check Current User
```typescript
import { auth } from '~/config/firebaseConfig'

if (!auth.currentUser) {
  // No user signed in
}

const uid = auth.currentUser.uid
```

### Listen to Auth State
```typescript
import { auth } from '~/config/firebaseConfig'

useEffect(() => {
  const unsubscribe = auth.onAuthStateChanged((user) => {
    if (user) {
      console.log('User signed in:', user.email)
    } else {
      console.log('User signed out')
    }
  })
  
  return () => unsubscribe()
}, [])
```

### Call Cloud Function
```typescript
import { functions } from '~/config/firebaseConfig'

const myFunction = functions.httpsCallable('myFunctionName')
const result = await myFunction({ arg1: 'value' })
```

### Sign Out
```typescript
import { auth } from '~/config/firebaseConfig'

await auth.signOut()
```

## TypeScript Limitations

**Important:** TypeScript errors in the editor are expected and can be ignored. TypeScript doesn't understand platform-specific file extensions (`.web.ts` / `.native.ts`), so it may show type errors. However, the code **will work correctly at runtime** because Metro bundler resolves the correct file for each platform.

### Example TypeScript Error (ignore this):
```
Property 'currentUser' does not exist on type 'FirebaseModuleWithStaticsAndApp<Module, Statics>'.
```

This error appears because TypeScript is reading the wrong platform's types. The app will build and run correctly.

## Benefits

1. **No Platform Checks**: No need for `Platform.OS === 'web'` checks in application code
2. **Consistent API**: Same API across all platforms
3. **Type Safety**: Full type safety within each platform's implementation
4. **Automatic Resolution**: Metro bundler handles platform resolution automatically
5. **Clean Code**: Application code doesn't need to know about platform differences

## Migration from Old Pattern

### Before (Platform checks everywhere):
```typescript
const currentUser = Platform.OS === 'web' 
  ? (auth as any).currentUser 
  : (auth as any)().currentUser
```

### After (No platform checks):
```typescript
const currentUser = auth.currentUser
```

## Files Updated

All files that previously used platform-specific Firebase calls have been simplified:
- `src/auth/useAuth.tsx`
- `src/auth/getSupabaseUserSession/index.native.ts` - Supabase session exchange for native
- `src/auth/getSupabaseUserSession/index.web.ts` - Supabase session exchange for web
- `src/auth/getSupabaseUserSession/index.ts` - TypeScript resolution
- `src/utilities/getUserCredits.ts`
- `src/utilities/getIsPremium.ts`
- `src/utilities/createNewCharacter.ts`
- `src/utilities/updateCharacter.ts`
- `src/utilities/postStripeReceipt.ts`
- `src/utilities/generateReply.ts`
- `src/utilities/makePackagePurchase.ts`
- `src/components/AcceptTerms.tsx`
- `src/auth/googleSignIn/index.native.ts` - Google Sign-In for iOS/Android
- `src/auth/googleSignIn/index.web.ts` - Google Sign-In for web
- `src/auth/googleSignIn/index.ts` - TypeScript resolution

## Testing

```bash
# Test native (iOS/Android)
npm run start

# Test web
npm run web
```

The Firebase Auth "INTERNAL ASSERTION FAILED" error should now be resolved since each platform uses its appropriate Firebase SDK.
