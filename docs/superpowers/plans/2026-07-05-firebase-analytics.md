# Firebase Analytics (GA4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Analytics (GA4) to Clanker on iOS, Android, and web, gated by existing cookie-consent, with screen tracking and six funnel events.

**Architecture:** New `analyticsService.ts` / `analyticsService.web.ts` pair mirrors the existing `crashlyticsService.ts` / `.web.ts` platform-split pattern. Public interface: `logScreenView(screenName)`, `logEvent(name, params?)`, `setAnalyticsEnabled(enabled)`, `setUserId(userId)` — `log*` calls are fire-and-forget and internally try/caught; `setAnalyticsEnabled` and `setUserId` are async with swallowed errors. Web wrapper queues `log*` and `setUserId` calls while async `isSupported()` / `getAnalytics()` init is in flight. Wired into: cookie consent (`CookieConsentContext.tsx`), `setUserId` in `authMachine.ts` (alongside existing Crashlytics identity calls), a new `useScreenTracking` hook driven by `usePathname()` in `app/_layout.tsx`, and six call sites (`authMachine.ts`, `termsMachine.ts`, `characterService.ts`, `messageService.ts`, `liveVoiceMachine.ts`, `subscribe.tsx`).

**Tech Stack:** `@react-native-firebase/analytics` (native, modular API), `firebase/analytics` (web, already installed as part of `firebase`), Expo config plugins, Jest + `@testing-library/react-native`.

**Full design reference:** `docs/superpowers/specs/2026-07-05-firebase-analytics-design.md`

---

## Design decisions made during planning (not spelled out in the spec)

These fill gaps the spec left implicit. Read before implementing — they are binding, not suggestions.

1. **`sign_up` detection.** The spec says "auth success handler (first-time account creation)" without a mechanism. `exchangeToken` (functions/src/exchangeToken.ts) has no `isNewUser` flag, and adding one is out of scope (backend change, not mentioned in spec). Instead: `BootstrapResponse.user.createdAt === BootstrapResponse.user.updatedAt` (both non-empty strings) is a reliable one-time signal that the Cloud SQL user row was just inserted (see `userRepository.getOrCreateUserByFirebaseIdentity` — existing rows are returned as-is, never touching `updatedAt`). This is checked in `authMachine.ts`'s `bootstrapping.invoke.onDone`, guarded so it only evaluates on a **fresh sign-in** (`context.dbUser === null` before the assign runs), not on background refreshes of an already-signed-in session (purchase/restore/foreground refreshes re-enter `bootstrapping` from `signedIn`, where `dbUser` is already set).
2. **Native startup init (`initializeAnalytics()`).** On native, `useInitializeApp` calls `initializeAnalytics()` at startup. `analyticsService.ts` reads the persisted `setting:analytics` KV key (written by `SettingsContext.updateSetting('analytics', …)` via `settingKey('analytics')`) and applies it through `setAnalyticsCollectionEnabled` before other services finish booting. Web ships a no-op `initializeAnalytics()` in `analyticsService.web.ts`; collection on web is enabled when `CookieConsentContext` calls `setAnalyticsEnabled` after consent. Runtime toggles on all platforms also flow through `CookieConsentContext` and the Settings analytics switch (both call `setAnalyticsEnabled`). `useScreenTracking` waits on `waitForAnalyticsInit()` so the first `screen_view` is not emitted before native startup init finishes applying the stored preference.
3. **Test scope.** The spec's Testing section only calls for unit tests on `analyticsService` (both platforms) and the consent wiring, plus manual DebugView/GA-beacon smoke tests for everything else. `characterService.ts`, `messageService.ts`, and `subscribe.tsx` have no existing unit test files and the spec doesn't ask for new ones — those three call sites are implemented without new tests, verified manually. `authMachine.ts`, `termsMachine.ts`, and `liveVoiceMachine.ts` **do** have existing, actively-maintained test suites (`authMachine.test.ts`, `termsMachine.test.ts`, `liveVoiceMachine.test.ts`) covering the exact transitions being touched — those get new assertions so the new branches aren't left uncovered in files that are otherwise fully tested.
4. **Event params.** Per the spec, only the `sign_up` event carries a param (`{ platform: Platform.OS }`, using the `Platform` import already present in `authMachine.ts`) since "platform" is the one example dimension the spec names. The other five events are logged with no params — inventing a "character count bucket" scheme isn't specified anywhere and would be scope creep.
5. **`setUserId` wiring.** Mirror the existing Crashlytics identity pattern exactly: call `setUserId(uid)` in `runIdentitySetupIfNeeded` and `setUserId(null)` in `clearSessionData`, `clearFailedBootstrapSession`, and the `signOut` actor's `runCleanupStep('setUserId', …)` block. Use the Firebase Auth UID (`context.user.uid`), not `dbUser.id`.
6. **Web event queue.** `isSupported()` is async. The web service keeps a `pendingCalls` queue. `logScreenView` / `logEvent` enqueue when init is in flight (consent granted but instance not ready yet) and flush after `ensureAnalytics()` resolves. `setUserId` uses the same queue. Calls before consent (no init started) are dropped. Failed init drains the queue without throwing.

---

## Task 1: Install package and wire Expo/Firebase config

**Files:**
- Modify: `package.json` (via `expo install`, not hand-edited)
- Modify: `app.config.ts:174-193`
- Modify: `firebase.json`

