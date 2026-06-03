# Authentication

## Source of Truth

Firebase Auth is the canonical identity provider. Cloud SQL stores app-level user and subscription state, returned by the `exchangeToken` bootstrap callable. Firebase holds identity; Cloud SQL holds everything the app cares about beyond identity.

---

## Auth Flow: Firebase → Cloud SQL Bootstrap

### High-level contract

- **Inputs**: Caller must be authenticated with Firebase Auth (callable receives `request.auth`). No extra ID token is required from the client.
- **Outputs**:
  - On success: `{ user, subscription }` from Cloud SQL.
  - Error modes: `unauthenticated`, `failed-precondition` (missing token email), `internal`.

### Sequence

1. Client signs in with Firebase Auth.
2. Client calls callable `exchangeToken` in `us-central1`.
3. `exchangeToken` validates `request.auth` and token UID consistency.
4. Function finds or creates user in Cloud SQL from Firebase identity (`firebaseUid`, `email`).
5. Function loads subscription row for that user.
6. If no subscription exists, function creates default free-tier state:
   - `planTier: free`
   - `planStatus: active`
   - `currentCredits: 50`
7. Function returns normalized bootstrap payload: `user` snapshot + `subscription` snapshot.
8. Client stores/uses this bootstrap state via `getUserState()` and related app services.

### Bootstrap response shape

```json
{
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid",
    "email": "user@example.com",
    "displayName": "Name",
    "avatarUrl": null,
    "isProfilePublic": false,
    "defaultCharacterId": null,
    "createdAt": "2026-04-20T12:00:00.000Z",
    "updatedAt": "2026-04-20T12:05:00.000Z"
  },
  "subscription": {
    "planTier": "free",
    "planStatus": "active",
    "currentCredits": 50,
    "termsVersion": null,
    "termsAcceptedAt": null
  }
}
```

### Required environment variables (Cloud Functions)

- `CLOUD_SQL_CONNECTION_NAME`
- `CLOUD_SQL_DB_USER`
- `CLOUD_SQL_DB_PASS`
- `CLOUD_SQL_DB_NAME`

### Related billing secrets (webhooks)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `REVENUECAT_WEBHOOK_SECRET`

### Security considerations

- Do not expose Cloud SQL credentials to clients.
- Callable functions must require authentication (`request.auth` must exist).
- Gen 2 callable functions handle CORS automatically. If browser preflight fails, check Cloud Run invoker IAM first.
- Keep the underlying Cloud Run service publicly invokable (`allUsers` with `roles/run.invoker`) so unauthenticated browser preflight requests can reach the callable CORS handler.
- Rotate database and billing secrets on a secure schedule and update function secrets/env.

### Troubleshooting

- `unauthenticated`: client is not signed into Firebase, or callable invoked without auth context.
- `Firebase user email is required`: sign-in provider did not yield a usable email claim.
- `Failed to bootstrap user`: inspect `exchangeToken` logs for Cloud SQL/user-repository errors.
- Credits/subscription state looks stale: verify Stripe/RevenueCat webhook deliveries and Cloud Function logs for subscription/credit mutations.

### Migration note

Legacy third-party session exchange and JWT-claims-based auth are removed from the active client auth path. This document describes the current Cloud SQL bootstrap flow only.

---

## Auth Cache Management

### Sign Out Flow

When a user signs out, the following happens in order:

1. **Firebase Sign Out** — Clear Firebase auth state.
2. **React Query Cache Clear** — Clear all cached data (`queryClient.clear()`).
3. **Auth Manager Reset** — Reset internal auth state (`authManager.reset()`).

```typescript
import { signOut } from '~/config/firebaseConfig'

const handleSignOut = async () => {
  await signOut()
  setUser(null)
  queryClient.clear() // Critical for offline support
  authManager.reset()
}
```

### Why Clear Cache on Sign Out?

With offline support, the app caches user-specific data (characters, messages, profile) for up to 30 minutes. Without clearing the cache on sign out:

1. **Privacy Risk**: Next user could see previous user's cached data.
2. **Data Corruption**: Cached data could be associated with wrong user.
3. **Stale Sessions**: Old auth/session state could remain in cache.

`queryClient.clear()` ensures all cached queries are removed, all pending mutations are cancelled, and no stale data persists between sessions.

### Cache Invalidation on Navigation

When navigating between screens, React Query automatically:

1. Serves cached data immediately — no loading spinner on back navigation.
2. Refetches in background — updates stale data without blocking UI.
3. Invalidates on mutations — character updates trigger list refetch.

### Testing Cache Clearing

**Manual test:**

1. Sign in as User A, create characters, navigate through app (populate cache).
2. Sign out.
3. Sign in as User B.
4. Verify no User A data is visible (characters, messages, profile).

**Debugging cache issues:**

