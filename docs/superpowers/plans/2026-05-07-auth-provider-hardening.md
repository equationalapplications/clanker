# Auth Provider Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Google and Apple sign-in across web and mobile by converging on the provider-native SDK → ID token (+ nonce) → `signInWithCredential` pattern, and centralize display-name + sign-out cleanup.

**Architecture:** Replace Firebase popup/redirect wrappers on web with direct provider SDK flows (Google Identity Services, Apple JS), each producing an ID token (Apple also passing a SHA256-hashed nonce) consumed by `signInWithCredential`. Mobile flows already follow this shape; the only mobile change is moving display-name persistence into a shared helper. Sign-out gains an explicit RevenueCat logout step, ordered before Firebase sign-out, on every platform.

**Tech Stack:** TypeScript, Firebase Web SDK (`firebase/auth`), React Native Firebase (`@react-native-firebase/auth`), Google Identity Services (web), Apple JS (`appleid.auth.js`), `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `expo-crypto`, Web Crypto API, jest, XState v5.

Spec: `docs/superpowers/specs/2026-05-07-auth-provider-hardening-design.md`

---

## File Structure

**Create:**
- `src/auth/nonce.web.ts` — web variant of `nonce.ts` using Web Crypto API.
- `src/auth/syncDisplayName.ts` — shared helper: `syncDisplayNameFromCredential(user, fallbackName?)`.
- `src/auth/__tests__/nonce.web.test.ts`
- `src/auth/__tests__/syncDisplayName.test.ts`
- `src/auth/__tests__/googleSignin.web.test.ts`
- `src/auth/__tests__/appleSignin.web.test.ts`

**Modify:**
- `src/auth/googleSignin.web.ts` — full rewrite. GIS-only.
- `src/auth/appleSignin.web.ts` — full rewrite. AppleID JS + nonce + `signInWithCredential`.
- `src/auth/googleSignin.ts` — replace inline `updateProfile` with helper call.
- `src/auth/appleSignin.ts` — replace inline `updateProfile` with helper call.
- `src/machines/authMachine.ts:469-483` — reorder sign-out: `logoutRevenueCat` before `firebaseSignOut`; drop web `signOutFromGoogle()` call.
- `app/sign-in.tsx:12, 89-96` — remove `handleAppleRedirectResult` import + mount effect.
- `__tests__/authMachine.test.ts` — update sign-out ordering assertions.

---

## Task 1: Create web nonce helper

**Files:**
- Create: `src/auth/nonce.web.ts`
- Test: `src/auth/__tests__/nonce.web.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/auth/__tests__/nonce.web.test.ts
import { generateNonce, sha256 } from '../nonce.web'

const cryptoMock = {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256
    return arr
  },
  subtle: {
    digest: async (_alg: string, data: ArrayBuffer) => {
      // Deterministic fake digest: 32 bytes equal to length of input
      const out = new Uint8Array(32).fill(data.byteLength % 256)
      return out.buffer
    },
  },
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: cryptoMock, configurable: true })
})

