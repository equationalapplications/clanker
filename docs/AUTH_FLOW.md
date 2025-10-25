# Authentication flow (Firebase → Supabase)

High level contract

- Inputs:
  - Caller must be authenticated with Firebase Auth (callable function receives `request.auth`).
  - No extra ID token is required from the client — the callable context is used.
- Outputs:
  - On success: an object containing Supabase session with subscription-enriched JWT claims.
  - Error modes: unauthenticated, failed-precondition (missing env or email), internal (unable to create/find Supabase user or session failure).

Sequence (what happens end-to-end)

1. Client signs in with Firebase Auth (email/password, OAuth, etc.).
2. Client calls the Firebase callable function `exchangeToken` (region `us-central1`) using the Firebase Functions SDK.
3. The cloud function verifies `request.auth` and extracts the Firebase token (`request.auth.token`). It uses the Firebase-authenticated email as the lookup key.
4. The function calls the Supabase Admin APIs to find a user by email (`findSupabaseUserByEmail`).
   - If a Supabase user exists, it uses that user's id.
   - If no user exists, the function calls the Supabase Admin API (using the service role key) to create a user with the same email and records the returned Supabase user id.
5. Using the Supabase user id, the function calls `getSupabaseUserSession(...)` to retrieve an existing Supabase session.
6. **Supabase Auth Hook Enhancement**: When the session is created/refreshed, Supabase automatically calls `custom_access_token_hook` which:
   - Queries `user_app_subscriptions` table for the user's active subscriptions
   - Adds a `plans` array to the JWT claims containing: `app`, `tier`, `status`, `terms_accepted`, `terms_version`
   - Returns JWT with subscription data for access control and terms compliance tracking
7. The function returns the Supabase session (with enriched JWT) to the client.
8. The client receives the session and calls `supabase.auth.setSession(...)` to establish the authenticated session.

Important implementation notes

- **Firebase is the source of truth for identity** — the cloud function trusts the Firebase callable context (`request.auth.token`) and the email inside it.
- **Supabase provides subscription-based access control** — the auth hook automatically adds subscription data to JWTs.
- The cloud function must run in a trusted environment because it uses the Supabase service role key to create users. Keep the service role key out of client code.
- The function expects the Firebase token to include a verified email. If the token has no email, the function returns an error (failed-precondition).
- **Supabase JWT claims include subscription plans** — each JWT contains a `plans` array for multi-tenant access control, feature gating, and terms compliance tracking.
- **Terms version enforcement** — RLS policies require users to have accepted the current version of terms to access application data.

Required environment variables (cloud functions)

- SUPABASE_SERVICE_ROLE_KEY — admin key used to create/list users via the Supabase Admin API.
- SUPABASE_URL — your Supabase project URL.

**Note**: `SUPABASE_JWT_SECRET` is no longer required since we use native Supabase auth with hooks instead of manual JWT creation.

Security considerations

- Do not use the Supabase service role key in any client code. It must only be available to trusted server/cloud environments.
- Ensure callable functions require authentication (the code already throws `unauthenticated` if `request.auth` is missing).
- Limit CORS and origins for the callable function to the set of allowed client hosts (see the function's `cors` list).
- Rotate the SUPABASE_SERVICE_ROLE_KEY and SUPABASE_JWT_SECRET on a secure schedule and update cloud environment variables.

Troubleshooting

- "Authentication required" / unauthenticated: Client is not signed into Firebase or callable is invoked without a Firebase auth context. Confirm `auth.currentUser` exists before calling the function.
- "Firebase user email is required": The Firebase token did not contain a verified email (common for some anonymous or incomplete sign-ins). Ensure your Firebase sign-in method provides an email.
- "Could not find or create a Supabase user": Check function logs for errors from the Supabase Admin API; verify `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are set in the function environment.
- "Failed to get Supabase user session": Check the function's `getSupabaseUserSession` call and Supabase project quotas/limits.
- **Empty `plans` array in JWT**: User has no active subscriptions in `user_app_subscriptions` table. This is normal for new users - applications should handle free tier access or prompt for subscription.
- **Auth hook not working**: Ensure the `custom_access_token_hook` is enabled in Supabase Dashboard (Authentication > Hooks) and has correct permissions.
- **Terms version mismatch**: Users with outdated terms acceptance will be blocked by RLS policies. They must accept current terms to regain access.
- **RLS policy errors**: Ensure helper functions (`user_has_app_access`, `user_has_current_terms`, etc.) are created and have proper permissions.

JWT Claims Structure

The Supabase auth hook automatically adds subscription data to JWTs:

```json
{
  "sub": "user-uuid",
  "role": "authenticated",
  "email": "user@example.com",
  "plans": [
    {
      "app": "clanker",
      "tier": "monthly_20",
      "status": "active",
      "terms_accepted": "2025-10-01",
      "terms_version": "1.0"
    }
  ]
}
```

## RLS Helper Functions

The system includes several helper functions for clean RLS policy implementation:

- `user_has_app_access(app_name)` — checks if user has any active subscription for an app
- `user_has_tier_access(app_name, required_tier)` — checks subscription tier hierarchy (free < monthly_20 < monthly_50)
- `user_has_current_terms(app_name, current_version)` — checks if user has accepted current terms version
- `user_has_accepted_terms(app_name)` — checks if user has accepted any terms (regardless of version)
- `user_has_credits(app_name, required_credits)` — validates credit availability for pay-as-you-go operations
- `get_user_plan_tier(app_name)` — returns user's current tier or 'no_access'

Example client pseudocode

1. Sign in with Firebase.
2. Call the callable function `exchangeToken`.
3. Receive `{ session }` containing access/refresh tokens with subscription claims.
4. Call `supabase.auth.setSession(session)`.
5. Access user's subscription plans via `supabase.auth.getSession().data.session.access_token` JWT claims.
6. **Terms compliance**: RLS policies automatically enforce current terms acceptance - users with outdated terms will be prompted to accept new versions.

This flow keeps Firebase as the identity provider and uses Supabase sessions with automatic subscription-based access control and terms compliance tracking via JWT claims.
