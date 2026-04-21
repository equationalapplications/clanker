# Optimistic Terms Acceptance Pattern

## Decision

- Use optimistic acceptance: navigate immediately after user accepts terms.
- Do not block on forced auth-token refresh.

## Why

Terms acceptance is a legal/compliance state, not an auth boundary.
Security is enforced by callable handlers and backend services backed by Cloud SQL,
not by delaying client navigation.

Benefits:
- Better UX (no blocking wait/spinner)
- Works with intermittent/offline connectivity
- Simpler client logic and fewer edge cases
- Removes forced-refresh bottlenecks

## Flow

1. User taps Accept.
2. Client writes acceptance asynchronously via the `acceptTerms` callable.
3. Client immediately continues into the app.
4. Subscription state is reflected on the next bootstrap/state refresh.
5. Protected callable/service operations validate terms/subscription state.

## Implementation

### Client

- Keep a local optimistic accepted flag for current session.
- Use local accepted state before bootstrap subscription state when deciding whether to gate terms UI.

### Client-Side (`useSubscriptionStatus`)

```typescript
// Local state tracks optimistic acceptance
const [localTermsAccepted, setLocalTermsAccepted] = useState(false)

// Check local optimistic state first, then bootstrap subscription state.
if (localTermsAccepted) {
  // User accepted this session, let them through
  return { needsTermsAcceptance: false }
}

// Otherwise check `subscription.termsVersion` / `subscription.termsAcceptedAt`...
```

### Accept Action

```typescript
const onPressAccept = async () => {
  // Write terms acceptance via termsMachine actor (async)
  termsService.send({ type: 'ACCEPT_TERMS' })

  // Immediately proceed (optimistic)
  onAccepted?.() // Navigation happens instantly
}
```

### Persistence

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

On the backend, `acceptTerms` is a Firebase callable (`enforceAppCheck: true`) that
resolves the current Cloud SQL user and updates `subscriptions.termsVersion` plus
`subscriptions.termsAcceptedAt` through `subscriptionService.acceptTerms(...)`.

## Server Enforcement

Enforce terms at request/data boundaries.

### Callable + Service Layer

```typescript
// Callable handlers enforce auth + App Check, then use Cloud SQL-backed services.
// Terms fields are stored on `subscriptions` and checked by business logic.
if (!subscription || !subscription.termsAcceptedAt || !subscription.termsVersion) {
  throw new HttpsError('failed-precondition', 'Terms acceptance required')
}
```

## Failure Model

- If async callable write fails, user may proceed briefly, but protected backend actions
  can reject until terms are persisted in Cloud SQL.
- Prompt retry when callable/service checks deny due to missing current terms.
- Subsequent bootstrap/state refresh reflects accepted terms without forced re-auth.

## Test Focus

- Accept -> immediate navigation (no blocking refresh).
- Offline/intermittent network -> eventual callable success + Cloud SQL consistency.
- Write failure -> protected callable/service denial + recovery path.
- Bootstrap refresh -> terms state converges after successful acceptance.

## References

- [NAVIGATION.md](./NAVIGATION.md) - Updated with optimistic flow
- [Optimistic UI Pattern](https://www.patterns.dev/posts/optimistic-ui) - Design pattern explanation

