# Authentication Flow (Firebase -> Cloud SQL Bootstrap)

High-level contract

- Inputs:
  - Caller must be authenticated with Firebase Auth (callable function receives `request.auth`).
  - No extra ID token is required from the client.
- Outputs:
  - On success: `{ user, subscription }` from Cloud SQL.
  - Error modes: `unauthenticated`, `failed-precondition` (missing token email), `internal`.

Sequence

1. Client signs in with Firebase Auth.
2. Client calls callable `exchangeToken` in `us-central1`.
3. `exchangeToken` validates `request.auth` and token UID consistency.
4. Function finds or creates user in Cloud SQL from Firebase identity (`firebaseUid`, `email`).
5. Function loads subscription row for that user.
6. If no subscription exists, function creates default free-tier state:
   - `planTier: free`
   - `planStatus: active`
   - `currentCredits: 50`
7. Function returns normalized bootstrap payload:
   - `user` snapshot
   - `subscription` snapshot
8. Client stores/uses this bootstrap state via `getUserState()` and related app services.

Bootstrap response shape

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

Required environment variables (Cloud Functions)

- `CLOUD_SQL_CONNECTION_NAME`
- `CLOUD_SQL_DB_USER`
- `CLOUD_SQL_DB_PASS`
- `CLOUD_SQL_DB_NAME`

Related billing secrets (webhooks)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `REVENUECAT_WEBHOOK_SECRET`

Security considerations

- Do not expose Cloud SQL credentials to clients.
- Callable functions must require authentication (`request.auth` must exist).
- Gen 2 callable functions handle CORS automatically. If browser preflight fails, check Cloud Run invoker IAM first.
- Keep the underlying Cloud Run service publicly invokable (`allUsers` with `roles/run.invoker`) so unauthenticated browser preflight requests can reach the callable CORS handler.
- Rotate database and billing secrets on a secure schedule and update function secrets/env.

Troubleshooting

- `unauthenticated`: client is not signed into Firebase, or callable invoked without auth context.
- `Firebase user email is required`: sign-in provider did not yield a usable email claim.
- `Failed to bootstrap user`: inspect `exchangeToken` logs for Cloud SQL/user-repository errors.
- Credits/subscription state looks stale: verify Stripe/RevenueCat webhook deliveries and Cloud Function logs for subscription/credit mutations.

Notes on migration state

- This document describes the current Cloud SQL bootstrap flow.
- Legacy Supabase session exchange and JWT-claims-based auth are removed from the active client auth path.
