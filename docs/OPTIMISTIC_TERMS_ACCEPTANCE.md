# Optimistic Terms Acceptance Pattern

### Industry Standard Pattern

This is how major platforms handle terms:

- **Stripe Dashboard** - Instant proceed after accept
- **Auth0 Console** - No blocking waits
- **Firebase Console** - Optimistic navigation
- **GitHub Settings** - Trust client, verify server

### Benefits

1. **Better UX**
   - Instant feedback
   - No blocking spinners
   - Feels responsive

2. **Offline Support**
   - Accept terms offline
   - Sync when online
   - Queue writes gracefully

3. **Simpler Code**
   - Less error handling
   - Fewer edge cases
   - More maintainable

4. **Scalable**
   - No forced refresh bottleneck
   - Async writes don't block
   - Better performance

## Implementation

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

### Accept Flow (`AcceptTerms.tsx`)

```typescript
const onPressAccept = async () => {
  // Write to database (async)
  await grantAppAccess('clanker', version)

  // Immediately proceed (optimistic)
  onAccepted?.() // Navigation happens instantly
}
```

### Database Write (`appAccess.ts`)

```typescript
export async function grantAppAccess() {
  // Write subscription to database
  await supabaseClient.from('user_app_subscriptions').upsert({
    terms_accepted_at: new Date().toISOString(),
    terms_version: version,
  })

  // No JWT refresh needed!
  // Next natural refresh will pick it up
  return { success: true }
}
```

## Server-Side Enforcement

Security is enforced where it actually matters:

### RLS Policies (Database Level)

```sql
CREATE POLICY "Users must accept current terms"
ON clanker
FOR ALL
USING (user_has_current_terms('clanker', '1.0'));
```

### API Endpoints (Application Level)

```typescript
// Validate on actual operations
if (!hasAcceptedCurrentTerms(userId, 'clanker')) {
  return { error: 'Terms acceptance required' }
}
```

### JWT Claims (Natural Refresh)

```typescript
// Auth hook adds subscription to JWT (happens automatically)
// No forced refresh needed - happens on next expiry
```

## Testing Considerations

### Test Scenarios

1. **Happy Path**
   - User accepts → proceeds immediately
   - Database write succeeds
   - Next JWT refresh includes subscription

2. **Offline Acceptance**
   - User accepts offline → proceeds
   - Write queued until online
   - Syncs when connection restored

3. **Database Write Failure**
   - User proceeds optimistically
   - Write fails in background
   - Server rejects API call (RLS)
   - User prompted to try again

4. **JWT Validation**
   - Old JWT (no subscription) → RLS blocks
   - User accepts → proceeds
   - API validates → may prompt refresh
   - New JWT (with subscription) → access granted

### Edge Cases Handled

- Network timeout during write → Retry logic
- Database down → User proceeds, fails on API call
- JWT expired → Natural refresh includes update
- Concurrent sessions → Database unique constraint

## Monitoring

### Metrics to Track

1. **Terms acceptance latency** (should be < 100ms client-side)
2. **Database write success rate**
3. **RLS policy denials** (users without terms)
4. **Failed API calls due to terms** (should be rare)

## Future Enhancements

### Potential Improvements

1. **TanStack Query Mutation**
   - Add mutation with automatic retry
   - Optimistic updates built-in
   - Better error handling

2. **Local Persistence**
   - Store acceptance in AsyncStorage
   - Survive app restarts
   - Offline-first support

3. **Background Sync**
   - Queue writes when offline
   - Sync on reconnection
   - Show sync status

## References

- [NAVIGATION.md](./NAVIGATION.md) - Updated with optimistic flow
- [TERMS_ACCEPTANCE_SYSTEM.md](../../equationalapplications.com/docs/TERMS_ACCEPTANCE_SYSTEM.md) - Architectural overview
- [Optimistic UI Pattern](https://www.patterns.dev/posts/optimistic-ui) - Design pattern explanation

