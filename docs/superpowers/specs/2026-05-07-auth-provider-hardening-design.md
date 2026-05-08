# Auth Provider Hardening — Design

**Date:** 2026-05-07
**Status:** Approved

## Problem

Code review of Google and Apple sign-in across web and mobile surfaced six issues:

1. **Critical** — Web Apple sign-in does not use a nonce. ID token vulnerable to replay/reuse.
2. **Critical** — Web Google fallback uses an opaque OAuth2 access token via `GoogleAuthProvider.credential(null, accessToken)` instead of a verifiable ID token.
3. **High** — iOS sign-out path calls `signOutFromApple()` (a no-op) but does not explicitly clear RevenueCat session state.
4. **High** — Web One Tap → OAuth2 token fallback in `googleSignin.web.ts` adds complexity without meaningful coverage.
5. **Medium** — `displayName` is set inconsistently across web vs mobile sign-in paths.
6. **Medium** — Web `signOutFromGoogle()` is a no-op stub still called from sign-out flow.

## Goals

- Eliminate the security gaps in #1 and #2.
- Make web and mobile sign-in flows architecturally consistent: provider-native SDK → ID token (with nonce where applicable) → `signInWithCredential`.
- Centralize cross-cutting concerns (display name sync, sign-out cleanup).

## Non-Goals

- Adding new identity providers.
- Server-side token validation via Cloud Functions.
- Account linking flow changes (preserve existing behavior).
- E2E browser test harness.

## Architecture

All four sign-in paths converge on the same shape:

```
provider-native SDK → ID token (+ nonce on Apple) → signInWithCredential(auth, cred) → syncDisplayNameFromCredential(user)
```

This eliminates Firebase `signInWithPopup` / `signInWithRedirect` wrappers on web. The mobile flows already follow this shape; web is brought into alignment.

Sign-out adds an explicit RevenueCat logout step before Firebase `signOut`, on every platform.

## Components & Changes

### `src/auth/nonce.ts` (existing) + `src/auth/nonce.web.ts` (NEW)

- Existing native variant uses `expo-crypto` for random bytes + SHA256.
- New web variant exposes the same API using `crypto.getRandomValues` and `crypto.subtle.digest('SHA-256')`.
- Exported API (both platforms use these names in code):
  - `generateNonce(length?: number): string` — cryptographically random string (default length 32)
  - `sha256(input: string): Promise<string>` — SHA-256 hex digest

### `src/auth/googleSignin.web.ts` (rewrite)

