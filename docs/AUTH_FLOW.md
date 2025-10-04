# Authentication flow (Firebase → Supabase)

This document describes the authentication flow used by YoursBrightly. Firebase Auth is the single source of truth for user identity. Supabase is used for application-level sessions and data access control via subscription-based JWTs.

Files to reference

- Cloud function: `functions/src/exchangeToken.ts` (in `equationalapplications.com/functions/src`) — the callable function that maps Firebase users to Supabase users and returns Supabase sessions.
- Supabase auth hook: `custom_access_token_hook` (in database) — automatically adds subscription `plans` to JWT claims.
- Client helper: `src/utilities/loginToSupabaseAfterFirebase.ts` (in `yoursbrightlyai/src/utilities`) — the client-side flow that calls the cloud function and sets the Supabase session.

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
   - Adds a `plans` array to the JWT claims containing: `app`, `tier`, `status`, `terms_accepted`
   - Returns JWT with subscription data for access control
7. The function returns the Supabase session (with enriched JWT) to the client.
8. The client receives the session and calls `supabase.auth.setSession(...)` to establish the authenticated session.

Important implementation notes

- **Firebase is the source of truth for identity** — the cloud function trusts the Firebase callable context (`request.auth.token`) and the email inside it.
- **Supabase provides subscription-based access control** — the auth hook automatically adds subscription data to JWTs.
- The cloud function must run in a trusted environment because it uses the Supabase service role key to create users. Keep the service role key out of client code.
- The function expects the Firebase token to include a verified email. If the token has no email, the function returns an error (failed-precondition).
- **Supabase JWT claims include subscription plans** — each JWT contains a `plans` array for multi-tenant access control and feature gating.

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

JWT Claims Structure

The Supabase auth hook automatically adds subscription data to JWTs:

```json
{
    "sub": "user-uuid",
    "role": "authenticated",
    "email": "user@example.com",
    "plans": [
        {
            "app": "yours-brightly",
            "tier": "monthly_20",
            "status": "active",
            "terms_accepted": "2025-10-01"
        }
    ]
}
```

References

- Cloud function source: `equationalapplications.com/functions/src/exchangeToken.ts`
- Supabase client helpers: `equationalapplications.com/functions/src/supabaseClient.ts`
- Client helper source: `yoursbrightlyai/src/utilities/loginToSupabaseAfterFirebase.ts`
- Auth hook documentation: `yoursbrightlyai/docs/SUPABASE_AUTH.md`

Example client pseudocode

1. Sign in with Firebase.
2. Call the callable function `exchangeToken`.
3. Receive `{ session }` containing access/refresh tokens with subscription claims.
4. Call `supabase.auth.setSession(session)`.
5. Access user's subscription plans via `supabase.auth.getSession().data.session.access_token` JWT claims.

This flow keeps Firebase as the identity provider and uses Supabase sessions with automatic subscription-based access control via JWT claims.
