# First Login Credits

## Summary

Clanker grants first-login users 50 free credits for the `clanker` app.
This is enforced by both the auth signup DB hook and the `exchangeToken` Cloud Function bootstrap.

## Why This Exists

Terms acceptance can happen before any subscription row exists.
If terms acceptance writes only `terms_accepted_at` and `terms_version`, a new row may be created with
database defaults (including `current_credits = 0`), which breaks first-login expectations.

## Current Behavior

There are two complementary paths:

1. **Auth signup DB trigger** (`handle_new_user()`) provisions both profile and free-tier subscription with 50 credits when a new Firebase user is created. This is idempotent (uses `ON CONFLICT DO NOTHING`).

2. **Cloud Function bootstrap** (`functions/src/exchangeToken.ts`) ensures a free-tier subscription row with 50 credits exists during token exchange. It inserts for first-time users and leaves existing rows unchanged (idempotent).

3. **Terms acceptance** (`src/machines/termsMachine.ts`) uses a read-then-write strategy:
   - Query `user_app_subscriptions` by `(user_id, app_name)`
   - If a row exists, update only terms fields (`terms_accepted_at`, `terms_version`, `updated_at`)
   - If no row exists, throw an error (subscription row must exist beforehand)

This preserves credits for existing users while guaranteeing 50 free credits at first login.

## Operational Impact

- Admin delete + user re-sign-in re-creates a free-tier subscription row during token exchange.
- First-time users are provisioned to 50 credits from both backend paths.
- Terms acceptance does not reset credits for existing users.
- Existing subscriptions are not reset when users accept updated terms.

## Related Tests

- `__tests__/termsMachine.test.ts`
  - verifies update path records terms on existing subscription rows only
  - verifies missing subscription row causes an error during terms acceptance
  - verifies write failure returns to acceptanceRequired
- `functions/src/exchangeToken.test.ts`
  - verifies bootstrap path inserts free-tier subscription with 50 credits
  - verifies subscription bootstrap failure throws an `internal` error
