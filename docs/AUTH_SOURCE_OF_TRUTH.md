# Auth: Source of Truth (Firebase) and Cloud SQL Bootstrap State

Summary

Firebase Auth is the canonical identity provider for the application. Cloud SQL stores app-level user and subscription state returned by the `exchangeToken` bootstrap callable.

How it works (concise)

1. Client authenticates with Firebase.
2. Client calls callable function `exchangeToken`.
3. Function finds or creates Cloud SQL user by Firebase identity (`firebaseUid`, `email`).
4. Function reads (or initializes) the Cloud SQL subscription row.
5. Function returns `{ user, subscription }` bootstrap payload to the client.

See `docs/AUTH_FLOW.md` for a full, step-by-step flow and troubleshooting.