```typescript
import { queryClient } from '~/config/queryClient'

// Inspect cache contents
console.log(
  'Cache keys:',
  queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey),
)

// Manually clear if needed
queryClient.clear()
```

---

## Provider Name Sync

The app captures and persists user names from social providers during sign-in:

- **Apple (native iOS)**: reads `FULL_NAME` from Authentication Services on first authorization and stores it on the Firebase user profile.
- **Apple (web)**: requests `name` scope and persists returned profile name to Firebase when available.
- **Google (native)**: backfills Firebase `displayName` from Google profile payload when Firebase does not populate it automatically.

After authentication, the app syncs Firebase identity fields into the Cloud SQL `users` profile, **preserving user customizations**:

- Fills `display_name` only when it is currently empty.
- Fills `email` only when it is currently empty.
- Fills `avatar_url` only when it is currently empty.

### Profile UI behavior

The profile header renders:

- Bold display name line only when a name exists.
- Email line below the name when email exists.
- No duplicate email-as-name fallback.

### Why this matters

- Meets Sign in with Apple UX expectations by retaining user-provided name.
- Ensures consistent identity display across provider types.
- Avoids overwriting user-edited profile values after first sync.

---

## Bootstrap Event-Driven Refresh

### Summary

Auth bootstrap state (`user`, `subscription`, `credits`, `terms`) is refreshed via an event-driven model. Interval polling has been removed from `useUserCredits`, `useUserProfile`, `useUserPublicData`, and `useUserPrivateData`.

### Architecture

1. `authMachine` owns refresh intent and refresh metadata.
2. `REFRESH_BOOTSTRAP` requires a reason payload:
   - `purchase`
   - `restore`
   - `manual`
   - `terms`
   - `foreground`
3. Refresh dedupe and queue-once replay are handled in machine state, not UI code.
4. App foreground events are bridged to auth state with staleness gating.
5. Terms acceptance dispatches `TERMS_ACCEPTED_LOCAL` (local snapshot patch) instead of forcing an immediate bootstrap round-trip.
6. Chat/image usage paths dispatch `USAGE_SNAPSHOT_RECEIVED` so credits/plan can reconcile from callable-verified data without polling.

### Refresh Semantics

**Throttle:**
- Identical reasons are throttled within 2 seconds.
- `purchase`, `restore`, and `manual` bypass the identical-reason throttle.

**While bootstrapping:**
- Additional refresh requests are not dropped.
- Incoming reasons are collapsed into one pending reason with priority:
  1. `purchase` / `restore`
  2. `manual`
  3. `foreground` / `terms`

**Replay:**
- After bootstrap completes, one replay bootstrap runs when a pending reason exists and differs from the last completed reason.

### Lifecycle Reconciliation

- App lifecycle bridge dispatches `APP_FOREGROUNDED` when the app becomes active.
- Auth state owner triggers a foreground refresh only when snapshot staleness exceeds 5 minutes.

### Local Snapshot Patch Events

| Event | Effect |
|---|---|
| `TERMS_ACCEPTED_LOCAL` | Updates `subscription.termsVersion` and `subscription.termsAcceptedAt` in memory |
| `DB_USER_PATCHED_LOCAL` | Patches `dbUser` fields in memory |
| `PROFILE_PATCHED_LOCAL` | Patches `dbUser` fields in memory |

### Usage Snapshot Contract

`USAGE_SNAPSHOT_RECEIVED` payload fields:

- `source`: `generateReply` or `generateImage`
- `remainingCredits`: number or `null`
- `planTier`: string or `null`
- `planStatus`: `active` | `cancelled` | `expired` | `null`
- `verifiedAt`: ISO timestamp

**Ordering guard**: incoming usage snapshots only apply when `verifiedAt` is newer than `lastUsageSnapshotAt`.

### Callable Contract

Both `generateReply` and `generateImage` return usage metadata on success:

- `remainingCredits`
- `planTier`
- `planStatus`
- `verifiedAt`

For usage-gating failures (`resource-exhausted`), callable errors include snapshot details in error `details` so clients can reconcile UI without polling.

### Sign-out Hygiene

Sign-out clears:

1. In-memory TanStack Query cache.
2. Persisted query cache via query persister cleanup.

This prevents cross-account stale hydration during user switching.

---

## Cookie Consent

### Scope

Web-only. Native (iOS/Android) is out of scope because the app does not load third-party HTTP cookies in the React Native runtime. Native privacy disclosures are handled via App Store / Play Store data forms and the existing in-app analytics setting.

### Architecture

```
app/_layout.tsx
  └─ CookieConsentProvider (renders on all platforms; canUse() available everywhere)
       ├─ <RootLayoutNav />            (existing)
       ├─ <CookieConsentBanner />      (lower-right, web only)
       └─ <CookiePreferencesModal />   (web only)
```