- Lazy-load Google Identity Services script (`https://accounts.google.com/gsi/client`).
- Initialize `google.accounts.id` with `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
- Render the GIS button inline; surface One Tap as enhancement.
- GIS callback receives `{ credential: idToken }` → `GoogleAuthProvider.credential(idToken, null)` → `signInWithCredential(auth, cred)`.
- Drop: `signInWithPopup`, `oauth2.initTokenClient` access-token fallback.
- Exports: `signInWithGoogle()`, `renderGoogleButton(el)`, plus `initializeGoogleSignIn()` for script warmup.

### `src/auth/googleSignin.ts` (mobile)

- Keep `@react-native-google-signin` flow.
- Remove inline `displayName` update; call shared helper instead.

### `src/auth/appleSignin.web.ts` (rewrite)

- Lazy-load Apple JS (`https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`).
- Generate `rawNonce`; compute `hashedNonce = SHA256(rawNonce)`.
- `AppleID.auth.init({ clientId, scope: 'name email', redirectURI, usePopup: true, nonce: hashedNonce })`.
- `AppleID.auth.signIn()` → `{ authorization.id_token, user? }`.
- `new OAuthProvider('apple.com').credential({ idToken, rawNonce })` → `signInWithCredential(auth, cred)`.
- Drop Firebase popup/redirect path entirely.
- Remove `handleAppleRedirectResult` from `app/sign-in.tsx`.

### `src/auth/appleSignin.ts` (mobile)

- Keep `expo-apple-authentication` flow with nonce + SHA256 (already correct).
- Remove inline `displayName` update; call shared helper instead.

### `src/auth/syncDisplayName.ts` (NEW)

```ts
export async function syncDisplayNameFromCredential(
  user: User,
  fallbackName?: string,
): Promise<void>
```

Behavior:
- If `user.displayName` is non-empty, return.
- Derive display name from `fallbackName ?? user.providerData[0]?.displayName`.
- If derived name is non-empty, call modular `updateProfile(user, { displayName })` (web: `firebase/auth`; native: `@react-native-firebase/auth`).

Called by all four sign-in paths after `signInWithCredential` resolves.

### `src/auth/authMachine.ts` (sign-out action)

- Add `await logoutRevenueCat()` BEFORE `signOut(auth)`, on all platforms.
- Wrap RevenueCat call in try/catch; log failure; continue sign-out regardless.
- Remove web call to deleted `signOutFromGoogle()`.
- Keep `signOutFromGoogle()` (Android native) and `signOutFromApple()` (iOS no-op, with comment explaining why no SDK sign-out exists).

### `app/sign-in.tsx`

- Web Google: render the GIS button via `renderGoogleButton(ref)` instead of the custom button. Sign-in is callback-driven.
- Web Apple: keep the custom button; on click invoke `signInWithApple()`.
- Remove the `handleAppleRedirectResult` mount effect.

## Data Flow

### Web Google sign-in

1. Sign-in screen mounts → GIS script loads → `renderGoogleButton(ref)` mounts the button.
2. User clicks (or accepts One Tap).
3. GIS callback fires with `{ credential: idToken }`.
4. `GoogleAuthProvider.credential(idToken, null)` → `signInWithCredential(auth, cred)`.
5. `syncDisplayNameFromCredential(user)`.
6. `onAuthStateChanged` fires; authMachine transitions to authenticated.

### Web Apple sign-in

1. User clicks Apple button.
2. `rawNonce = generateNonce()`; `hashedNonce = await sha256(rawNonce)`.
3. Lazy-load AppleID JS; `AppleID.auth.init({ ..., nonce: hashedNonce, usePopup: true })`.
4. `await AppleID.auth.signIn()` → popup → `{ authorization.id_token, user.name? }`.
5. `OAuthProvider('apple.com').credential({ idToken, rawNonce })` → `signInWithCredential`.
6. `syncDisplayNameFromCredential(user, "${user.name?.firstName ?? ''} ${user.name?.lastName ?? ''}".trim() || undefined)` — Apple only returns `user.name` on first sign-in.
7. authMachine transitions.

### Mobile flows

Unchanged shape. Inline `updateProfile` replaced with `syncDisplayNameFromCredential` call.

### Sign-out (all platforms)

1. authMachine sign-out action fires.
2. `await logoutRevenueCat()` (try/catch).
3. Platform branch:
   - iOS: `signOutFromApple()` no-op (commented).
   - Android: `signOutFromGoogle()` native.
   - Web: skip provider sign-out (deleted).
4. `await signOut(auth)`.
5. authMachine transitions to unauthenticated.

## Error Handling

- **GIS script load failure (web Google):** throw `ProviderUnavailableError`. UI shows "Google sign-in unavailable, try Apple or email."
- **One Tap dismissed / not displayed:** Prompt notification settles the sign-in promise (`isDismissedMoment` → user-cancelled; skipped/not displayed → unavailable). A long timeout covers FedCM cases where the listener never runs so the auth machine cannot hang indefinitely.
- **Apple JS load failure:** same `ProviderUnavailableError` pattern.
- **Apple popup blocked / closed:** `AppleID.auth.signIn()` reject codes — `popup_closed_by_user` is silent (user-cancelled); other codes surface as toast.
- **Nonce mismatch / invalid ID token:** Firebase `signInWithCredential` rejects → log + toast "Sign-in failed, try again." No automatic retry.
- **RevenueCat logout failure:** caught, logged, sign-out proceeds. Auth state must clear regardless.
- **Network failures:** sign-in helpers throw; sign-in screen catches and toasts.
- **Existing-account-different-credential:** preserved from current authMachine account-linking flow.

## Testing

### Unit (jest)

- `nonce.web.ts`: random length is 32 bytes, hex format, SHA256 hash matches expected output for a known input.
- `syncDisplayName`:
  - empty `displayName` + `fallbackName` → `updateProfile` called.
  - non-empty `displayName` → skip.
  - empty `displayName` + null `providerData` + no fallback → skip.

### Integration (jest with mocks)

- `googleSignin.web.ts`: mock GIS global, fire callback with fake idToken → assert `signInWithCredential` called with correct provider and token.
- `appleSignin.web.ts`: mock AppleID global, assert nonce hashed via SHA256 before `init`, raw nonce passed to `OAuthProvider.credential`.
- authMachine sign-out: assert `logoutRevenueCat` called before `signOut(auth)`; sign-out completes even when RevenueCat throws.

### Manual smoke test matrix (pre-merge)

- Web Chrome: Google button + One Tap, Apple popup, sign-out.
- Web Safari: Google (3rd-party cookies blocked path), Apple popup, sign-out.
- iOS: Google native, Apple native (nonce flow), sign-out clears RevenueCat.
- Android: Google native, sign-out clears RevenueCat.

### Out of scope

- E2E browser automation (no existing harness).
- Apple ITP edge cases beyond manual Safari check.

## Risk & Mitigation

- **Risk:** Users with both popups blocked AND One Tap unavailable (3rd-party cookies disabled, FedCM off, prior dismissal cooldown) lose the Google fallback path.
  - **Mitigation:** Apple and email/password sign-in remain available. Sign-in screen surfaces those clearly when GIS fails.
- **Risk:** Apple JS popup can be blocked by some browsers.
  - **Mitigation:** Triggered from a direct user click; `popup_closed_by_user` handled silently. Worst-case fallback: email/password.
- **Risk:** `usePopup: true` on AppleID.auth.init may be denied by some Safari configurations.
  - **Mitigation:** Surface the error message; document the redirect-flow alternative as a follow-up if telemetry shows real-world failures.
