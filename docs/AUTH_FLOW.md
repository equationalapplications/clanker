# Authentication flow (Firebase → Supabase)

This document describes the new authentication flow used by YoursBrightly. Firebase Auth is the single source of truth for user identity. Supabase is used for application-level sessions and data, but users are created or looked up in Supabase using the authenticated Firebase email.

Files to reference

- Cloud function: `functions/src/exchangeToken.ts` (in `equationalapplications.com/functions/src`) — the callable function that maps Firebase users to Supabase users and returns Supabase tokens.
- Client helper: `src/utilities/loginSupabase.ts` (in `yoursbrightlyai/src/utilities`) — the client-side flow that calls the cloud function and sets the Supabase session.

High level contract

- Inputs:
  - Caller must be authenticated with Firebase Auth (callable function receives `request.auth`).
  - No extra ID token is required from the client — the callable context is used.
- Outputs:
  - On success: an object containing Supabase session tokens (access & refresh tokens, expiry info).
  - Error modes: unauthenticated, failed-precondition (missing env or email), internal (unable to create/find Supabase user or session failure).

Sequence (what happens end-to-end)

1. Client signs in with Firebase Auth (email/password, OAuth, etc.).
2. Client calls the Firebase callable function `exchangeToken` (region `us-central1`) using the Firebase Functions SDK.
3. The cloud function verifies `request.auth` and extracts the Firebase token (`request.auth.token`). It uses the Firebase-authenticated email as the lookup key.
4. The function calls the Supabase Admin APIs to find a user by email (`findSupabaseUserByEmail`).
   - If a Supabase user exists, it uses that user's id.
   - If no user exists, the function calls the Supabase Admin API (using the service role key) to create a user with the same email and records the returned Supabase user id.
5. Using the Supabase user id, the function calls `getSupabaseUserSession(...)` to create/sign a short-lived Supabase JWT session (access + refresh tokens).
6. The function returns the Supabase tokens to the client (wrapped in the callable response).
7. The client receives the tokens and calls `supabaseClient.auth.setSession(...)` (or equivalent) to set the Supabase session in the browser/app.

Important implementation notes

- Firebase is the source of truth — the cloud function trusts the Firebase callable context (`request.auth.token`) and the email inside it.
- The cloud function must run in a trusted environment because it uses the Supabase service role key to create users. Keep the service role key out of client code.
- The function expects the Firebase token to include a verified email. If the token has no email, the function returns an error (failed-precondition).
- If the Supabase user cannot be found or created, the function will return an error and the client should treat this as an auth failure.

Required environment variables (cloud functions)

- SUPABASE_JWT_SECRET — used when signing auth JWTs for Supabase.
- SUPABASE_SERVICE_ROLE_KEY — admin key used to create/list users via the Supabase Admin API.
- SUPABASE_URL — your Supabase project URL.

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

References

- Cloud function source: `equationalapplications.com/functions/src/exchangeToken.ts`
- Client helper source: `yoursbrightlyai/src/utilities/loginSupabase.ts`

Example client pseudocode

1. Sign in with Firebase.
2. Call the callable function `exchangeToken`.
3. Receive `{ supabaseAccessToken, supabaseRefreshToken, expiresIn, refreshExpiresIn }`.
4. Call `supabaseClient.auth.setSession({ access_token, refresh_token })`.

This flow keeps Firebase as the identity provider and uses Supabase sessions only after verifying identity on the server.