- [ ] **Step 1: Install the native analytics package**

Run: `npx expo install @react-native-firebase/analytics`

Expected: `package.json` gains `"@react-native-firebase/analytics": "^23.8.8"` (or whatever version `expo install` aligns to the other `@react-native-firebase/*` entries already at `^23.8.8`).

- [ ] **Step 2: Add the plugin and static-linking entry**

In `app.config.ts`, the `expo-build-properties` plugin config currently reads (line ~180):

```ts
forceStaticLinking: ['RNFBApp', 'RNFBAuth', 'RNFBCrashlytics', 'RNFBFunctions', 'RNFBAppCheck'],
```

Change to:

```ts
forceStaticLinking: ['RNFBApp', 'RNFBAuth', 'RNFBCrashlytics', 'RNFBFunctions', 'RNFBAppCheck', 'RNFBAnalytics'],
```

And in the `plugins` array, alongside the existing RNFB plugin entries (line ~190-193):

```ts
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/app-check',
```

Add `'@react-native-firebase/analytics'` to that group:

```ts
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/analytics',
    '@react-native-firebase/app-check',
```

- [ ] **Step 3: Add analytics collection config to `firebase.json`**

Current `firebase.json` has no `react-native` key. Add one (RNFB reads this section for collection defaults):

```json
{
  "react-native": {
    "analytics_auto_collection_enabled": false,
    "google_analytics_adid_collection_enabled": false,
    "google_analytics_automatic_screen_reporting_enabled": false
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
```

(Insert the new `"react-native"` key before the existing `"firestore"` key; leave everything else in the file unchanged.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.config.ts firebase.json
git commit -m "chore: add @react-native-firebase/analytics and config"
```

---

## Task 2: `analyticsService.ts` (native) with tests

**Files:**
- Create: `src/services/analyticsService.ts`
- Test: `__tests__/analyticsService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/analyticsService.test.ts`:

```ts
const mockAnalyticsInstance = { __brand: 'analyticsInstance' }
const mockGetAnalytics = jest.fn(() => mockAnalyticsInstance)
const mockLogEvent = jest.fn()
const mockLogScreenView = jest.fn()
const mockSetAnalyticsCollectionEnabled = jest.fn().mockResolvedValue(undefined)
const mockSetUserId = jest.fn().mockResolvedValue(undefined)

jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
  logScreenView: (...args: unknown[]) => mockLogScreenView(...args),
  setAnalyticsCollectionEnabled: (...args: unknown[]) => mockSetAnalyticsCollectionEnabled(...args),
  setUserId: (...args: unknown[]) => mockSetUserId(...args),
}))

import { logEvent, logScreenView, setAnalyticsEnabled, setUserId } from '~/services/analyticsService'

