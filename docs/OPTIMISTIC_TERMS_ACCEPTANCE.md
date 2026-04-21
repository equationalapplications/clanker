# Optimistic Terms Acceptance Pattern

## Decision

- Use optimistic acceptance: navigate immediately after user accepts terms.
- Do not block on forced JWT refresh.

## Why

Terms acceptance is a legal/compliance state, not an auth boundary.
Security must be enforced on server-side operations, not by delaying client navigation.

Benefits:
- Better UX (no blocking wait/spinner)
- Works with intermittent/offline connectivity
- Simpler client logic and fewer edge cases
- Removes forced-refresh bottlenecks

## Flow

1. User taps Accept.
2. Client writes acceptance asynchronously.
3. Client immediately continues into the app.
4. JWT claims update on natural refresh.
5. Server checks terms/subscription state on protected operations.

## Implementation

### Client

- Keep a local optimistic accepted flag for current session.
- Use local accepted state before token claims when deciding whether to gate terms UI.

### Client-Side (`useSubscriptionStatus`)

```typescript
// Local state tracks optimistic acceptance
const [localTermsAccepted, setLocalTermsAccepted] = useState(false)

// Check local state first, then JWT claims
if (localTermsAccepted) {
  // User accepted this session, let them through
  return { needsTermsAcceptance: false }
}

// Otherwise check JWT claims...
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
export async function recordTermsAcceptance(userId: string) {
  const now = new Date().toISOString()

  // Atomically update terms fields and verify the row exists
  const { data: updatedSubscription, error: updateError } = await supabaseClient
    .from('user_app_subscriptions')
    .update({
      terms_accepted_at: now,
      terms_version: TERMS.version,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('app_name', APP_NAME)
    .select('user_id')
    .maybeSingle()

  if (updateError) throw updateError
  if (!updatedSubscription) {
    throw new Error('Missing subscription row for terms acceptance')
  }
}
```

## Server Enforcement

Enforce terms at request/data boundaries.

### Database (RLS)

```sql
CREATE POLICY "Users must accept current terms"
ON clanker
FOR ALL
USING (user_has_current_terms('clanker', '1.0'));
```

### API

```typescript
// Validate on actual operations
if (!hasAcceptedCurrentTerms(userId, 'clanker')) {
  return { error: 'Terms acceptance required' }
}
```

## Failure Model

- If async write fails, user may proceed briefly, but server enforcement rejects protected actions.
- Prompt retry when server denies due to missing current terms.
- Natural token refresh resolves stale claims without forced re-auth.

## Test Focus

- Accept -> immediate navigation (no blocking refresh).
- Offline/intermittent network -> eventual write + server consistency.
- Write failure -> protected API/RLS denial + recovery path.
- Stale token -> access correct after natural refresh.

## References

- [NAVIGATION.md](./NAVIGATION.md) - Updated with optimistic flow
- [Optimistic UI Pattern](https://www.patterns.dev/posts/optimistic-ui) - Design pattern explanation

