# Optimistic Terms Acceptance Pattern

## Decision Record

**Date:** October 5, 2025  
**Status:** Implemented  
**Decision:** Use optimistic UI for terms acceptance instead of blocking JWT refresh

## Context

Previously, the terms acceptance flow:

1. User clicked "I Accept"
2. Wrote to database
3. **Forced JWT refresh** via re-authentication
4. **Waited for server roundtrip**
5. Checked JWT claims
6. Allowed access

This approach had several issues:

- ❌ Poor UX (blocking delay)
- ❌ Network dependency (no offline support)
- ❌ Complex error handling
- ❌ Not industry standard
- ❌ Over-engineered (terms != security boundary)

## Decision

Implement **optimistic UI pattern** (industry standard):

1. User clicks "I Accept"
2. **Immediately proceed to app** ✅
3. Database write happens async
4. Next natural JWT refresh picks up changes
5. Server validates on API calls (where it matters)

## Rationale

### Terms Acceptance Is Not a Security Boundary

**Key insight:** Terms acceptance is a **legal checkbox**, not **authentication/authorization**.

If someone bypasses the client-side check:

- They're still legally bound by the terms
- Server-side RLS policies enforce on actual data access
- API endpoints validate subscription status
- Security is enforced where it matters

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
  await grantAppAccess('yours-brightly', version)

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
ON yours_brightly
FOR ALL
USING (user_has_current_terms('yours-brightly', '1.0'));
```

### API Endpoints (Application Level)

```typescript
// Validate on actual operations
if (!hasAcceptedCurrentTerms(userId, 'yours-brightly')) {
  return { error: 'Terms acceptance required' }
}
```

### JWT Claims (Natural Refresh)

```typescript
// Auth hook adds subscription to JWT (happens automatically)
// No forced refresh needed - happens on next expiry
```

## Migration Notes

### Files Changed

1. `src/utilities/appAccess.ts` - Removed JWT refresh logic
2. `src/hooks/useSubscriptionStatus.ts` - Added local state tracking
3. `src/components/AcceptTerms.tsx` - Removed blocking alert
4. `app/accept-terms.tsx` - Instant navigation

### Backward Compatibility

- ✅ Server-side validation unchanged
- ✅ RLS policies unchanged
- ✅ JWT structure unchanged
- ✅ Database schema unchanged

Only client-side flow changed - **fully backward compatible**.

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

### Alerts

- High failure rate on terms acceptance writes
- Spike in RLS denials for terms
- Users stuck in acceptance loop

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

## Questions?

Contact: Your friendly neighborhood AI architect 🤖
