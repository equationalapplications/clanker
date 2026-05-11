# Google Sign-In FedCM Button Migration — Design

**Date:** 2026-05-11
**Status:** Implemented
**Supersedes (web Google portion):** [2026-05-07 Auth Provider Hardening](./2026-05-07-auth-provider-hardening-design.md)

## Problem

Web Google sign-in currently uses Google Identity Services (GIS) `google.accounts.id.prompt()` (One Tap). After GIS rolled out FedCM defaults, this surfaces a dev-mode `LogBox` modal in the Expo web client:

```
[GSI_LOGGER]: FedCM get() rejects with AbortError: signal is aborted without reason
```

Triggered by GIS when the FedCM dialog has nothing to show (e.g. the user has no Google session in this Chrome profile, or third-party sign-in restrictions are in effect). The error is benign in production (no LogBox), but Expo Router's `consoleErrorMiddleware` elevates any `console.error` to a modal in development, which is disruptive while testing on `localhost:8081`.

Per the [GIS FedCM migration guide](https://developers.google.com/identity/gsi/web/guides/fedcm-migration), our current code also uses methods that are being removed:

- `notification.isNotDisplayed()` — being removed.
- `notification.isSkippedMoment()` — kept, but `getSkippedReason()` is being removed.

When FedCM becomes mandatory, the `isNotDisplayed`/`isSkippedMoment` branches in [src/auth/googleSignin.web.ts](../../src/auth/googleSignin.web.ts) will never fire, and a user with no Google session will hit the 180-second prompt timeout instead of an immediate "unavailable" path.

A separate, related defect was discovered in native Google sign-in: in v16 of `@react-native-google-signin/google-signin`, `GoogleSignin.signIn()` returns a discriminated union `{ type: 'cancelled', data: null }` for cancellations instead of throwing a `SIGN_IN_CANCELLED` error. [src/auth/googleSignin.ts](../../src/auth/googleSignin.ts) did not check `response.type`, so cancelled sign-ins fell through to the `idToken` check and returned `{ success: false, error: 'No ID token received from Google' }` instead of `{ success: false, cancelled: true }` — surfacing a confusing error alert instead of silently dismissing. Fixed in PR #381.

## Goals

- Replace the One Tap `prompt()` flow on web with the FedCM-native rendered button (`google.accounts.id.renderButton(..., { ..., use_fedcm_for_button: true })`).
- Remove the deprecated `isNotDisplayed()` / `isSkippedMoment()` / dismissed-moment plumbing and the 180s timeout it required.
- Eliminate the dev-mode LogBox modal triggered by GIS-level `console.error` calls without hiding genuine application errors.
- Fix native Google sign-in to handle the v16 discriminated union response from `GoogleSignin.signIn()` so cancellations are correctly flagged with `cancelled: true`.
- Stop logging the full Google ID token response in `console.log`.

## Non-Goals

- One Tap on Android via `GoogleOneTapSignIn` (Credential Manager). Cancelled — `GoogleOneTapSignIn` requires the premium tier of `@react-native-google-signin/google-signin`; the open-source v16 package does not export it. Android continues to use `GoogleSignin.signIn()` with correct v16 response handling.
- Server-side ID token verification.
- Replacing `@react-native-google-signin/google-signin` with another SDK.
- Any change to the Apple sign-in path (web or native).
- Sign-out flow changes.
- Adopting passkeys.
- Automated browser e2e harness.

## Architecture

### Phase 1 (this spec, JS-only, OTA-eligible)

```
┌─────────────────────────────────────────────────────────────┐
│ app/sign-in.tsx                                             │
│   Web:                                                      │
│     <GoogleSignInButton.web />  (renders GIS native button) │
│     <ProviderButton type="apple" />  (unchanged)            │
│   iOS / Android:                                            │
│     <ProviderButton type="google" />  (unchanged)           │
│     <Apple native button>                                   │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ web Google: GIS callback fires directly
                         │ (no SIGN_IN event, no signingIn state)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ src/auth/googleSignin.web.ts                                │
│   initializeGoogleSignIn(handlers)                          │
│     → google.accounts.id.initialize({                       │
│         client_id, callback: handleCredential,              │
│         use_fedcm_for_button: true,                         │
│         auto_select: false,                                 │
│         itp_support: true,                                  │
│       })                                                    │
│   renderGoogleSignInButton(container, options?)             │
│     → google.accounts.id.renderButton(container, {...})     │
│   handleCredential({ credential: idToken })                 │
│     → onCredentialStart()                                   │
│     → signInWithCredential(auth, GoogleAuthProvider         │
│         .credential(idToken, null))                         │
│     → syncDisplayNameFromCredential(user)                   │
│     → onCredentialSuccess() | onCredentialError(error)      │
│     → Firebase onAuthStateChanged → USER_FOUND in machine   │
└─────────────────────────────────────────────────────────────┘

iOS / Android Google (unchanged structure, fixed bugs):
┌─────────────────────────────────────────────────────────────┐
│ <ProviderButton> press → SIGN_IN event → authMachine        │
│   .signingIn → signInProvider actor → signInWithGoogle()    │
│   (native @react-native-google-signin)                      │
│     - Check response.type === 'cancelled' (v16 union)       │
│     - Replace full-response console.log with redacted log   │
└─────────────────────────────────────────────────────────────┘
```

### Key shape decisions

- The web Google flow no longer enters the auth machine's `signingIn` state. GIS owns the click, the credential exchange runs inside the GIS callback, and `onAuthStateChanged` drives the machine through `bootstrapping → signedIn` exactly as it does today after a refresh-page sign-in.
- The `signingIn` state remains for: web Apple, iOS Apple, iOS Google, Android Google. Only **web Google** is removed from that path.
- A small UI-local state inside `<GoogleSignInButton.web />` tracks `idle | loading | error` so the Apple button can be disabled while a Google credential exchange is in flight.

## Components & Changes

### `src/auth/googleSignin.web.ts` (rewrite)

- `initializeGoogleSignIn(handlers: { onCredentialStart, onCredentialSuccess, onCredentialError }): Promise<void>`
  - Lazy-loads `https://accounts.google.com/gsi/client` (single inflight promise).
  - Calls `google.accounts.id.initialize({ client_id: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, callback: handleCredential, use_fedcm_for_button: true, auto_select: false, itp_support: true })`.
  - Stores the handlers in module scope; subsequent calls overwrite handlers (last component to mount wins, which is fine for the single sign-in screen).
  - Rejects with a clear message when the client ID is missing, when the script fails to load, or when `window.google.accounts.id` never appears.
- `renderGoogleSignInButton(container: HTMLElement, options?: { theme?, size?, text?, shape?, width? }): void`
  - Calls `google.accounts.id.renderButton(container, { type: 'standard', theme: options?.theme ?? 'filled_blue', size: options?.size ?? 'large', text: options?.text ?? 'signin_with', shape: options?.shape ?? 'rectangular', logo_alignment: 'left', width: options?.width })`.
- Internal `handleCredential(response)`:
  - If `response?.credential` is missing, invokes `onCredentialError(new Error('No credential received'))` and returns.
  - Invokes `onCredentialStart()`.
  - Awaits `signInWithCredential(auth, GoogleAuthProvider.credential(response.credential, null))`.
  - Awaits `syncDisplayNameFromCredential(user)`; failures are caught and logged via `console.warn` (do not surface as sign-in failure).
  - Invokes `onCredentialSuccess()`. On any thrown error from `signInWithCredential`, invokes `onCredentialError(error)`.
- Removed exports: `signInWithGoogle()`.
- Removed code: `prompt()` invocation, the 180s prompt-settle timeout, `isDismissedMoment` + `getDismissedReason` + `credential_returned` race handling, `isNotDisplayed()` and `isSkippedMoment()` branches.
- Kept exports: `resetGoogleSignInWebForTests()` for jest.

### `src/auth/GoogleSignInButton.web.tsx` (NEW)

```ts
type GoogleSignInButtonProps = {
  onLoadingChange?: (loading: boolean) => void
}
```

- Owns a `useRef<HTMLDivElement>` container and local state `'idle' | 'loading' | 'error'`.
- On mount: `await initializeGoogleSignIn({ onCredentialStart, onCredentialSuccess, onCredentialError })`, then `renderGoogleSignInButton(ref.current!)`.
- `onCredentialStart` → state `'loading'`, `onLoadingChange(true)`.
- `onCredentialSuccess` → state `'idle'`, `onLoadingChange(false)`.
- `onCredentialError(error)` → state `'error'`, `onLoadingChange(false)`, render an inline `<Text>` caption: `Sign-in failed. Please try again.`
- If `initializeGoogleSignIn` rejects: state `'error'`, render the disabled fallback `<ProviderButton type="google">` (matches existing visuals) with caption: `Google Sign-In unavailable. Please refresh or try Apple.`
- The visible container is a React Native `<View>` that wraps a real DOM `<div>` ref via `react-native-web`'s `View` renders to a `div`; we attach the ref directly to that node.

### `src/auth/GoogleSignInButton.tsx` (NEW, native shim)

- Re-exports a React component that wraps the existing `<ProviderButton type="google">` and dispatches `authService.send({ type: 'SIGN_IN', provider: 'google' })` on press.
- Lets `app/sign-in.tsx` import a single symbol regardless of platform.

### `src/auth/googleSignin.ts` (native, modified) — shipped PR #381

- After `await GoogleSignin.signIn()`, check `response.type === 'cancelled'` and return `{ success: false, cancelled: true, error: 'Sign-in was cancelled' }` immediately (v16 returns a discriminated union for cancellations; no longer throws `SIGN_IN_CANCELLED`).
- Access `response.data.idToken` directly on the narrowed `SignInSuccessResponse` type (no cast fallback).
- Downgrade `syncDisplayNameFromCredential` failure logging from `console.error` to `console.warn`.
- Replace full-response `console.log` with `console.log('🔍 Google Sign-In response received (idToken redacted)')`.
- `statusCodes.SIGN_IN_CANCELLED` in the outer `catch` block is now dead code for cancellations but is retained as defence-in-depth; `IN_PROGRESS` and `PLAY_SERVICES_NOT_AVAILABLE` continue to be thrown and caught there.

### `src/machines/authMachine.ts` (modified)

- The `signInProvider` actor still accepts `'google' | 'apple'`, but on web it is invoked only for `'apple'`. The web Google branch in the actor is unreachable; the actor itself stays unchanged because removing the branch on web only would force a platform conditional inside the machine, which complicates testing. The actor remains symmetric across platforms.
- Cancellation handling: when a sign-in result has `cancelled: true` (native Google) or indicates user dismissal (Apple), the `signInProvider` actor throws an error tagged with `__userCancelledSignIn = true`. The `signingIn.onError` handler checks this flag and sets `context.error = null`, so the machine transitions to `signedOut` without surfacing an error. This applies to native Google and Apple cancellations.

### `app/sign-in.tsx` (modified)

- Import the platform-split `GoogleSignInButton`.
- Replace `<ProviderButton type="google" onPress={GoogleLoginOnPress} ...>` with `<GoogleSignInButton onLoadingChange={setGoogleBusy} />`.
- Track `googleBusy` state with `useState(false)`. Pass `disabled={isLoading || googleBusy}` to the Apple button.
- Remove the `GoogleLoginOnPress` handler on web (kept on native via the `GoogleSignInButton.tsx` shim).

### `src/utilities/devConsoleFilters.web.ts` (NEW)

- Named export `installGoogleIdentityConsoleFilter(): void`.
- In production (`__DEV__ === false`) it returns immediately.
- In development it wraps `console.error` once: if the first argument is a string starting with `[GSI_LOGGER]` or equal to `Provider's accounts list is empty.`, the call is redirected to `console.warn` (so it still appears in the console for debugging but does not trigger Expo Router's `LogBox` modal). All other calls pass through unchanged.

### `src/hooks/useInitializeApp.web.ts` (modified)

- Call `installGoogleIdentityConsoleFilter()` once at app startup, before `initializeGoogleSignIn` is reachable. (`initializeGoogleSignIn` itself is no longer called at startup; it is called by `<GoogleSignInButton.web />` on mount.)
- The startup-time call to `initializeGoogleSignIn()` (without handlers) is removed because the component now owns initialization.

## Data Flow

### Web Google (new)

1. `app/sign-in.tsx` mounts → renders `<GoogleSignInButton.web />`.
2. Component calls `initializeGoogleSignIn(handlers)` → script load → `google.accounts.id.initialize(...)`.
3. Component calls `renderGoogleSignInButton(containerRef.current!)` → GIS injects its native button into the container.
4. User clicks the GIS button → browser shows the FedCM account chooser.
5. User selects an account → GIS invokes `handleCredential({ credential: idToken })`.
6. `handleCredential`:
   - `onCredentialStart()` (component goes `loading`, Apple disabled).
   - `signInWithCredential(auth, GoogleAuthProvider.credential(idToken, null))`.
   - `syncDisplayNameFromCredential(user)` (failure logged via `console.warn`).
   - `onCredentialSuccess()` (component goes `idle`).
7. Firebase `onAuthStateChanged` → `USER_FOUND` → `bootstrapping → signedIn`.
8. `app/sign-in.tsx`'s existing redirect effect navigates to the post-auth route.

### Web Apple (unchanged)

User clicks Apple → `SIGN_IN` event → `signInProvider({ provider: 'apple' })` → `signInWithApple()` → AppleID popup → ID token + nonce → `signInWithCredential` → `syncDisplayNameFromCredential` → `USER_FOUND`. Cancellation: `signInWithApple()` returns `{ success: false, error: 'Sign-in cancelled' }` (no `cancelled` flag on `AppleSignInResult`); the `signInProvider` actor throws an error tagged with `__userCancelledSignIn = true`, which is caught by `signingIn.onError` and maps to `context.error = null` → `signedOut` with no visible error.

### iOS Google (unchanged shape, fixed bugs)

User clicks Google → `SIGN_IN` → `signInProvider({ provider: 'google' })` → `signInWithGoogle()` (native) → `GoogleSignin.signIn()` → Firebase credential. Cancellation now correctly maps via `statusCodes.SIGN_IN_CANCELLED` to `{ success: false, cancelled: true }`; the `signInProvider` actor throws an error tagged with `__userCancelledSignIn = true`, which is caught by `signingIn.onError` and maps to `context.error = null` → `signedOut` with no alert.

### Android Google (unchanged shape, fixed bugs)

Same as iOS Google. Android continues to use `GoogleSignin.signIn()` with correct v16 discriminated union handling.

### Sign-out (unchanged)

No change.

## Error Handling

### Web Google

| Failure | Surface | Auth machine effect |
|---|---|---|
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` missing | Component `error` state. Disabled `<ProviderButton type="google">` with caption `Google Sign-In unavailable. Please refresh or try Apple.` Logged via `console.warn`. | None. |
| GIS script load failure | Same as above. | None. |
| `google.accounts.id.initialize` throws | Same as above. | None. |
| `renderButton` throws | Same as above. | None. |
| User dismisses FedCM dialog without selecting | No callback fires. UI stays idle; user can click again. | None. |
| FedCM `AbortError` / "Provider's accounts list is empty" | GIS may log `[GSI_LOGGER]` warnings. The dev console filter redirects matching `console.error` calls to `console.warn`, suppressing the `LogBox` modal. UI stays idle. | None. |
| `signInWithCredential` rejects | `onCredentialError(error)` → component `error` state with inline caption `Sign-in failed. Please try again.` Detailed error logged via `console.warn`. | None. |
| `auth/account-exists-with-different-credential` | Same as above; caption: `An account with that email already exists with a different sign-in method.` | None. |
| `syncDisplayNameFromCredential` throws | Logged via `console.warn`; sign-in still succeeds. | None. |

### Web Apple (unchanged)

- `popup_closed_by_user` → `{ success: false, error: 'Sign-in cancelled' }` → actor throws with `__userCancelledSignIn` → `signingIn.onError` sets `context.error = null` → `signedOut`, no alert.
- Other errors → throw → `Alert.alert('Sign-in failed', error.message)`.

### Native Google (with bug fix)

- `statusCodes.SIGN_IN_CANCELLED` → `{ success: false, cancelled: true }` → actor throws with `__userCancelledSignIn` → `signingIn.onError` sets `context.error = null` → `signedOut`, no alert.
- `statusCodes.IN_PROGRESS` → throws → `Alert.alert`.
- `statusCodes.PLAY_SERVICES_NOT_AVAILABLE` → throws → `Alert.alert`.
- All other errors → throws → `Alert.alert`.

### iOS Apple (unchanged)

- `ERR_REQUEST_CANCELED` → `{ success: false, error: 'Sign-in was cancelled' }` → actor throws with `__userCancelledSignIn` → `signingIn.onError` sets `context.error = null` → `signedOut`, no alert.
- Other errors → throws → `Alert.alert`.

### Bootstrap / sign-out (unchanged)

Out of scope.

## Testing

### Unit (jest)

- `src/auth/__tests__/googleSignin.web.test.ts` (rewrite)
  - `initializeGoogleSignIn` injects the GIS script tag once and calls `google.accounts.id.initialize` with the documented FedCM-friendly options (`use_fedcm_for_button: true, auto_select: false, itp_support: true`).
  - Multiple `initializeGoogleSignIn` calls do not duplicate the `<script>` tag.
  - `initializeGoogleSignIn` rejects when the client ID env var is missing, when script onerror fires, and when the script loads but `window.google.accounts.id` never appears.
  - `renderGoogleSignInButton(container)` calls `google.accounts.id.renderButton` with the container and the documented default options.
  - When the GIS callback fires with `{ credential: idToken }`: `GoogleAuthProvider.credential(idToken, null)`, then `signInWithCredential(auth, cred)`, then `syncDisplayNameFromCredential(user)` are called in order, and `onCredentialStart` then `onCredentialSuccess` fire.
  - When `signInWithCredential` rejects: `onCredentialError(error)` is invoked; `onCredentialSuccess` and `syncDisplayNameFromCredential` are not.
  - When `syncDisplayNameFromCredential` rejects: `onCredentialSuccess` still fires.
  - Removed: prompt-notification tests, dismissed-moment tests, `credential_returned` race tests, 180s timeout tests.

- `src/auth/__tests__/googleSignin.test.ts`
  - Mocks `@react-native-google-signin/google-signin` with v16 response shapes.
  - Cancellation: `signIn` resolves `{ type: 'cancelled', data: null }` → `{ success: false, cancelled: true, error: 'Sign-in was cancelled' }`.
  - In-progress: `signIn` throws with code `IN_PROGRESS` → `{ success: false, error: 'Sign in is already in progress' }`, `cancelled` is `undefined`.
  - Play-services: `hasPlayServices` or `signIn` throws with code `PLAY_SERVICES_NOT_AVAILABLE` → `{ success: false, error: 'Play services not available or outdated' }`.
  - Successful sign-in: `signIn` resolves `{ type: 'success', data: { idToken, user } }`; `signInWithCredential` called with the Google credential; `syncDisplayNameFromCredential` called with derived display name; result is `{ success: true }`.
  - Asserts no `console.log` call in the success path contains the raw idToken.

- `src/auth/__tests__/GoogleSignInButton.web.test.tsx` (NEW, jsdom)
  - On mount, calls `initializeGoogleSignIn` then `renderGoogleSignInButton(containerEl)`.
  - When `initializeGoogleSignIn` rejects, renders the disabled fallback button with the unavailable caption.
  - When `onCredentialStart` fires, `props.onLoadingChange(true)` is called; when `onCredentialSuccess` fires, `props.onLoadingChange(false)` is called.
  - When `onCredentialError` fires, `props.onLoadingChange(false)` is called and an inline error caption is rendered.

- `src/utilities/__tests__/devConsoleFilters.web.test.ts` (NEW)
  - When installed, `console.error('[GSI_LOGGER]: foo')` does not propagate to the wrapped sink.
  - When installed, `console.error("Provider's accounts list is empty.")` does not propagate.
  - When installed, `console.error('Some real error')` propagates unchanged.
  - Filter is a no-op when `__DEV__ === false`.

- `__tests__/authMachine.test.ts`
  - Existing "ignores cancelled sign-in attempts without surfacing an error" test stays.
  - No new tests required; the `signInProvider` actor shape is unchanged.

- `__tests__/signInRedirect.test.tsx`
  - Verify still passes; no edits expected.

### Integration smoke matrix (manual, pre-merge)

- Web Chrome (FedCM-capable, signed-in Google account in profile): rendered button click → account chooser → signed in → no `LogBox` modal in dev.
- Web Chrome (no Google account in profile): rendered button click → "no accounts available" UI from FedCM → no `LogBox` modal.
- Web Safari (FedCM not yet enabled by default): rendered button click → falls back to Google's hosted account chooser → signed in.
- Web with `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` deliberately blanked: button shows disabled fallback with caption.
- iOS: Google + Apple still sign in. Cancel each one → no alert modal.
- Android: Google still signs in. Cancel → no alert modal.

### Out of scope

- Automated browser e2e (no harness exists).
- Behavior in browsers older than Chrome 117 (Apple stays available).

## Configuration

No Firebase or Google Cloud project changes are required by this spec. Verify (one-time) that the Web OAuth 2.0 Client ID matching `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` lists the dev origin under **Authorized JavaScript origins** in Google Cloud Console:

- `http://localhost:8081`
- Any other dev port in use
- Production web origin(s)

The GIS rendered button flow does not require **Authorized redirect URIs** beyond what Firebase Hosting auto-configures.

## Risk & Mitigation

- **Risk:** The GIS rendered button visually differs from the existing custom branded `<ProviderButton type="google">` on web.
  - **Mitigation:** The rendered button is the Google-recommended visual and is what users see on most large sites; this is intentional. The fallback (when GIS fails to initialize) renders our existing custom button, preserving visual continuity for the failure case.
- **Risk:** Web Google sign-in skips the `signingIn` state, which currently triggers spinners on the Apple button via `state.matches('signingIn')`.
  - **Mitigation:** `<GoogleSignInButton.web />`'s `onLoadingChange` callback drives a `googleBusy` state in `app/sign-in.tsx` that disables the Apple button while a Google credential exchange is in flight.
- **Risk:** The dev console filter could mask a future legitimate GIS error.
  - **Mitigation:** The filter only redirects matching messages from `console.error` to `console.warn` — they remain visible in the browser console; only the dev `LogBox` modal is suppressed. The filter is gated on `__DEV__` so production behavior is unchanged.
- **Risk:** Older browsers without FedCM support may still show Google's account chooser inside a popup that some configurations block.
  - **Mitigation:** Apple sign-in remains available as the primary alternative.

## Cancelled: Android One Tap (GoogleOneTapSignIn)

`GoogleOneTapSignIn` (Credential Manager API) is gated behind the premium tier of `@react-native-google-signin/google-signin`. The open-source v16 package does not export it. This was evaluated as Phase 2 of this spec but was cancelled when the premium license requirement was identified. Android uses `GoogleSignin.signIn()` with correct v16 discriminated union handling (PR #381).