describe('analyticsService (native)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSetAnalyticsCollectionEnabled.mockResolvedValue(undefined)
  })

  it('logScreenView calls RNFB logScreenView with screen_name and screen_class', () => {
    logScreenView('home')
    expect(mockLogScreenView).toHaveBeenCalledWith(mockAnalyticsInstance, {
      screen_name: 'home',
      screen_class: 'home',
    })
  })

  it('logScreenView swallows errors instead of throwing', () => {
    mockLogScreenView.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => logScreenView('home')).not.toThrow()
  })

  it('logEvent forwards name and params to RNFB logEvent', () => {
    logEvent('character_created', { platform: 'ios' })
    expect(mockLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'character_created', { platform: 'ios' })
  })

  it('logEvent works with no params', () => {
    logEvent('message_sent')
    expect(mockLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'message_sent', undefined)
  })

  it('logEvent swallows errors instead of throwing', () => {
    mockLogEvent.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => logEvent('x')).not.toThrow()
  })

  it('setAnalyticsEnabled(true) calls setAnalyticsCollectionEnabled(instance, true)', async () => {
    await setAnalyticsEnabled(true)
    expect(mockSetAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, true)
  })

  it('setAnalyticsEnabled(false) calls setAnalyticsCollectionEnabled(instance, false)', async () => {
    await setAnalyticsEnabled(false)
    expect(mockSetAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, false)
  })

  it('setAnalyticsEnabled swallows errors instead of throwing/rejecting', async () => {
    mockSetAnalyticsCollectionEnabled.mockRejectedValue(new Error('boom'))
    await expect(setAnalyticsEnabled(true)).resolves.toBeUndefined()
  })

  it('setUserId(uid) calls RNFB setUserId with the uid', async () => {
    await setUserId('firebase-uid-123')
    expect(mockSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, 'firebase-uid-123')
  })

  it('setUserId(null) clears the user id with an empty string', async () => {
    await setUserId(null)
    expect(mockSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, '')
  })

  it('setUserId swallows errors instead of throwing/rejecting', async () => {
    mockSetUserId.mockRejectedValue(new Error('boom'))
    await expect(setUserId('x')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyticsService.test.ts`
Expected: FAIL with "Cannot find module '~/services/analyticsService'"

- [ ] **Step 3: Write the implementation**

Create `src/services/analyticsService.ts`:

```ts
import {
  getAnalytics,
  logEvent as logEventMod,
  logScreenView as logScreenViewMod,
  setAnalyticsCollectionEnabled,
  setUserId as setUserIdMod,
} from '@react-native-firebase/analytics'

export function logScreenView(screenName: string): void {
  try {
    logScreenViewMod(getAnalytics(), { screen_name: screenName, screen_class: screenName })
  } catch (error) {
    console.error('❌ Error logging analytics screen view:', error)
  }
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  try {
    logEventMod(getAnalytics(), name as never, params)
  } catch (error) {
    console.error('❌ Error logging analytics event:', error)
  }
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  try {
    await setAnalyticsCollectionEnabled(getAnalytics(), enabled)
  } catch (error) {
    console.error('❌ Error toggling analytics collection:', error)
  }
}

export async function setUserId(userId: string | null): Promise<void> {
  try {
    await setUserIdMod(getAnalytics(), userId ?? '')
  } catch (error) {
    console.error('❌ Error setting analytics user ID:', error)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyticsService.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. If `@react-native-firebase/analytics`'s modular `logEvent`/`logScreenView` signatures reject the `name as never` cast or the `getAnalytics()` call shape, adjust the cast/argument shape here to match the installed package's actual `.d.ts` — do not suppress with `any` on the whole function.

- [ ] **Step 6: Commit**

```bash
git add src/services/analyticsService.ts __tests__/analyticsService.test.ts
git commit -m "feat: add native analyticsService wrapping RNFB analytics"
```

---

## Task 3: `analyticsService.web.ts` with tests

**Files:**
- Create: `src/services/analyticsService.web.ts`
- Test: `__tests__/analyticsService.web.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/analyticsService.web.test.ts`:

```ts
const mockAnalyticsInstance = { __brand: 'webAnalyticsInstance' }
const mockGetAnalytics = jest.fn(() => mockAnalyticsInstance)
const mockIsSupported = jest.fn()
const mockLogEvent = jest.fn()
const mockSetAnalyticsCollectionEnabled = jest.fn()
const mockSetUserId = jest.fn()

jest.mock('firebase/analytics', () => ({
  getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
  isSupported: (...args: unknown[]) => mockIsSupported(...args),
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
  setAnalyticsCollectionEnabled: (...args: unknown[]) => mockSetAnalyticsCollectionEnabled(...args),
  setUserId: (...args: unknown[]) => mockSetUserId(...args),
}))

jest.mock('~/config/firebaseConfig.web', () => ({
  firebaseApp: { __brand: 'firebaseApp' },
}))

import {
  logEvent,
  logScreenView,
  setAnalyticsEnabled,
  setUserId,
  __resetAnalyticsForTests,
} from '~/services/analyticsService.web'

describe('analyticsService.web', () => {
  beforeEach(() => {
    __resetAnalyticsForTests()
    jest.clearAllMocks()
    mockIsSupported.mockResolvedValue(true)
  })

  it('logScreenView is a no-op before analytics is enabled', () => {
    logScreenView('home')
    expect(mockLogEvent).not.toHaveBeenCalled()
  })

  it('logEvent is a no-op before analytics is enabled', () => {
    logEvent('message_sent')
    expect(mockLogEvent).not.toHaveBeenCalled()
  })

  it('setAnalyticsEnabled(true) initializes analytics when isSupported() resolves true', async () => {
    await setAnalyticsEnabled(true)
    expect(mockIsSupported).toHaveBeenCalled()
    expect(mockGetAnalytics).toHaveBeenCalledWith({ __brand: 'firebaseApp' })
    expect(mockSetAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, true)
  })

  it('does not initialize analytics when isSupported() resolves false', async () => {
    mockIsSupported.mockResolvedValue(false)
    await setAnalyticsEnabled(true)
    expect(mockGetAnalytics).not.toHaveBeenCalled()
    expect(mockSetAnalyticsCollectionEnabled).not.toHaveBeenCalled()
  })

  it('after enabling, logScreenView forwards a screen_view event with firebase_screen params', async () => {
    await setAnalyticsEnabled(true)
    logScreenView('home')
    expect(mockLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'screen_view', {
      firebase_screen: 'home',
      firebase_screen_class: 'home',
    })
  })

  it('after enabling, logEvent forwards name and params', async () => {
    await setAnalyticsEnabled(true)
    logEvent('character_created', { platform: 'web' })
    expect(mockLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'character_created', { platform: 'web' })
  })

  it('queues logEvent calls made while async init is in flight and flushes after init', async () => {
    let resolveSupported!: (v: boolean) => void
    mockIsSupported.mockReturnValue(new Promise<boolean>((r) => { resolveSupported = r }))

    const enablePromise = setAnalyticsEnabled(true)
    logEvent('sign_up', { platform: 'web' })
    expect(mockLogEvent).not.toHaveBeenCalled()

    resolveSupported(true)
    await enablePromise
    expect(mockLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'sign_up', { platform: 'web' })
  })

  it('queues setUserId calls made while async init is in flight and flushes after init', async () => {
    let resolveSupported!: (v: boolean) => void
    mockIsSupported.mockReturnValue(new Promise<boolean>((r) => { resolveSupported = r }))

    const enablePromise = setAnalyticsEnabled(true)
    const userIdPromise = setUserId('firebase-uid-123')
    expect(mockSetUserId).not.toHaveBeenCalled()

    resolveSupported(true)
    await Promise.all([enablePromise, userIdPromise])
    expect(mockSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, 'firebase-uid-123')
  })

  it('setAnalyticsEnabled(false) disables collection on an already-initialized instance', async () => {
    await setAnalyticsEnabled(true)
    mockSetAnalyticsCollectionEnabled.mockClear()
    await setAnalyticsEnabled(false)
    expect(mockSetAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, false)
  })

  it('setAnalyticsEnabled(false) before ever enabling is a no-op, not a throw', async () => {
    await expect(setAnalyticsEnabled(false)).resolves.toBeUndefined()
    expect(mockSetAnalyticsCollectionEnabled).not.toHaveBeenCalled()
  })

  it('setUserId(null) clears the user id', async () => {
    await setAnalyticsEnabled(true)
    await setUserId(null)
    expect(mockSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, null)
  })

  it('swallows isSupported() rejection instead of throwing', async () => {
    mockIsSupported.mockRejectedValue(new Error('boom'))
    await expect(setAnalyticsEnabled(true)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyticsService.web.test.ts`
Expected: FAIL with "Cannot find module '~/services/analyticsService.web'"

- [ ] **Step 3: Write the implementation**

Create `src/services/analyticsService.web.ts`:

```ts
import {
  getAnalytics,
  isSupported,
  logEvent as logEventMod,
  setAnalyticsCollectionEnabled,
  setUserId as setUserIdMod,
  type Analytics,
} from 'firebase/analytics'
import { firebaseApp } from '~/config/firebaseConfig.web'

type PendingCall =
  | { type: 'screen'; screenName: string }
  | { type: 'event'; name: string; params?: Record<string, unknown> }
  | { type: 'userId'; userId: string | null }

let analyticsInstance: Analytics | null = null
let analyticsInitPromise: Promise<Analytics | null> | null = null
let analyticsEnabled = false
let pendingCalls: PendingCall[] = []

function executeCall(instance: Analytics, call: PendingCall): void {
  if (call.type === 'screen') {
    logEventMod(instance, 'screen_view', {
      firebase_screen: call.screenName,
      firebase_screen_class: call.screenName,
    })
  } else if (call.type === 'event') {
    logEventMod(instance, call.name as never, call.params)
  } else {
    setUserIdMod(instance, call.userId)
  }
}

function flushPending(instance: Analytics): void {
  for (const call of pendingCalls) {
    try {
      executeCall(instance, call)
    } catch (error) {
      console.error('❌ Error flushing queued analytics call:', error)
    }
  }
  pendingCalls = []
}

function ensureAnalytics(): Promise<Analytics | null> {
  if (analyticsInstance) {
    return Promise.resolve(analyticsInstance)
  }
  if (!analyticsInitPromise) {
    analyticsInitPromise = isSupported()
      .then((supported) => {
        if (!supported) {
          pendingCalls = []
          return null
        }
        analyticsInstance = getAnalytics(firebaseApp)
        flushPending(analyticsInstance)
        return analyticsInstance
      })
      .catch((error) => {
        console.error('❌ Error initializing web analytics:', error)
        pendingCalls = []
        return null
      })
  }
  return analyticsInitPromise
}

function enqueueOrRun(call: PendingCall): void {
  if (!analyticsEnabled && !analyticsInitPromise) return
  if (analyticsInstance) {
    try {
      executeCall(analyticsInstance, call)
    } catch (error) {
      console.error('❌ Error in analytics call:', error)
    }
    return
  }
  pendingCalls.push(call)
  void ensureAnalytics()
}

export function logScreenView(screenName: string): void {
  enqueueOrRun({ type: 'screen', screenName })
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  enqueueOrRun({ type: 'event', name, params })
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  try {
    analyticsEnabled = enabled
    if (enabled) {
      const instance = await ensureAnalytics()
      if (instance) {
        setAnalyticsCollectionEnabled(instance, true)
      }
      return
    }
    if (analyticsInstance) {
      setAnalyticsCollectionEnabled(analyticsInstance, false)
    }
    pendingCalls = []
  } catch (error) {
    console.error('❌ Error toggling analytics collection:', error)
  }
}

export async function setUserId(userId: string | null): Promise<void> {
  try {
    if (!analyticsEnabled && !analyticsInitPromise) return
    if (analyticsInstance) {
      setUserIdMod(analyticsInstance, userId)
      return
    }
    pendingCalls.push({ type: 'userId', userId })
    const instance = await ensureAnalytics()
    if (instance) flushPending(instance)
  } catch (error) {
    console.error('❌ Error setting analytics user ID:', error)
  }
}

/** @internal Resets module state between unit tests. */
export function __resetAnalyticsForTests(): void {
  analyticsInstance = null
  analyticsInitPromise = null
  analyticsEnabled = false
  pendingCalls = []
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyticsService.web.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/analyticsService.web.ts __tests__/analyticsService.web.test.ts
git commit -m "feat: add web analyticsService wrapping firebase/analytics"
```

---

## Task 4: Wire analytics into cookie consent

**Files:**
- Modify: `src/components/CookieConsent/CookieConsentContext.tsx:20,56`
- Modify: `__tests__/cookieConsentContext.test.tsx`

- [ ] **Step 1: Extend the existing test's mock and add failing assertions**

In `__tests__/cookieConsentContext.test.tsx`, update the top-of-file mock block to also mock `analyticsService`:

```ts
import * as crashlyticsService from '~/services/crashlyticsService'
import * as analyticsService from '~/services/analyticsService'

jest.mock('~/services/crashlyticsService', () => ({
  initializeCrashlytics: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsEnabled: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsUserId: jest.fn().mockResolvedValue(undefined),
  logCrashlyticsError: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('~/services/analyticsService', () => ({
  setAnalyticsEnabled: jest.fn().mockResolvedValue(undefined),
}))
```

Then add three new `it` blocks at the end of the `describe` block (mirroring the existing `setCrashlyticsEnabled` assertions):

```ts
  it('acceptAll calls setAnalyticsEnabled(true)', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.acceptAll())
    expect(analyticsService.setAnalyticsEnabled).toHaveBeenCalledWith(true)
  })

  it('rejectAll calls setAnalyticsEnabled(false)', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.rejectAll())
    expect(analyticsService.setAnalyticsEnabled).toHaveBeenCalledWith(false)
  })

  it('savePreferences calls setAnalyticsEnabled with the analytics choice', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.savePreferences({ analytics: true, marketing: false, preferences: false }))
    expect(analyticsService.setAnalyticsEnabled).toHaveBeenCalledWith(true)

    act(() => api.savePreferences({ analytics: false }))
    expect(analyticsService.setAnalyticsEnabled).toHaveBeenCalledWith(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cookieConsentContext.test.tsx`
Expected: FAIL — `setAnalyticsEnabled` never called (the context doesn't call it yet).

- [ ] **Step 3: Wire the call into `CookieConsentContext.tsx`**

Add the import (next to the existing crashlytics import, line 20):

```ts
import { setCrashlyticsEnabled } from '~/services/crashlyticsService'
import { setAnalyticsEnabled } from '~/services/analyticsService'
```

And in `persist()` (line ~52-57), add the call beside the existing one:

```ts
  const persist = useCallback((choices: Record<CookieCategory, boolean>) => {
    const next = buildRecord(choices)
    writeConsent(next)
    setRecord(next)
    void setCrashlyticsEnabled(choices.analytics === true)
    void setAnalyticsEnabled(choices.analytics === true)
  }, [])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cookieConsentContext.test.tsx`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/components/CookieConsent/CookieConsentContext.tsx __tests__/cookieConsentContext.test.tsx
git commit -m "feat: gate analytics collection behind cookie consent"
```

---

## Task 5: Screen tracking hook + wiring

**Files:**
- Create: `src/hooks/useScreenTracking.ts`
- Test: `src/hooks/__tests__/useScreenTracking.test.ts`
- Modify: `app/_layout.tsx:7,180` (import + call in `RootLayoutNav`)

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useScreenTracking.test.ts`:

```ts
import { renderHook } from '@testing-library/react-native'
import { usePathname } from 'expo-router'
import { logScreenView } from '~/services/analyticsService'
import { useScreenTracking } from '../useScreenTracking'

jest.mock('expo-router', () => ({
  usePathname: jest.fn(),
}))

jest.mock('~/services/analyticsService', () => ({
  logScreenView: jest.fn(),
}))

describe('useScreenTracking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('logs a screen view for the initial pathname', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    renderHook(() => useScreenTracking())
    expect(logScreenView).toHaveBeenCalledWith('/characters')
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })

  it('logs a new screen view when the pathname changes', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())

    jest.mocked(usePathname).mockReturnValue('/settings')
    rerender({})

    expect(logScreenView).toHaveBeenCalledTimes(2)
    expect(logScreenView).toHaveBeenLastCalledWith('/settings')
  })

  it('does not log again when the pathname is unchanged across renders', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())
    rerender({})
    rerender({})
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useScreenTracking.test.ts`
Expected: FAIL with "Cannot find module '../useScreenTracking'"

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useScreenTracking.ts`:

```ts
import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import { logScreenView } from '~/services/analyticsService'

export function useScreenTracking(): void {
  const pathname = usePathname()

  useEffect(() => {
    logScreenView(pathname)
  }, [pathname])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useScreenTracking.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the hook into `app/_layout.tsx`**

Add the import near the other hook imports (line ~41):

```ts
import { useRegisterExpoPushToken } from '~/hooks/useRegisterExpoPushToken'
import { useBrowserActionApproval } from '~/hooks/useBrowserActionApproval'
import { useScreenTracking } from '~/hooks/useScreenTracking'
```

In `RootLayoutNav` (starts line 179), call the hook alongside the other top-of-component hooks:

```ts
function RootLayoutNav() {
  const { colors } = useTheme()
  useInitializeApp()
  useScreenTracking()
  const authService = useAuthMachine()
```

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS, no new failures (existing `_layout.tsx` isn't unit-tested directly today, so this is a smoke check for other suites that may render it).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useScreenTracking.ts src/hooks/__tests__/useScreenTracking.test.ts app/_layout.tsx
git commit -m "feat: track screen views from router pathname"
```

---

## Task 6: `sign_up` event, `setUserId` identity, and auth wiring

**Files:**
- Modify: `src/machines/authMachine.ts:13,202-217,273-…,389-405,503`
- Modify: `__tests__/authMachine.test.ts`

- [ ] **Step 1: Add the mock and a failing test**

In `__tests__/authMachine.test.ts`, add a mock for the new service near the other mocks (after the crashlytics mock, line ~44):

```ts
const mockLogEvent = jest.fn()
const mockSetUserId = jest.fn().mockResolvedValue(undefined)

jest.mock('../src/services/analyticsService', () => ({
  logEvent: mockLogEvent,
  setUserId: mockSetUserId,
}))
```

Add a new test after the existing "reaches signedIn and stores bootstrap snapshot" test:

```ts
  it('logs sign_up when bootstrap returns a brand-new account (createdAt === updatedAt)', async () => {
    const user = makeUser('firebase-new')
    const bootstrapData = {
      user: {
        id: 'user-new',
        firebaseUid: 'firebase-new',
        email: 'new@example.com',
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
      },
      subscription: { planTier: 'free', currentCredits: 100 },
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(mockLogEvent).toHaveBeenCalledWith('sign_up', { platform: 'ios' })
    actor.stop()
  })

  it('does not log sign_up for a returning account (createdAt !== updatedAt)', async () => {
    const user = makeUser('firebase-returning')
    const bootstrapData = {
      user: {
        id: 'user-returning',
        firebaseUid: 'firebase-returning',
        email: 'returning@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
      },
      subscription: { planTier: 'free', currentCredits: 100 },
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(mockLogEvent).not.toHaveBeenCalledWith('sign_up', expect.anything())
    actor.stop()
  })

  it('calls setUserId with the Firebase UID on identity setup', async () => {
    const user = makeUser('firebase-uid-analytics')
    mockBootstrapSession.mockResolvedValue({
      user: { id: 'user-1', firebaseUid: 'firebase-uid-analytics', email: 'a@example.com' },
      subscription: { planTier: 'free', currentCredits: 100 },
    })

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(mockSetUserId).toHaveBeenCalledWith('firebase-uid-analytics')
    actor.stop()
  })
```

Note: `Platform.OS` defaults to `'ios'` under the RN Jest preset, matching the first assertion above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- authMachine.test.ts`
Expected: FAIL — `mockLogEvent` never called (no wiring yet), and the "reaches signedIn" pre-existing test still passes since it doesn't assert on `mockLogEvent`.

- [ ] **Step 3: Wire analytics identity and events into `authMachine.ts`**

Add the import (line ~13, next to the crashlytics import):

```ts
import { setCrashlyticsUserId } from '~/services/crashlyticsService'
import { logEvent, setUserId } from '~/services/analyticsService'
```

Update the `bootstrapping.invoke.onDone` actions array (currently lines ~202-211):

```ts
      bootstrapping: {
        on: {
          REFRESH_BOOTSTRAP: {
            actions: 'queueRefreshReason',
          },
          APP_FOREGROUNDED: {
            actions: 'queueForegroundRefreshReason',
          },
        },
        invoke: {
          id: 'bootstrapAppSession',
          src: 'bootstrapAppSession',
          input: ({ context }) => ({ user: context.user }),
          onDone: {
            target: 'signedIn',
            actions: [
              'logSignUpIfNewAccount',
              assign({
                dbUser: ({ event }) => event.output.user,
                subscription: ({ event }) => event.output.subscription,
                error: null,
              }),
              'markRefreshCompleted',
            ],
          },
          onError: {
            target: 'signedOut',
            actions: ['clearFailedBootstrapSession', assign({ error: ({ event }) => event.error as Error })],
          },
        },
      },
```

Add the named action to the `actions` block (after `runIdentitySetupIfNeeded`, in the object starting at line ~273):

```ts
      runIdentitySetupIfNeeded: ({ context }) => {
        const uid = context.user?.uid
        if (!uid || context.identitySetupUid === uid) {
          return
        }
        loginRevenueCat(uid)
        setCrashlyticsUserId(uid)
        void setUserId(uid)
      },
      logSignUpIfNewAccount: ({ context, event }) => {
        // Only evaluate on a fresh sign-in (dbUser not yet populated). Background
        // refreshes (purchase/restore/foreground) re-enter this state from
        // 'signedIn', where dbUser is already set, so they're skipped here.
        if (context.dbUser !== null) return
        const user = (event as { output?: { user?: { createdAt?: unknown; updatedAt?: unknown } } })
          .output?.user
        if (
          typeof user?.createdAt === 'string' &&
          typeof user?.updatedAt === 'string' &&
          user.createdAt === user.updatedAt
        ) {
          logEvent('sign_up', { platform: Platform.OS })
        }
      },
```

Update `clearSessionData` and `clearFailedBootstrapSession` to also clear analytics user ID:

```ts
      clearSessionData: () => {
        Promise.all([
          setCrashlyticsUserId(null),
          setUserId(null),
          logoutRevenueCat(),
          kvStorePersister.removeClient(),
        ]).catch((err) => console.error('clearSessionData failed:', err))
        queryClient.clear()
      },
      clearFailedBootstrapSession: () => {
        Promise.all([
          firebaseSignOut(),
          setCrashlyticsUserId(null),
          setUserId(null),
          logoutRevenueCat(),
          kvStorePersister.removeClient(),
        ]).catch((err) => console.error('clearFailedBootstrapSession failed:', err))
        queryClient.clear()
      },
```

In the `signOut` actor cleanup (line ~503), add a step beside the Crashlytics one:

```ts
        await runCleanupStep('setCrashlyticsUserId', () => setCrashlyticsUserId(null))
        await runCleanupStep('setUserId', () => setUserId(null))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- authMachine.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/machines/authMachine.ts __tests__/authMachine.test.ts
git commit -m "feat: wire analytics user identity and sign_up event in authMachine"
```

---

## Task 7: `terms_accepted` event

**Files:**
- Modify: `src/machines/termsMachine.ts:79-91,95-108`
- Modify: `__tests__/termsMachine.test.ts`

- [ ] **Step 1: Add the mock and a failing test**

In `__tests__/termsMachine.test.ts`, add a mock after the existing `acceptTermsFn` mock (line ~8):

```ts
const mockAcceptTermsFn = jest.fn()
const mockLogEvent = jest.fn()

jest.mock('../src/services/apiClient', () => ({
  acceptTermsFn: mockAcceptTermsFn,
}))

jest.mock('../src/services/analyticsService', () => ({
  logEvent: mockLogEvent,
}))
```

Add `mockLogEvent.mockReset()` to the existing `beforeEach`, then add a new test after "accepts terms successfully from acceptanceRequired":

```ts
  it('logs terms_accepted when acceptance succeeds', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null })
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(mockLogEvent).toHaveBeenCalledWith('terms_accepted', { is_update: false })
    actor.stop()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- termsMachine.test.ts`
Expected: FAIL — `mockLogEvent` never called.

- [ ] **Step 3: Wire the event into `termsMachine.ts`**

Add the import (line ~3):

```ts
import { acceptTermsFn } from '~/services/apiClient'
import { logEvent } from '~/services/analyticsService'
```

Update the `accepting` state's `onDone` (currently lines ~79-91):

```ts
      accepting: {
        invoke: {
          id: 'recordTermsAcceptance',
          src: 'recordTermsAcceptance',
          onDone: {
            target: 'accepted',
            actions: 'logTermsAccepted',
          },
          onError: {
            target: 'acceptanceRequired',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
      },
```

Add an `actions` block alongside the existing `actors` block (currently the second `createMachine` argument only has `actors`, ~lines 95-108):

```ts
  {
    actions: {
      logTermsAccepted: ({ context }: { context: TermsMachineContext }) => {
        logEvent('terms_accepted', { is_update: context.isUpdate })
      },
    },
    actors: {
      recordTermsAcceptance: fromPromise(async () => {
        try {
          const response = await acceptTermsFn({ termsVersion: TERMS.version })
          if (response?.data?.success !== true) {
            throw new Error('Malformed accept terms response')
          }
        } catch (err: any) {
          throw new Error('Failed to record terms acceptance: ' + err.message)
        }
      }),
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- termsMachine.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/machines/termsMachine.ts __tests__/termsMachine.test.ts
git commit -m "feat: log terms_accepted analytics event"
```

---

## Task 8: `character_created` event

**Files:**
- Modify: `src/services/characterService.ts:1-11,68-79`

- [ ] **Step 1: Add the import and the call**

Add the import near the top of `src/services/characterService.ts` (alongside the other imports, before line 12):

```ts
import { logEvent } from '~/services/analyticsService'
```

Update `createCharacter` (currently lines 68-79):

```ts
export const createCharacter = async (character: CharacterInsert): Promise<Character | null> => {
  const userId = getCurrentUser()?.uid
  if (!userId) {
    throw new Error('User not logged in')
  }
  try {
    const created = await characterDB.createCharacter(userId, character)
    logEvent('character_created')
    return created
  } catch (error) {
    console.error('Error creating character:', error)
    throw error
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Run the existing suite to confirm no regressions**

Run: `npm test`
Expected: PASS, no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/services/characterService.ts
git commit -m "feat: log character_created analytics event"
```

---

## Task 9: `message_sent` event

**Files:**
- Modify: `src/services/messageService.ts:1-8,27-41`

- [ ] **Step 1: Add the import and the call**

Add the import near the top of `src/services/messageService.ts` (after the existing imports, before line 12):

```ts
import { IMessage } from 'react-native-gifted-chat'
import * as messageDB from '../database/messageDatabase'
import { logEvent } from '~/services/analyticsService'
```

Update `sendMessage` (currently lines 27-41):

```ts
export const sendMessage = async (
  characterId: string,
  userId: string,
  message: Pick<IMessage, '_id' | 'text' | 'user'> & { [key: string]: any },
): Promise<void> => {
  try {
    // Extract IMessage properties
    const { _id, text, user: messageUser, ...additionalData } = message

    await messageDB.sendMessage(characterId, userId, text, String(_id), additionalData)
    logEvent('message_sent')
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Run the existing suite to confirm no regressions**

Run: `npm test`
Expected: PASS, no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/services/messageService.ts
git commit -m "feat: log message_sent analytics event"
```

---

## Task 10: `voice_session_started` event

**Files:**
- Modify: `src/machines/liveVoiceMachine.ts:1,297-298`
- Modify: `__tests__/liveVoiceMachine.test.ts`

- [ ] **Step 1: Add the mock and a failing test**

In `__tests__/liveVoiceMachine.test.ts`, add a mock near the other `jest.mock` calls (after line ~27):

```ts
const mockLogEvent = jest.fn()

jest.mock('~/services/analyticsService', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}))
```

Add a new test near the other tests that use `advanceToLive`:

```ts
  test('logs voice_session_started when the session becomes live', async () => {
    const actor = spawn()
    await advanceToLive(actor)
    expect(mockLogEvent).toHaveBeenCalledWith('voice_session_started')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- liveVoiceMachine.test.ts`
Expected: FAIL — `mockLogEvent` never called.

- [ ] **Step 3: Wire the event into `liveVoiceMachine.ts`**

Add the import (line ~1, alongside the other imports):

```ts
import { createMachine, assign, fromPromise, fromCallback, sendTo } from 'xstate'
import { logEvent } from '~/services/analyticsService'
```

Update the `live` state's `entry` (currently line ~297-298):

```ts
          live: {
            entry: [
              assign({ retryCount: () => 0 }),
              () => logEvent('voice_session_started'),
            ],
            on: {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- liveVoiceMachine.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/machines/liveVoiceMachine.ts __tests__/liveVoiceMachine.test.ts
git commit -m "feat: log voice_session_started analytics event"
```

---

## Task 11: `subscribe_flow_started` event

**Files:**
- Modify: `app/(drawer)/subscribe.tsx:1-3,16-19`

- [ ] **Step 1: Add the import and a mount effect**

Add the import (alongside the other imports, line ~3):

```ts
import React, { useState } from 'react'
import { logEvent } from '~/services/analyticsService'
```

In `SubscribeScreen` (starts line 16), add a mount effect right after the component's other top-level hooks (after the `useLayoutEffect` block that sets the header title, line ~31):

```ts
  // Override the drawer header title so the route-group name "(drawer)" never leaks through
  React.useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: 'Subscribe' })
  }, [navigation])

  React.useEffect(() => {
    logEvent('subscribe_flow_started')
  }, [])

  const { userPrivate } = useUserPrivateData()
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Run the existing suite to confirm no regressions**

Run: `npm test -- subscribeButton.test.tsx subscribeRestoreRefresh.test.tsx subscribeWebCheckoutSync.test.tsx subscribeScreenPremiumGate.test.tsx`
Expected: PASS — these existing suites render `SubscribeScreen` and don't mock `analyticsService`, so if any fail with "Cannot find module" or a thrown error from `logEvent`, add a `jest.mock('~/services/analyticsService', () => ({ logEvent: jest.fn() }))` to whichever spec breaks before re-running.

- [ ] **Step 4: Commit**

```bash
git add app/\(drawer\)/subscribe.tsx
git commit -m "feat: log subscribe_flow_started analytics event"
```

---

## Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero errors (auto-fixable issues are fixed in place by `--fix`; review the diff before committing anything it touches).

- [ ] **Step 4: Manual DebugView smoke test — native**

Build and run a dev client on iOS and Android. Accept cookie consent (analytics category) in the running app. Firebase Console → Analytics → DebugView should show the device's debug stream. Navigate a few screens and confirm `screen_view` events with correct `screen_name` appear. Trigger at least one custom event (e.g. sign in with a fresh account to hit `sign_up`, or send a message for `message_sent`) and confirm it appears in DebugView within a few seconds.

- [ ] **Step 5: Manual DebugView / debug beacon smoke test — web**

Run the web build locally (`npm run web` or equivalent dev script). Accept cookie consent. Open browser DevTools → Network tab, filter on `google-analytics.com/g/collect` or `region1.analytics.google.com`, confirm beacons fire on navigation and on at least one custom event.

- [ ] **Step 6: Confirm consent revocation stops collection**

In both a native dev client and the web build, open cookie preferences and turn analytics off. Confirm no further DebugView events / network beacons fire for subsequent navigation.

---

## Task 13: Console operations (manual, same day as merge)

**Files:** none (Firebase/App Store/Play Console configuration only — no code)

- [ ] **Step 1:** Firebase Console → Project settings → Integrations → enable Google Analytics (creates the GA4 property; free tier).
- [ ] **Step 2:** GA4 Admin → Data settings → Data retention → change from the 2-month default to **14 months**.
- [ ] **Step 3:** Firebase Console → Integrations → BigQuery → enable export (free tier; collects forward only, no backfill).
- [ ] **Step 4:** App Store Connect → App Privacy → update the nutrition label: Analytics category, usage data, not linked to identity, no ad ID collected.
- [ ] **Step 5:** Google Play Console → App content → Data Safety → update the form: analytics collection declared, no ad ID collected.
- [ ] **Step 6:** Populate `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` in the relevant env file(s) now that the GA4 property (and its associated web stream) exists — `firebaseConfig.web.ts` already reads this var, no code change needed.

---

## Self-review notes

- **Spec coverage:** every section of the design doc maps to a task — Approach (Task 1), Architecture (Tasks 2-3), Consent Wiring (Task 4), Screen Tracking (Task 5), User Identity + `sign_up` (Task 6), remaining Custom Events (Tasks 7-11), Config Changes (Task 1), Testing (spread across Tasks 2-11 per the scoped decision in the preamble), Error Handling (built into every service method via try/catch + web queue), Console Operations (Task 13).
- **Type consistency:** `logScreenView(screenName: string)`, `logEvent(name: string, params?: Record<string, unknown>)`, `setAnalyticsEnabled(enabled: boolean): Promise<void>`, and `setUserId(userId: string | null): Promise<void>` are the same four signatures across `analyticsService.ts`, `analyticsService.web.ts`, and every call site (Tasks 4, 5, 6, 7, 8, 9, 10, 11) — no drift.
- **No placeholders:** every code step above is complete, runnable code, not a description of code.
