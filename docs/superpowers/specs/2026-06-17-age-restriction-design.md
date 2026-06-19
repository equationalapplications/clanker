# Age Restriction (18+) Design

**Date:** 2026-06-17  
**Branch:** age-restriction  
**Status:** Implemented

## Overview

Enforce 18+ age restriction at the terms acceptance gate (`app/(drawer)/accept-terms.tsx`). Uses native OS age verification on mobile (`expo-age-range`, already installed at `^56.0.5`) and a manual date-of-birth picker on web and as a native fallback.

Age verification is a pre-flight check before the existing `ACCEPT_TERMS` XState event fires. No machine changes required.

## Files Changed

| File | Action |
|------|--------|
| `src/hooks/useAgeVerification.ts` | New — platform branching, native API calls, fallback state |
| `src/hooks/__tests__/useAgeVerification.test.ts` | New — unit tests for hook branching and fallback behavior |
| `src/components/ManualDobPicker.tsx` | New — DOB input UI for web and native error fallback |
| `src/components/__tests__/ManualDobPicker.test.tsx` | New — unit tests for DOB picker validation and age boundaries |
| `app/(drawer)/accept-terms.tsx` | Modified — wire hook, conditional render, DOB-path error alerts |
| `src/components/AcceptTerms.tsx` | Modified — remove "I am over 18 years of age and" from checkbox text |
| `__tests__/acceptTermsScreen.test.tsx` | Modified — mocks and coverage for DOB fallback branch |
| `app.config.ts` | Modified — iOS entitlements for age-range support |
| `package.json` / `package-lock.json` | Modified — add `expo-age-range`, dependency bumps |
| `docs/superpowers/plans/2026-06-17-age-restriction.md` | New — implementation plan |

## Platform Verification Flow

```text
User taps "I Accept"
  │
  ├─ web                    → show ManualDobPicker immediately
  │
  ├─ iOS < 26               → show ManualDobPicker immediately
  │   (requestAgeRangeAsync silently returns lowerBound: 18 on unsupported OS —
  │    must intercept BEFORE calling the API or underage users bypass the gate)
  │
  ├─ iOS >= 26  → isEligibleForAgeFeaturesAsync()
  │                    false (unregulated region) → proceed to ACCEPT_TERMS
  │                    true/null → requestAgeRangeAsync({ threshold1: 18 })
  │                                  lowerBound >= 18 → proceed to ACCEPT_TERMS
  │                                  lowerBound < 18  → alert + SIGN_OUT
  │                    throws       → show ManualDobPicker
  │
  └─ Android      → requestAgeRangeAsync({ threshold1: 18 })
                       lowerBound >= 18 → proceed to ACCEPT_TERMS
                       lowerBound < 18  → alert + SIGN_OUT
                       throws           → show ManualDobPicker

ManualDobPicker
  → age >= 18 → proceed to ACCEPT_TERMS
  → age < 18  → alert + SIGN_OUT
```

**Silent-pass platforms (confirmed from source):**
- **Web** (`AgeRange.web.js`): hardcodes `return { lowerBound: 18 }` — intercepted by our web check before any API call.
- **iOS < 26** (`AgeRange.js` comment): returns `lowerBound: 18` silently. Hook must check `parseInt(String(Platform.Version), 10) < 26` and route to `ManualDobPicker` before calling the API. Note: "iOS 26" is NOT a typo — Apple switched to year-based versioning at WWDC 2025; iOS 26 is the Fall 2025 release. `parseInt("17.5") = 17`, `parseInt("26.1") = 26` — the check works correctly. Do NOT replace 26 with 16 or 17.
- **Android**: uses `AgeSignalsManager.checkAgeSignals()` with `addOnFailureListener` — **rejects the promise (throws) on error**. No silent pass. Existing `throws → ManualDobPicker` path is sufficient; no Android version check needed.

## Hook: `useAgeVerification`

**Location:** `src/hooks/useAgeVerification.ts`

**Props:**
```ts
interface UseAgeVerificationProps {
  onVerified: () => void
  onRejected: () => void
}
```

**Returns:**
```ts
{
  verifyAge: () => Promise<void>   // call on accept tap
  isVerifying: boolean             // true during native API call
  showDobPicker: boolean           // true when DOB fallback active
  handleDobResult: (isAdult: boolean) => void
}
```

**Behavior:**
- Sets `isVerifying = true` at start; resets before calling `onVerified`/`onRejected` or switching to DOB picker
- Web or iOS < 26: sets `showDobPicker = true` immediately, no native call
- iOS >= 26: checks `isEligibleForAgeFeaturesAsync()` first; if `false`, calls `onVerified()` directly
- iOS >= 26 / Android: calls `requestAgeRangeAsync({ threshold1: 18 })`; evaluates `lowerBound`
- On throw: sets `showDobPicker = true` silently (no error surfaced to user)

## Component: `ManualDobPicker`

**Location:** `src/components/ManualDobPicker.tsx`

**Props:**
```ts
interface ManualDobPickerProps {
  onComplete: (isAdult: boolean) => void
}
```

**UI:** Three numeric `TextInput` fields (Month / Day / Year) using react-native-paper, plus a "Continue" button. Heading: "Enter your date of birth to continue." No mention of age threshold — neutral framing to prevent gaming.

**Validation:** Reject non-integer, out-of-range, or calendar-invalid values (e.g. month 13, Feb 31, negative components). Reject dates that `Date()` would normalize to a different calendar day. Reject future birthdates. Only call `onComplete` when the DOB passes validation.

**Logic:** On submit, calculates age from selected DOB using full date comparison (not year subtraction alone — must account for whether birthday has passed this year). Calls `onComplete(age >= 18)`.

```ts
const today = new Date()
const birth = new Date(year, month - 1, day) // month is 1-indexed from picker, Date() expects 0-indexed
let age = today.getFullYear() - birth.getFullYear()
const m = today.getMonth() - birth.getMonth()
if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
```

**Web alert note:** `Alert.alert()` maps to `window.alert()` on web — functional for MVP but blocks the main thread. Future: replace with a Paper Modal or Snackbar before the `SIGN_OUT` call for a smoother web UX.

## Screen: `accept-terms.tsx`

**Conditional render:**
- `showDobPicker === false` → renders `<AcceptTerms>` with `accepting={accepting || isVerifying}`
- `showDobPicker === true` → renders `<ManualDobPicker onComplete={handleDobResult} />`

**Callbacks:**
- `handleVerifiedAdult` → `termsService.send({ type: 'ACCEPT_TERMS', isUpdate })`
- `handleRejectedMinor` → `authService.send({ type: 'SIGN_OUT' })`

## Component: `AcceptTerms.tsx`

Checkbox text changes from:
> "I am over 18 years of age and I have read and accept the Terms and Conditions and Privacy Policy."

To:
> "I have read and accept the Terms and Conditions and Privacy Policy."

Age is now enforced by the hook, not self-attested in the UI.

## Rejection & Error UX

| Scenario | Behavior |
|----------|----------|
| Minor detected (native or DOB) | `Alert("Age Restriction", "This app is for users 18 and older.")` then `SIGN_OUT` |
| Native API throws | Silently swap to `ManualDobPicker`, no error shown |
| Terms API error (existing) | `Alert` in `AcceptTerms.tsx` when on terms screen; same alert in `accept-terms.tsx` when `showDobPicker` is active |

## Out of Scope

- Backend age verification flag (no server-side storage of DOB or age result)
- New routes or blocked screens
- Changes to `termsMachine` or `authMachine`
- Existing users who already accepted terms (gate only fires on `acceptanceRequired` state)
