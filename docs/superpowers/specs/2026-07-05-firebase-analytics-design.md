# Firebase Analytics (GA4) Integration Design

**Date:** 2026-07-05
**Branch:** firebase-analytics
**Status:** Implemented (PR #534)

## Overview

Add Firebase Analytics to Clanker on all three platforms (iOS, Android, web) to start accumulating MAU/DAU, retention, and funnel data. Primary motivation: verifiable engagement metrics for a future sale of the app — data only collects forward, so enablement is time-sensitive.

The repo already ships `@react-native-firebase/app` (plus Auth, Crashlytics, App Check, Functions) on native and the `firebase` JS SDK on web, with a platform-split config (`src/config/firebaseConfig.ts` / `firebaseConfig.web.ts`). `firebaseConfig.web.ts` already reads `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`. The cookie-consent system already has an `analytics` category that gates Crashlytics. This design extends those existing seams; no new vendors.

This is a highly pragmatic, tightly scoped, defensively engineered specification: clean baseline metrics (DAU/MAU, retention, core funnel) without new vendor bloat — exactly what a buyer wants to see.

## Design Rationale (key decisions)

| Decision                                                                    | Why                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google_analytics_adid_collection_enabled: false`                           | No ad attribution needed; avoids the ATT prompt, keeps Store privacy labels clean, and leaves UX uninterrupted                                                            |
| Router-driven screen tracking (`usePathname()`) with native auto-screen off | Native GA4 auto-tracking captures UIViewController names that are meaningless in a JS/Expo Router app; router paths are unified and readable across iOS, Android, and web |
| Fire-and-forget, self-swallowing service                                    | Analytics is secondary; a telemetry failure must never cascade into a core app crash                                                                                      |
| Console ops on day one (14-month retention, BigQuery export)                | Data only collects forward — delaying console setup loses history forever                                                                                                 |

## Approach Decision

| Option                                                                                                  | Verdict                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A. `@react-native-firebase/analytics` (native) + `firebase/analytics` JS (web), unified wrapper service | **Chosen.** Matches existing RNFB + platform-split idiom; zero new vendors; free                              |
| B. `expo-firebase-analytics`                                                                            | Rejected — deprecated/removed by Expo                                                                         |
| C. PostHog / Amplitude / Segment                                                                        | Rejected — new vendor and account for a buyer to inherit; GA4 free tier covers MAU/DAU/retention/funnel needs |

## Architecture

New service pair mirroring the existing `crashlyticsService.ts` / `crashlyticsService.web.ts` pattern:

- `src/services/analyticsService.ts` — native; wraps `@react-native-firebase/analytics`
- `src/services/analyticsService.web.ts` — web; wraps `firebase/analytics`, guarded by `isSupported()`

Public interface (identical on both platforms):

```ts
logScreenView(screenName: string): void
logEvent(name: string, params?: Record<string, unknown>): void
setAnalyticsEnabled(enabled: boolean): Promise<void>
setUserId(userId: string | null): Promise<void>
```

All `log*` calls are fire-and-forget and internally try/caught: an analytics failure must never break app flow. `setAnalyticsEnabled` and `setUserId` are async but callers still use `void` — errors are swallowed inside the service.

## User Identity (`setUserId`)

Clanker runs on iOS, Android, and web. Without explicit user linking, the same person on web and iOS is counted as two users in MAU/DAU.

Wire `setUserId` alongside the existing Crashlytics identity calls in `authMachine.ts`:

- **On sign-in / bootstrap:** `setUserId(firebaseUid)` in `runIdentitySetupIfNeeded` (same site as `setCrashlyticsUserId`).
- **On sign-out / session clear:** `setUserId(null)` in `clearSessionData`, `clearFailedBootstrapSession`, and the `signOut` actor cleanup (same sites as `setCrashlyticsUserId(null)`).

Pass the Firebase Auth UID (not the Cloud SQL `dbUser.id`) — it is the only identifier shared across all three platforms. Never put email or other PII in analytics params.

## Web Async Initialization

On web, `isSupported()` from `firebase/analytics` returns `Promise<boolean>`. Analytics cannot initialize synchronously.

The web wrapper must:

1. Start initialization only when consent calls `setAnalyticsEnabled(true)` (unchanged).
2. **Queue** `logScreenView` / `logEvent` calls that arrive while `isSupported()` or `getAnalytics()` is still in flight, then flush the queue once the instance is ready.
3. **Queue** `setUserId` calls the same way — identity must not be lost if bootstrap fires before init resolves.
4. Drop queued calls if `isSupported()` resolves `false` or init fails (unsupported browser, SSR, extension webview).

Without queuing, early funnel events (`sign_up`, `terms_accepted`) fired in the same tick as consent acceptance would be silently dropped.

## Consent Wiring

`src/components/CookieConsent/CookieConsentContext.tsx` line ~56 currently does:

```ts
void setCrashlyticsEnabled(choices.analytics === true)
```

Add beside it:

```ts
void setAnalyticsEnabled(choices.analytics === true)
```

Collection is **disabled by default** and enabled only after consent (opt-in, same behavior as Crashlytics today):

- Native: `analytics_auto_collection_enabled: false` in `firebase.json`; enabled at runtime via `setAnalyticsCollectionEnabled(true)` on consent.
- Web: do not call `getAnalytics()` until consent granted; on revoke, `setAnalyticsCollectionEnabled(false)`.

## Screen Tracking

Hook in `app/_layout.tsx` using expo-router `usePathname()`; on pathname change, call `logScreenView(pathname)`. Native auto screen-tracking stays off (`google_analytics_automatic_screen_reporting_enabled: false`) so all three platforms report identical screen names from the router.

## Custom Events (funnel scope — approved)

Six events, logged at existing action sites. GA4 standard names used where they exist (`sign_up`); custom names follow GA4 conventions (lowercase snake_case, no PII in params).

| Event                    | Site                                                     |
| ------------------------ | -------------------------------------------------------- |
| `sign_up`                | auth success handler (first-time account creation)       |
| `terms_accepted`         | `src/machines/termsMachine.ts` — ACCEPT_TERMS transition |
| `character_created`      | `src/services/characterService.ts` create path           |
| `message_sent`           | `src/services/messageService.ts` send path               |
| `voice_session_started`  | `src/machines/liveVoiceMachine.ts` session start         |
| `subscribe_flow_started` | `app/(drawer)/subscribe.tsx` entry                       |

No message content, character names, or other user content in event params. Params limited to non-identifying dimensions (e.g., platform, character count bucket).

## Config Changes

`app.config.ts`:

- Add `@react-native-firebase/analytics` to plugins.
- Add `RNFBAnalytics` to `expo-build-properties` → `forceStaticLinking`.

`firebase.json` (create or extend):

- `analytics_auto_collection_enabled: false`
- `google_analytics_adid_collection_enabled: false` (no ad ID → minimal store privacy declarations, no ATT prompt)
- `google_analytics_automatic_screen_reporting_enabled: false`

Package: `npx expo install @react-native-firebase/analytics` (version aligned with installed RNFB modules).

Web: `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` env var populated once GA4 property exists (variable already read by `firebaseConfig.web.ts`).

## Console Operations (manual, same day as merge)

1. Firebase console → Project settings → Integrations → enable Google Analytics (creates GA4 property, free).
2. GA4 Admin → Data settings → Data retention: 2 months → **14 months**.
3. Firebase console → Integrations → BigQuery → enable export (free tier) — collects forward only.
4. App Store Connect: update privacy nutrition label (Analytics: usage data, not linked to identity — no ad ID collected).
5. Google Play Console: update Data Safety form (analytics collection, no ad ID).

## Testing

- Unit tests for `analyticsService` (both platform impls): interface shape, fire-and-forget error swallowing, enable/disable passthrough, `setUserId` set/clear — follows existing `crashlyticsService` test pattern.
- Web unit tests: events and `setUserId` queued before async init completes are flushed after init; events before consent are dropped.
- Unit test for consent wiring: analytics toggled with `choices.analytics`.
- Unit tests for `authMachine.ts`: `setUserId` called on identity setup and cleared on sign-out (mirrors existing Crashlytics assertions).
- Manual: Firebase DebugView smoke test on dev client (iOS + Android); web verified via GA debug network beacons in dev.

## Error Handling

Every public method catches and drops its own errors (optionally reporting to Crashlytics on native). No analytics call may throw into calling code. On web, `isSupported()` guard prevents crashes in unsupported browser contexts (SSR, old browsers, extension webviews); failed init drains the queue without throwing.

## Out of Scope

- Metrics dashboard spreadsheet (separate task; store-console backfill independent of this work).
- Granular feature instrumentation (document upload, wiki, credits) — rejected as full-instrumentation scope.
- Any revenue analytics — RevenueCat already covers subscription metrics when subscribers exist.
