# Cookie Consent (Web)

## Scope

Web-only. Native (iOS/Android) is out of scope because the app does not load third-party HTTP cookies in the React Native runtime; native privacy disclosures are handled via App Store / Play Store data forms and the existing in-app analytics setting.

## Architecture

```
app/_layout.tsx
  └─ CookieConsentProvider (web behavior; null elsewhere)
       ├─ <RootLayoutNav />            (existing)
       ├─ <CookieConsentBanner />      (lower-right, web only)
       └─ <CookiePreferencesModal />   (web only)
```

State lives in React context. Persistence in `localStorage` under `cookie:consent:v1`. `canUse(category)` is the single gate any future analytics/marketing SDK must pass through.

## Schema

| Field         | Type                                  | Notes                          |
|---------------|---------------------------------------|--------------------------------|
| policyVersion | number                                | Bump to force re-prompt        |
| consentedAt   | ISO8601 string                        | When the user chose            |
| expiresAt     | ISO8601 string                        | consentedAt + 365d             |
| regionMode    | 'opt-in-strict'                       | Conservative global default    |
| choices       | Record<CookieCategory, boolean>       | necessary always true          |

## UX Rules

- Banner appears bottom-right on web until user makes a choice.
- Accept all and Reject all are equally prominent (one click each).
- Manage preferences opens per-category toggles.
- Footer + Settings expose "Cookie Preferences" for re-opening.

## Adding a New Tracker (Mandatory Checklist)

1. Pick a category (`analytics`, `marketing`, or `preferences`).
2. Initialize the SDK only when `useCookieConsent().canUse(category) === true`.
3. Tear down or never load on `false`.
4. Add a test that fails when init runs without consent.
5. Update this doc and `src/config/privacyConfig.ts`.

## Region Policy

Conservative default: opt-in-strict for all web traffic. Geo differentiation can be added later by sourcing region at the edge and feeding `regionMode` into the provider; until then everyone gets the strict experience.

## QA Checklist

- [ ] First load on `/` shows banner lower-right.
- [ ] Reject all hides banner; reload keeps it hidden.
- [ ] Accept all hides banner; `canUse('analytics')` returns true.
- [ ] Manage preferences opens modal; necessary toggle disabled.
- [ ] Footer "Cookie Preferences" reopens modal.
- [ ] Bumping `COOKIE_POLICY_VERSION` re-prompts on next load.
- [ ] No banner on iOS/Android builds.
