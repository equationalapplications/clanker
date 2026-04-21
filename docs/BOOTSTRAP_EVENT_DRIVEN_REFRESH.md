# Bootstrap Event-Driven Refresh

## Summary

This document describes the event-driven refresh model for auth bootstrap state (`user`, `subscription`, `credits`, `terms`) and the removal of interval polling from user/profile/credits hooks.

## What Changed

1. `authMachine` now owns refresh intent and refresh metadata.
2. `REFRESH_BOOTSTRAP` requires a reason payload:
   - `purchase`
   - `restore`
   - `manual`
   - `terms`
   - `foreground`
3. Refresh dedupe and queue-once replay are handled in machine state instead of UI code.
4. App foreground events are bridged to auth state with staleness gating.
5. `useUserCredits`, `useUserProfile`, `useUserPublicData`, and `useUserPrivateData` no longer poll with `refetchInterval`.
6. Terms acceptance performs a local auth snapshot patch (`TERMS_ACCEPTED_LOCAL`) instead of forcing immediate bootstrap.
7. Chat/image usage paths dispatch `USAGE_SNAPSHOT_RECEIVED` so credits/plan can reconcile from callable-verified data.

## Refresh Semantics

### Throttle

- Identical reasons are throttled within 2 seconds.
- `purchase`, `restore`, and `manual` bypass identical-reason throttle.

### While Bootstrapping

- Additional refresh requests are not dropped.
- Incoming reasons are collapsed into one pending reason with priority.
- Priority order:
  1. `purchase`/`restore`
  2. `manual`
  3. `foreground`/`terms`

### Replay

- After bootstrap completes, one replay bootstrap runs when a pending reason exists and differs from the last completed reason.

## Lifecycle Reconciliation

- App lifecycle bridge dispatches `APP_FOREGROUNDED` when the app becomes active.
- Auth state owner triggers a foreground refresh only when snapshot staleness exceeds 5 minutes.

## Local Snapshot Patch Events

- `TERMS_ACCEPTED_LOCAL` updates `subscription.termsVersion` and `subscription.termsAcceptedAt` in memory.
- `DB_USER_PATCHED_LOCAL` and `PROFILE_PATCHED_LOCAL` patch `dbUser` fields in memory.

## Usage Snapshot Contract

`USAGE_SNAPSHOT_RECEIVED` payload:

- `source`: `generateReply` or `generateImage`
- `remainingCredits`: number or `null`
- `planTier`: string or `null`
- `planStatus`: `active` | `cancelled` | `expired` | `null`
- `verifiedAt`: ISO timestamp

Ordering guard:

- Incoming usage snapshots only apply when `verifiedAt` is newer than `lastUsageSnapshotAt`.

## Callable Contract Updates

Both `generateReply` and `generateImage` now return usage metadata on success:

- `remainingCredits`
- `planTier`
- `planStatus`
- `verifiedAt`

For usage-gating failures (`resource-exhausted`), callable errors include snapshot details in error `details` so clients can reconcile UI without polling.

## Sign-out Hygiene

Sign-out now clears:

1. In-memory TanStack Query cache.
2. Persisted query cache via query persister cleanup.

This prevents cross-account stale hydration during user switching.