State lives in React context. Persistence uses `localStorage` under the key `cookie:consent:v1`. `canUse(category)` is the single gate any future analytics/marketing SDK must pass through.

### Schema

| Field | Type | Notes |
|---|---|---|
| `policyVersion` | number | Bump to force re-prompt |
| `consentedAt` | ISO8601 string | When the user chose |
| `expiresAt` | ISO8601 string | `consentedAt` + 365 days |
| `regionMode` | `'opt-in-strict'` | Conservative global default |
| `choices` | `Record<CookieCategory, boolean>` | `necessary` always true |

### UX Rules

- Banner appears bottom-right on web until user makes a choice.
- Accept all and Reject all are equally prominent (one click each).
- Manage preferences opens per-category toggles.
- Footer and Settings expose "Cookie Preferences" for re-opening.

### Region Policy

Conservative default: opt-in-strict for all web traffic. Geo differentiation can be added later by sourcing region at the edge and feeding `regionMode` into the provider; until then everyone gets the strict experience.

### Adding a New Tracker (Mandatory Checklist)

1. Pick a category (`analytics`, `marketing`, or `preferences`).
2. Initialize the SDK only when `useCookieConsent().canUse(category) === true`.
3. Tear down or never load on `false`.
4. Add a test that fails when init runs without consent.
5. Update this doc and `src/config/privacyConfig.ts`.

### QA Checklist

- [ ] First load on `/` shows banner lower-right.
- [ ] Reject all hides banner; reload keeps it hidden.
- [ ] Accept all hides banner; `canUse('analytics')` returns true.
- [ ] Manage preferences opens modal; necessary toggle disabled.
- [ ] Footer "Cookie Preferences" reopens modal.
- [ ] Bumping `COOKIE_POLICY_VERSION` re-prompts on next load.
- [ ] No banner on iOS/Android builds.

---

## Terms Acceptance (Optimistic)

### Decision

Use optimistic acceptance: navigate immediately after user accepts terms. Do not block on forced auth-token refresh.

### Why

Terms acceptance is a legal/compliance state, not an auth boundary. Security is enforced by callable handlers and backend services backed by Cloud SQL, not by delaying client navigation.

Benefits:
- Better UX (no blocking wait/spinner)
- Works with intermittent/offline connectivity
- Simpler client logic and fewer edge cases
- Removes forced-refresh bottlenecks

### Flow

1. User taps Accept.
2. Client writes acceptance asynchronously via the `acceptTerms` callable.
3. Client immediately continues into the app.
4. Subscription state is reflected on the next bootstrap/state refresh.
5. Protected callable/service operations validate terms/subscription state.

### Client Implementation

Keep a local optimistic accepted flag for the current session. Use local accepted state before bootstrap subscription state when deciding whether to gate terms UI:

```typescript
// Local state tracks optimistic acceptance
const [localTermsAccepted, setLocalTermsAccepted] = useState(false)

// Check local optimistic state first, then bootstrap subscription state.
if (localTermsAccepted) {
  return { needsTermsAcceptance: false }
}

// Otherwise check subscription.termsVersion / subscription.termsAcceptedAt...
```

Accept action:

```typescript
const onPressAccept = async () => {
  // Write terms acceptance via termsMachine actor (async)
  termsService.send({ type: 'ACCEPT_TERMS' })

  // Immediately proceed (optimistic)
  onAccepted?.()
}
```

Persistence:

```typescript
import { TERMS } from '~/config/termsConfig'
import { acceptTermsFn } from '~/services/apiClient'

// Use the same app wrapper as production code so App Check readiness is awaited.
export async function recordTermsAcceptance() {
  const response = await acceptTermsFn({ termsVersion: TERMS.version })
  if (response?.data?.success !== true) {
    throw new Error('Malformed accept terms response')
  }
}
```

On the backend, `acceptTerms` is a Firebase callable (`enforceAppCheck: true`) that resolves the current Cloud SQL user and updates `subscriptions.termsVersion` plus `subscriptions.termsAcceptedAt` via `subscriptionService.acceptTerms(...)`.

### Server Enforcement

Enforce terms at request/data boundaries in callable + service layer:

```typescript
if (!subscription || !subscription.termsAcceptedAt || !subscription.termsVersion) {
  throw new HttpsError('failed-precondition', 'Terms acceptance required')
}
```

### Failure Model

- If the async callable write fails, the user may proceed briefly, but protected backend actions will reject until terms are persisted in Cloud SQL.
- Prompt retry when callable/service checks deny due to missing current terms.
- Subsequent bootstrap/state refresh reflects accepted terms without forced re-auth.

### Test Focus

- Accept → immediate navigation (no blocking refresh).
- Offline/intermittent network → eventual callable success + Cloud SQL consistency.
- Write failure → protected callable/service denial + recovery path.
- Bootstrap refresh → terms state converges after successful acceptance.
