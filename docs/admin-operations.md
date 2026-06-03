# Admin Operations

## Overview

The admin dashboard is a web-only control plane for privileged account operations. It is implemented as an Expo Router route at `app/admin/index.tsx` and intentionally blocked on non-web platforms.

Admin operations are backed by Firebase 2nd-gen callable functions in `functions/src/adminFunctions.ts`. Each callable requires Firebase Auth + admin authorization via `functions/src/adminAuth.ts`.

---

## Route & Access Model

- **Route:** `/admin`
- **Platform gate:** `Platform.OS === 'web'`
- **Auth gate:** requires signed-in Firebase user
- **Authorization gate:** server-validated admin access check through `adminListUsers`

If any gate fails, the page renders a blocked state and never shows mutation controls.

---

## UI Structure

The dashboard is split into three reusable pieces:

- **`UsersTable`:** paginated user directory and row selection
- **`UserActionPanel`:** action controls for credits, subscription, terms, reset, and delete
- **`AdminConfirmationModal`:** required confirmation for every mutating operation

### Confirmation Rules

All mutations are confirmation-gated:

| Action | Requirements |
|---|---|
| Credits update | Confirmation + reason |
| Subscription update | Confirmation + reason |
| Clear terms | Confirmation + reason |
| Reset user | Confirmation + reason + typed `RESET` |
| Delete user | Confirmation + reason + typed `DELETE` |

Submit remains disabled until all validation requirements are satisfied.

### State & Data Fetching

- React Query hooks in `src/hooks/useAdminDashboard.ts` provide: access check, paginated list fetch, mutation handlers with invalidation
- Firebase callable wrappers in `src/services/adminService.ts`
- Shared admin data contracts in `src/types/admin.ts`

### Search & Filter

- Email/name search is server-side: passes `search` to `adminListUsers` for Cloud SQL-backed user directory search
- Search input debounced at `300ms`
- Plan filters (`planTier`, `planStatus`) are page-scoped client-side filters (from hydrated Cloud SQL subscription data, not base identity fields)
- Query transitions use React Query `keepPreviousData` to avoid flashing empty state
- Pagination supports page sizes `25`, `50`, `100`; resets to page 1 on search/filter/page-size change

### Operational Notes

- App Check is awaited before admin callable execution
- Client sends generated `requestId` for all mutation calls for audit correlation
- UI shows success/failure feedback after each action

---

## Admin Callable Functions

### Authorization

`requireAdmin(request)` grants access if any condition is true:

- Firebase custom claim `admin: true`
- Caller email exists in `ADMIN_ALLOWLIST_EMAILS` (comma-separated)
- Caller uid exists in `ADMIN_ALLOWLIST_UIDS` (comma-separated)

All other callers receive `permission-denied`.

### `adminListUsers`

**Input:**
- `page` (optional number)
- `pageSize` (optional number)
- `search` (optional string)
- `planTier` (optional string — one of: `free`, `monthly_20`, `monthly_50`, `payg`)
- `planStatus` (optional string — one of: `active`, `cancelled`, `expired`)

**Validation:** `page`/`pageSize` must be finite. Invalid filter values return `invalid-argument`.

**Output:**
- `success`, `users[]` (user id/email/created/subscription/terms fields), `page`, `pageSize`, `totalCount`, `hasMore`

**Search behavior:** `search` applied against Cloud SQL user fields (`email`, `displayName`, `firebaseUid`). `planTier`/`planStatus` are page-scoped filters after subscription hydration.

### `adminSetUserCredits`

**Input:** `userId` (required), `credits` (required, number >= 0), `reason` (required), `requestId` (required)

**Output:** structured success payload with action metadata

### `adminSetUserSubscription`

**Input:** `userId` (required), `planTier` (`free`/`monthly_20`/`monthly_50`/`payg`), `planStatus` (`active`/`cancelled`/`expired`), `renewalDate` (optional ISO string), `reason` (required), `requestId` (required)

### `adminClearTermsAcceptance`

**Input:** `userId` (required), `reason` (required), `requestId` (required)

**Action:** Sets `terms_accepted_at` and `terms_version` to null.

### `adminResetUserState`

**Input:** `userId` (required), `reason` (required), `requestId` (required)

**Action set:**
- Deletes user-generated app data (`clanker_messages`, `clanker_characters`)
- Resets subscription row to free/active
- Resets credits to 50
- Clears terms acceptance fields

### `adminDeleteUser`

**Input:** `userId` (required), `reason` (required), `requestId` (required)

**Action set:**
- Deletes app data rows
- Deletes subscription rows
- Deletes Firebase auth user
- Deletes Cloud SQL user row

---

## Audit Logging

Each mutating function emits structured `admin_audit_event` logs using `logger.info` with:
- Actor uid/email
- Target user id
- Action
- Request id
- Payload summary
- Timestamp

`requestId` is used for correlation and audit tracing (no server-side idempotency enforcement yet).

---

## Secrets & Config

Admin callables require:
- Firebase Admin access to delete Firebase Auth users
- Cloud SQL via shared database connector: `CLOUD_SQL_CONNECTION_NAME`, `CLOUD_SQL_DB_USER`, `CLOUD_SQL_DB_PASS`, `CLOUD_SQL_DB_NAME`
- Optional: `ADMIN_ALLOWLIST_EMAILS`, `ADMIN_ALLOWLIST_UIDS`

---

## Runbook

### Granting / Revoking Admin Custom Claim

Use `scripts/set-admin-claim.js` from the repo root.

**Prerequisites:**
- `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service account key with **Firebase Auth Admin** role, OR
- Default application credentials (`gcloud auth application-default login`)

**Grant:**
```bash
cd functions && NODE_PATH=./node_modules node ../scripts/set-admin-claim.js user@example.com
```

**Revoke:**
```bash
cd functions && NODE_PATH=./node_modules node ../scripts/set-admin-claim.js user@example.com --revoke
```

After setting the claim, the user must **sign out and sign back in** (or wait up to 1 hour) for the new claim to appear in their ID token.

### Pre-Action Checklist

1. Confirm admin has authenticated with Firebase on web
2. Confirm admin user is authorized via claim and/or allowlist
3. Identify target user ID and email from the directory table
4. Verify requested action and reason in a support ticket or incident artifact
5. Confirm consequences with a second reviewer for destructive operations

### Action Procedures

**Adjust Credits:** Select user → enter absolute credit value → confirm + reason → validate updated credits in refreshed row

**Adjust Subscription:** Select tier and status → optionally set renewal date → confirm + reason → validate updated tier/status

**Clear Terms Acceptance:** Select user → trigger clear terms → confirm + reason → validate terms fields are unset

**Reset User State:** Trigger reset → type `RESET` → provide reason → confirm → validate free/active with credits=50 and terms cleared

**Delete User Permanently:** Trigger delete → type `DELETE` → provide reason → confirm → validate user no longer appears in list

### Post-Action Validation

1. Review Cloud Function logs for `admin_audit_event` and success completion
2. Ensure no repeated invocation errors for the same request ID
3. Update incident/support ticket with actor, timestamp, and request ID

### Failure Handling

1. Capture error text and request ID on mutation failure
2. Retry only after confirming operation impact and reapplying is safe
3. Escalate persistent failures to backend owner with function logs