describe('nonce.web', () => {
  it('generateNonce returns a string of the requested length using charset chars', () => {
    const n = generateNonce(32)
    expect(n).toHaveLength(32)
    expect(n).toMatch(/^[A-Za-z0-9]{32}$/)
  })

  it('sha256 returns lowercase hex of length 64', async () => {
    const hex = await sha256('hello')
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/__tests__/nonce.web.test.ts`
Expected: FAIL — module `../nonce.web` not found.

- [ ] **Step 3: Implement `nonce.web.ts`**

```ts
// src/auth/nonce.web.ts
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const generateNonce = (length = 32): string => {
  const charsetLength = CHARSET.length
  const maxUnbiased = Math.floor(256 / charsetLength) * charsetLength

  let result = ''
  while (result.length < length) {
    const remaining = length - result.length
    const buf = new Uint8Array(remaining * 2)
    crypto.getRandomValues(buf)
    for (let i = 0; i < buf.length && result.length < length; i++) {
      const v = buf[i]
      if (v >= maxUnbiased) continue
      result += CHARSET[v % charsetLength]
    }
  }
  return result
}

export const sha256 = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx jest src/auth/__tests__/nonce.web.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/nonce.web.ts src/auth/__tests__/nonce.web.test.ts
git commit -m "feat(auth): add web nonce helper using Web Crypto"
```

---

## Task 2: Create syncDisplayName helper

**Files:**
- Create: `src/auth/syncDisplayName.ts`
- Test: `src/auth/__tests__/syncDisplayName.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/auth/__tests__/syncDisplayName.test.ts
import { syncDisplayNameFromCredential } from '../syncDisplayName'

const makeUser = (overrides: any = {}) => ({
  displayName: null as string | null,
  providerData: [] as Array<{ displayName?: string | null }>,
  updateProfile: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('syncDisplayNameFromCredential', () => {
  it('skips when displayName already set', async () => {
    const user = makeUser({ displayName: 'Existing' })
    await syncDisplayNameFromCredential(user as any, 'Fallback')
    expect(user.updateProfile).not.toHaveBeenCalled()
  })

  it('uses fallbackName when provided and displayName empty', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, 'Jane Doe')
    expect(user.updateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' })
  })

  it('falls back to providerData[0].displayName when no fallback', async () => {
    const user = makeUser({ providerData: [{ displayName: 'From Provider' }] })
    await syncDisplayNameFromCredential(user as any)
    expect(user.updateProfile).toHaveBeenCalledWith({ displayName: 'From Provider' })
  })

  it('skips when no displayName, no fallback, and no providerData name', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any)
    expect(user.updateProfile).not.toHaveBeenCalled()
  })

  it('trims whitespace and treats empty after trim as missing', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, '   ')
    expect(user.updateProfile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/__tests__/syncDisplayName.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `syncDisplayName.ts`**

```ts
// src/auth/syncDisplayName.ts
type UserLike = {
  displayName: string | null
  providerData: Array<{ displayName?: string | null }>
  updateProfile: (profile: { displayName?: string | null; photoURL?: string | null }) => Promise<void>
}

export const syncDisplayNameFromCredential = async (
  user: UserLike,
  fallbackName?: string,
): Promise<void> => {
  const current = user.displayName?.trim()
  if (current) return

  const fallback = fallbackName?.trim()
  const providerName = user.providerData?.[0]?.displayName?.trim() || ''
  const next = fallback || providerName
  if (!next) return

  await user.updateProfile({ displayName: next })
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/auth/__tests__/syncDisplayName.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/syncDisplayName.ts src/auth/__tests__/syncDisplayName.test.ts
git commit -m "feat(auth): add syncDisplayNameFromCredential helper"
```

---

## Task 3: Wire helper into mobile Google sign-in

**Files:**
- Modify: `src/auth/googleSignin.ts:62-70`

- [ ] **Step 1: Replace inline updateProfile with helper call**

Current code (lines 62-70):

```ts
    const givenName = response.data?.user?.givenName?.trim() || ''
    const familyName = response.data?.user?.familyName?.trim() || ''
    const googleDisplayName =
      response.data?.user?.name?.trim() || `${givenName} ${familyName}`.trim()

    // Ensure display name is available for profile rendering and Cloud SQL profile sync.
    if (googleDisplayName && !userCredential.user.displayName) {
      await userCredential.user.updateProfile({ displayName: googleDisplayName })
    }
```

Replace with:

```ts
    const givenName = response.data?.user?.givenName?.trim() || ''
    const familyName = response.data?.user?.familyName?.trim() || ''
    const googleDisplayName =
      response.data?.user?.name?.trim() || `${givenName} ${familyName}`.trim()

    await syncDisplayNameFromCredential(userCredential.user, googleDisplayName)
```

Add import at top of file:

```ts
import { syncDisplayNameFromCredential } from './syncDisplayName'
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Run unit tests**

Run: `npx jest src/auth`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/googleSignin.ts
git commit -m "refactor(auth): use syncDisplayNameFromCredential in mobile Google flow"
```

---

## Task 4: Wire helper into mobile Apple sign-in

**Files:**
- Modify: `src/auth/appleSignin.ts:47-55`

- [ ] **Step 1: Replace inline updateProfile with helper call**

Current code (lines 47-55):

```ts
    const givenName = fullName?.givenName?.trim() || ''
    const familyName = fullName?.familyName?.trim() || ''
    const appleDisplayName = `${givenName} ${familyName}`.trim()

    // Apple only shares full name on first authorization. Persist it to Firebase profile
    // so it is available for downstream profile sync and subsequent logins.
    if (appleDisplayName && !userCredential.user.displayName) {
      await userCredential.user.updateProfile({ displayName: appleDisplayName })
    }
```

Replace with:

```ts
    const givenName = fullName?.givenName?.trim() || ''
    const familyName = fullName?.familyName?.trim() || ''
    const appleDisplayName = `${givenName} ${familyName}`.trim()

    // Apple only shares full name on first authorization. Persist via shared helper.
    await syncDisplayNameFromCredential(userCredential.user, appleDisplayName)
```

Add import at top of file:

```ts
import { syncDisplayNameFromCredential } from './syncDisplayName'
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run unit tests**

Run: `npx jest src/auth`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/appleSignin.ts
git commit -m "refactor(auth): use syncDisplayNameFromCredential in mobile Apple flow"
```

---

## Task 5: Rewrite web Google sign-in (GIS-only)

**Files:**
- Modify: `src/auth/googleSignin.web.ts` (full rewrite)
- Test: `src/auth/__tests__/googleSignin.web.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// src/auth/__tests__/googleSignin.web.test.ts
jest.mock('firebase/auth', () => {
  const signInWithCredential = jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [], updateProfile: jest.fn() },
  })
  const credential = jest.fn((idToken: string) => ({ idToken }))
  return {
    GoogleAuthProvider: { credential },
    getAuth: jest.fn(() => ({})),
    signInWithCredential,
  }
})
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))

import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'

describe('googleSignin.web', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client'
    ;(window as any).google = {
      accounts: {
        id: {
          initialize: jest.fn(({ callback }) => {
            ;(window as any).__gisCallback = callback
          }),
          prompt: jest.fn((listener) => {
            ;(window as any).__gisCallback({ credential: 'fake-id-token' })
            listener?.({ isNotDisplayed: () => false, isSkippedMoment: () => false })
          }),
          renderButton: jest.fn(),
          disableAutoSelect: jest.fn(),
        },
      },
    }
  })

  it('signInWithGoogle exchanges GIS ID token via signInWithCredential', async () => {
    const { signInWithGoogle } = await import('../googleSignin.web')
    const result = await signInWithGoogle()
    expect(result.success).toBe(true)
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('fake-id-token', null)
    expect(signInWithCredential).toHaveBeenCalled()
  })

  it('returns error when client id missing', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    jest.resetModules()
    const { signInWithGoogle } = await import('../googleSignin.web')
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/__tests__/googleSignin.web.test.ts`
Expected: FAIL (existing implementation calls `signInWithPopup`, not the new GIS-only path).

- [ ] **Step 3: Rewrite `googleSignin.web.ts`**

```ts
// src/auth/googleSignin.web.ts
import { GoogleAuthProvider, getAuth, signInWithCredential } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'
import { syncDisplayNameFromCredential } from './syncDisplayName'

declare global {
  interface Window {
    google?: any
  }
}

export interface GoogleSignInResult {
  success: boolean
  error?: string
}

const auth = getAuth(firebaseApp)
let scriptPromise: Promise<void> | null = null

const loadGoogleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.body.appendChild(script)
  })
  return scriptPromise
}

const getClientId = (): string | null => process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || null

export const initializeGoogleSignIn = async (): Promise<void> => {
  const clientId = getClientId()
  if (!clientId) {
    throw new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set')
  }
  await loadGoogleScript()
}

const exchangeCredential = async (idToken: string): Promise<GoogleSignInResult> => {
  try {
    const cred = GoogleAuthProvider.credential(idToken, null)
    const userCredential = await signInWithCredential(auth, cred)
    await syncDisplayNameFromCredential(userCredential.user as any)
    return { success: true }
  } catch (error: any) {
    console.error('Google Sign-In credential exchange failed:', error)
    return { success: false, error: error.message || 'Sign-in failed' }
  }
}

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  const clientId = getClientId()
  if (!clientId) {
    return { success: false, error: 'Google Web Client ID not configured' }
  }

  try {
    await loadGoogleScript()
  } catch (error: any) {
    return { success: false, error: error.message || 'Google Sign-In unavailable' }
  }

  if (!window.google?.accounts?.id) {
    return { success: false, error: 'Google Sign-In unavailable' }
  }

  return new Promise<GoogleSignInResult>((resolve) => {
    let settled = false
    const settle = (r: GoogleSignInResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: any) => {
        if (!response?.credential) {
          settle({ success: false, error: 'No credential received' })
          return
        }
        const exchanged = await exchangeCredential(response.credential)
        settle(exchanged)
      },
    })

    window.google.accounts.id.prompt((notification: any) => {
      if (notification?.isDismissedMoment?.()) {
        if (notification.getDismissedReason?.() === 'credential_returned') {
          return
        }
        settle({ success: false, error: 'Sign-in cancelled' })
        return
      }
      if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
        settle({
          success: false,
          error: 'Google Sign-In unavailable. Try Apple sign-in or email.',
        })
      }
    })
  })
}

export const getCurrentUser = async () => null
```

Note: `signOutFromGoogle` intentionally removed. Task 9 updates the authMachine import.

- [ ] **Step 4: Run test to verify pass**

Run: `npx jest src/auth/__tests__/googleSignin.web.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/googleSignin.web.ts src/auth/__tests__/googleSignin.web.test.ts
git commit -m "feat(auth): rewrite web Google sign-in to GIS-only ID token flow"
```

---

## Task 6: Rewrite web Apple sign-in (AppleID JS + nonce)

**Files:**
- Modify: `src/auth/appleSignin.web.ts` (full rewrite)
- Test: `src/auth/__tests__/appleSignin.web.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// src/auth/__tests__/appleSignin.web.test.ts
jest.mock('firebase/auth', () => {
  const signInWithCredential = jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [], updateProfile: jest.fn() },
  })
  const credential = jest.fn((opts: any) => ({ providerId: 'apple.com', ...opts }))
  class OAuthProvider {
    constructor(public providerId: string) {}
    credential(opts: any) {
      return credential(opts)
    }
  }
  return {
    OAuthProvider,
    getAuth: jest.fn(() => ({})),
    signInWithCredential,
  }
})
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))
jest.mock('../nonce.web', () => ({
  generateNonce: jest.fn(() => 'RAW_NONCE'),
  sha256: jest.fn(async () => 'HASHED_NONCE'),
}))

import { signInWithCredential, OAuthProvider } from 'firebase/auth'
import { generateNonce, sha256 } from '../nonce.web'

describe('appleSignin.web', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = 'com.example.app.web'
    process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI = 'https://example.com/auth/apple'
    ;(window as any).AppleID = {
      auth: {
        init: jest.fn(),
        signIn: jest.fn().mockResolvedValue({
          authorization: { id_token: 'APPLE_ID_TOKEN' },
          user: { name: { firstName: 'Jane', lastName: 'Doe' } },
        }),
      },
    }
  })

  it('hashes the nonce, calls AppleID.auth.signIn, and exchanges via signInWithCredential', async () => {
    const { signInWithApple } = await import('../appleSignin.web')
    const result = await signInWithApple()
    expect(result.success).toBe(true)
    expect(generateNonce).toHaveBeenCalled()
    expect(sha256).toHaveBeenCalledWith('RAW_NONCE')
    expect((window as any).AppleID.auth.init).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'HASHED_NONCE', usePopup: true }),
    )
    const provider = new OAuthProvider('apple.com')
    expect((provider as any).credential).toBeDefined()
    expect(signInWithCredential).toHaveBeenCalled()
    const credentialArg = (signInWithCredential as jest.Mock).mock.calls[0][1]
    expect(credentialArg.idToken).toBe('APPLE_ID_TOKEN')
    expect(credentialArg.rawNonce).toBe('RAW_NONCE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/__tests__/appleSignin.web.test.ts`
Expected: FAIL — current file uses Firebase popup, not AppleID JS.

- [ ] **Step 3: Rewrite `appleSignin.web.ts`**

```ts
// src/auth/appleSignin.web.ts
import { OAuthProvider, getAuth, signInWithCredential } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'
import { generateNonce, sha256 } from './nonce.web'
import { syncDisplayNameFromCredential } from './syncDisplayName'

declare global {
  interface Window {
    AppleID?: any
  }
}

export interface AppleSignInResult {
  success: boolean
  error?: string
}

const auth = getAuth(firebaseApp)
let scriptPromise: Promise<void> | null = null

const APPLE_JS_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

const loadAppleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.AppleID?.auth) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = APPLE_JS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Apple Sign In JS'))
    document.body.appendChild(script)
  })
  return scriptPromise
}

const buildDisplayNameFromAppleUser = (user: any): string | undefined => {
  const first = user?.name?.firstName?.trim?.() || ''
  const last = user?.name?.lastName?.trim?.() || ''
  const combined = `${first} ${last}`.trim()
  return combined || undefined
}

export const signInWithApple = async (): Promise<AppleSignInResult> => {
  const clientId = process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
  const redirectURI = process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI
  if (!clientId || !redirectURI) {
    return {
      success: false,
      error: 'Apple Sign-In not configured (missing client id or redirect URI)',
    }
  }

  try {
    await loadAppleScript()
  } catch (error: any) {
    return { success: false, error: error.message || 'Apple Sign-In unavailable' }
  }

  if (!window.AppleID?.auth) {
    return { success: false, error: 'Apple Sign-In unavailable' }
  }

  const rawNonce = generateNonce()
  const hashedNonce = await sha256(rawNonce)

  try {
    window.AppleID.auth.init({
      clientId,
      scope: 'name email',
      redirectURI,
      usePopup: true,
      nonce: hashedNonce,
    })

    const data = await window.AppleID.auth.signIn()
    const idToken = data?.authorization?.id_token
    if (!idToken) {
      return { success: false, error: 'No identity token received from Apple' }
    }

    const provider = new OAuthProvider('apple.com')
    const credential = provider.credential({ idToken, rawNonce })
    const userCredential = await signInWithCredential(auth, credential)

    const fallbackName = buildDisplayNameFromAppleUser(data?.user)
    await syncDisplayNameFromCredential(userCredential.user as any, fallbackName)

    return { success: true }
  } catch (error: any) {
    if (error?.error === 'popup_closed_by_user') {
      return { success: false, error: 'Sign-in cancelled' }
    }
    console.error('Apple Sign-In failed:', error)
    return { success: false, error: error?.error || error?.message || 'Apple Sign-In failed' }
  }
}

// Apple has no SDK-level sign-out on web. Firebase signOut clears the session.
export const signOutFromApple = async (): Promise<void> => {
  // no-op
}

// Redirect-result handler kept as a no-op so existing imports do not break during the
// transition. Safe to delete once Task 7 removes all callers.
export const handleAppleRedirectResult = async (): Promise<AppleSignInResult> => {
  return { success: true }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx jest src/auth/__tests__/appleSignin.web.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/appleSignin.web.ts src/auth/__tests__/appleSignin.web.test.ts
git commit -m "feat(auth): rewrite web Apple sign-in to AppleID JS with nonce"
```

---

## Task 7: Remove Apple redirect-result handling from sign-in screen

**Files:**
- Modify: `app/sign-in.tsx:12, 89-96`

- [ ] **Step 1: Remove import (line 12)**

Delete:

```ts
import { handleAppleRedirectResult } from '~/auth/appleSignin'
```

- [ ] **Step 2: Remove mount effect (lines 89-96)**

Delete:

```ts
  useEffect(() => {
    handleAppleRedirectResult().then((result) => {
      if (!result.success && result.error) {
        console.error('Apple Sign-In redirect failed:', result.error)
        Alert.alert('Sign-in failed', result.error)
      }
    })
  }, [])
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/sign-in.tsx
git commit -m "refactor(auth): drop Apple redirect-result mount effect (popup-only flow)"
```

---

## Task 8: Reorder sign-out + drop web provider sign-out call

**Files:**
- Modify: `src/machines/authMachine.ts:469-483`
- Modify: `src/machines/authMachine.ts:9` (import)

- [ ] **Step 1: Update sign-out actor to put RevenueCat logout first and drop web provider sign-out**

Replace lines 469-483:

```ts
      signOut: fromPromise(async () => {
        await firebaseSignOut()
        await setCrashlyticsUserId(null)
        await logoutRevenueCat()
        await kvStorePersister.removeClient()
        clearSettings()
        if (Platform.OS === 'ios') {
          await signOutFromApple()
        } else if (Platform.OS === 'android') {
          await signOutFromGoogle()
        } else {
          await signOutFromGoogle()
        }
        queryClient.clear()
      }),
```

With:

```ts
      signOut: fromPromise(async () => {
        // Clear external session state BEFORE Firebase sign-out so RC sees the
        // signed-in user when revoking the app user id.
        try {
          await logoutRevenueCat()
        } catch (rcError) {
          console.error('RevenueCat logout failed (continuing sign-out):', rcError)
        }

        await firebaseSignOut()
        await setCrashlyticsUserId(null)
        await kvStorePersister.removeClient()
        clearSettings()

        if (Platform.OS === 'ios') {
          // Apple has no SDK-level sign-out; intentional no-op.
          await signOutFromApple()
        } else if (Platform.OS === 'android') {
          await signOutFromGoogle()
        }
        // Web: Firebase signOut is sufficient. No provider sign-out call.

        queryClient.clear()
      }),
```

- [ ] **Step 2: Update Google import (line 9)**

`signOutFromGoogle` no longer exists in `googleSignin.web.ts`. Confirm `~/auth/googleSignin` resolves to the native variant on native and the web variant on web (Metro/Webpack `.web.ts` resolution). Since the web sign-out branch is gone, the import only needs to resolve on native.

If TypeScript flags the missing web export, narrow the import to a type that does not require `signOutFromGoogle` from the web variant. The simplest fix is to keep the existing import line unchanged — `signOutFromGoogle` is only referenced in the Android branch, which is platform-gated at runtime. Verify:

Run: `npx tsc --noEmit`
Expected: PASS. If it fails because `googleSignin.web.ts` no longer exports `signOutFromGoogle`, add a re-export in `googleSignin.web.ts`:

```ts
// At bottom of googleSignin.web.ts, only if needed to satisfy type resolution:
export const signOutFromGoogle = async (): Promise<void> => {
  // Web no-op. authMachine never calls this on web.
}
```

- [ ] **Step 3: Update authMachine sign-out test ordering**

Open `__tests__/authMachine.test.ts`. Find the test that asserts sign-out call order (search for `logoutRevenueCat` or `firebaseSignOut`). Update to assert `logoutRevenueCat` is called before `firebaseSignOut`. If no such ordering test exists, add one:

```ts
it('signOut calls logoutRevenueCat before firebaseSignOut', async () => {
  const calls: string[] = []
  ;(logoutRevenueCat as jest.Mock).mockImplementation(async () => {
    calls.push('rc')
  })
  ;(firebaseSignOut as jest.Mock).mockImplementation(async () => {
    calls.push('fb')
  })
  // ... trigger SIGN_OUT event on the authService and await idle
  expect(calls).toEqual(['rc', 'fb'])
})
```

(The exact wiring depends on how the existing tests construct the actor — follow the existing test setup pattern in the file.)

- [ ] **Step 4: Run authMachine tests**

Run: `npx jest __tests__/authMachine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/machines/authMachine.ts __tests__/authMachine.test.ts src/auth/googleSignin.web.ts
git commit -m "fix(auth): order RevenueCat logout before Firebase sign-out; drop web provider sign-out"
```

---

## Task 9: Manual smoke test + final verification

**Files:** none (manual verification)

- [ ] **Step 1: Run full test suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Web smoke test (Chrome)**

- Start web dev server: follow project's existing `expo start --web` command.
- Sign in via Google: confirm GIS button or One Tap appears, sign-in succeeds, user lands authenticated.
- Sign out: confirm session cleared and One Tap does not auto re-sign in immediately.
- Sign in via Apple: confirm popup, complete sign-in, confirm authenticated state.
- Sign out: confirm clean state.

- [ ] **Step 4: Web smoke test (Safari)**

Same checks as Chrome. Note any failure modes when 3rd-party cookies are blocked. Apple popup is the critical path — confirm it opens.

- [ ] **Step 5: iOS smoke test**

- Build to simulator or device.
- Sign in via Google: confirm native flow + Firebase session.
- Sign in via Apple: confirm nonce flow works (no `nonce mismatch` errors in Firebase logs).
- Sign out: confirm RevenueCat customer info clears (check via RC dashboard or `Purchases.getCustomerInfo()` returning empty entitlements).

- [ ] **Step 6: Android smoke test**

- Build and run.
- Sign in via Google: confirm native flow.
- Sign out: confirm RC clears.

- [ ] **Step 7: Document smoke test outcomes**

Append a short "Smoke test results" section to the spec file at `docs/superpowers/specs/2026-05-07-auth-provider-hardening-design.md` listing platforms tested + pass/fail. Commit:

```bash
git add docs/superpowers/specs/2026-05-07-auth-provider-hardening-design.md
git commit -m "docs(spec): record auth hardening smoke test results"
```
