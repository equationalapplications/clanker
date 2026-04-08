# Admin Functions

## Summary

Admin operations are implemented as Firebase 2nd-gen callable functions in `functions/src/adminFunctions.ts`.
Each callable requires Firebase Auth + admin authorization via `functions/src/adminAuth.ts`.

## Authorization

`requireAdmin(request)` grants access if any condition is true:

- Firebase custom claim `admin: true`
- Caller email exists in `ADMIN_ALLOWLIST_EMAILS` (comma-separated)
- Caller uid exists in `ADMIN_ALLOWLIST_UIDS` (comma-separated)

All other callers receive `permission-denied`.

## Callable Endpoints

### `adminListUsers`

Input:

- `page` (optional number)
- `pageSize` (optional number)
- `search` (optional string)
- `planTier` (optional string)
- `planStatus` (optional string)

Output:

- `success`
- `users[]` (user id/email/created/subscription/terms fields)
- `page`
- `pageSize`
- `totalCount` (optional, if provided by upstream Supabase Auth response)
- `hasMore`

Search behavior:

- `search` is forwarded server-side to Supabase Auth Admin API via `filter` (`/auth/v1/admin/users?...&filter=TERM`).
- This `filter` parameter is currently undocumented in the JS SDK but is supported by GoTrue Admin API implementation.
- `planTier` and `planStatus` remain client-side page-scoped filtering after subscription hydration.

### `adminSetUserCredits`

Input:

- `userId` (required)
- `credits` (required, number >= 0)
- `reason` (required)
- `requestId` (required)

Output:

- structured success payload with action metadata

### `adminSetUserSubscription`

Input:

- `userId` (required)
- `planTier` (`free`, `monthly_20`, `monthly_50`, `payg`)
- `planStatus` (`active`, `cancelled`, `expired`)
- `renewalDate` (optional ISO string)
- `reason` (required)
- `requestId` (required)

### `adminClearTermsAcceptance`

Input:

- `userId` (required)
- `reason` (required)
- `requestId` (required)

Action:

- sets `terms_accepted_at` and `terms_version` to null

### `adminResetUserState`

Input:

- `userId` (required)
- `reason` (required)
- `requestId` (required)

Action set:

- deletes user-generated app data (`clanker_messages`, `clanker_characters`)
- resets subscription row to free/active
- resets credits to 50
- clears terms acceptance fields

### `adminDeleteUser`

Input:

- `userId` (required)
- `reason` (required)
- `requestId` (required)

Action set:

- deletes app data rows
- deletes subscription rows
- deletes Supabase auth user
- deletes Firebase auth user when `user_metadata.firebaseUid` exists

## Audit Logging

Each mutating function emits structured `admin_audit_event` logs using `logger.info` with:

- actor uid/email
- target user id
- action
- request id
- payload summary
- timestamp

`requestId` is currently used for correlation and audit tracing. The current implementation does not
enforce server-side idempotency for repeated request ids.

## Secrets And Config

Admin callables require:

- `SUPABASE_SERVICE_ROLE_KEY`

Admin callables also require non-secret configuration:

- `SUPABASE_URL`

Optional bootstrap authorization config:

- `ADMIN_ALLOWLIST_EMAILS`
- `ADMIN_ALLOWLIST_UIDS`
