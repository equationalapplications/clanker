# Firebase Analytics (GA4) Integration Design

**Date:** 2026-07-05
**Branch:** firebase-analytics
**Status:** Approved — not yet implemented

## Overview

Add Firebase Analytics to Clanker on all three platforms (iOS, Android, web) to start accumulating MAU/DAU, retention, and funnel data. Primary motivation: verifiable engagement metrics for a future sale of the app — data only collects forward, so enablement is time-sensitive.

The repo already ships `@react-native-firebase/app` (plus Auth, Crashlytics, App Check, Functions) on native and the `firebase` JS SDK on web, with a platform-split config (`src/config/firebaseConfig.ts` / `firebaseConfig.web.ts`). `firebaseConfig.web.ts` already reads `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`. The cookie-consent system already has an `analytics` category that gates Crashlytics. This design extends those existing seams; no new vendors.

## Approach Decision

| Option | Verdict |
|--------|---------|
| A. `@react-native-firebase/analytics` (native) + `firebase/analytics` JS (web), unified wrapper service | **Chosen.** Matches existing RNFB + platform-split idiom; zero new vendors; free |
| B. `expo-firebase-analytics` | Rejected — deprecated/removed by Expo |
| C. PostHog / Amplitude / Segment | Rejected — new vendor and account for a buyer to inherit; GA4 free tier covers MAU/DAU/retention/funnel needs |

## Architecture

New service pair mirroring the existing `crashlyticsService.ts` / `crashlyticsService.web.ts` pattern:

- `src/services/analyticsService.ts` — native; wraps `@react-native-firebase/analytics`
- `src/services/analyticsService.web.ts` — web; wraps `firebase/analytics`, guarded by `isSupported()`

Public interface (identical on both platforms):

```ts
logScreenView(screenName: string): void
logEvent(name: string, params?: Record<string, unknown>): void
setAnalyticsEnabled(enabled: boolean): Promise<void>
```

All calls are fire-and-forget and internally try/caught: an analytics failure must never break app flow.

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

| Event | Site |
|-------|------|
| `sign_up` | auth success handler (first-time account creation) |
| `terms_accepted` | `src/machines/termsMachine.ts` — ACCEPT_TERMS transition |
| `character_created` | `src/services/characterService.ts` create path |
| `message_sent` | `src/services/messageService.ts` send path |
| `voice_session_started` | `src/machines/liveVoiceMachine.ts` session start |
| `subscribe_flow_started` | `app/(drawer)/subscribe.tsx` entry |

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

- Unit tests for `analyticsService` (both platform impls): interface shape, fire-and-forget error swallowing, enable/disable passthrough — follows existing `crashlyticsService` test pattern.
- Unit test for consent wiring: analytics toggled with `choices.analytics`.
- Manual: Firebase DebugView smoke test on dev client (iOS + Android); web verified via GA debug network beacons in dev.

## Error Handling

Every public method catches and drops its own errors (optionally reporting to Crashlytics on native). No analytics call may throw into calling code. `isSupported()` guard on web prevents crashes in unsupported browser contexts (SSR, old browsers, extension webviews).

## Out of Scope

- Metrics dashboard spreadsheet (separate task; store-console backfill independent of this work).
- Granular feature instrumentation (document upload, wiki, credits) — rejected as full-instrumentation scope.
- Any revenue analytics — RevenueCat already covers subscription metrics when subscribers exist.
