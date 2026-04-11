# Apple Auto-Renewable Subscription Consent

This document describes how Clanker satisfies Apple App Store consent requirements for auto-renewable subscriptions while preserving the existing custom terms acceptance flow.

## Requirements Covered

Apple requires that the purchase experience clearly exposes legal terms for subscription users.

1. The paywall must include a Terms of Use link.
2. The Terms of Use destination must host your custom terms and provide access to the Apple Standard EULA.
3. Any custom pre-purchase or sign-up consent cannot override App Store billing/refund controls.

## Current Implementation

### Paywall Legal Surface

The purchase area in the native subscription screen includes:

- Terms of Use link (routes to `/terms`)
- Privacy Policy link (routes to `/privacy`)
- Apple EULA link (opens Apple URL)
- Explanatory legal copy stating that auto-renewable subscriptions are billed through Apple and that Apple Standard EULA applies

Implemented in:

- `app/(drawer)/subscribe.tsx`

### Terms Destination

The terms route now includes:

- Existing custom terms content from `TERMS`
- Explicit notice that Apple Standard EULA applies to iOS auto-renewable subscriptions
- Direct link to Apple Standard EULA

Implemented in:

- `app/terms.tsx`

### Consent Scope Safety

Sign-up consent remains supported (`I Accept` in `AcceptTerms`) for custom terms, while terms copy clarifies that App Store provider terms govern billing/refunds for iOS purchases.

Implemented in:

- `src/config/termsConfig.ts`
- `src/components/AcceptTerms.tsx` (existing acceptance UI)

## Apple EULA URL

The app uses:

- https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

If Apple updates this URL, update both:

- `app/(drawer)/subscribe.tsx`
- `app/terms.tsx`

## Notes for App Review

When submitting builds with auto-renewable subscriptions:

1. Confirm paywall legal links are visible without extra navigation.
2. Confirm Terms route displays custom terms and Apple EULA access.
3. Confirm no custom policy text claims control over App Store-managed refunds for iOS subscriptions.
