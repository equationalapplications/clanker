# Callable Error Normalization

## Overview

Several callable functions bootstrap the current Firebase user in Cloud SQL using `userRepository.getOrCreateUserByFirebaseIdentity(...)`.
That repository can throw plain `Error` values for identity conflicts and infrastructure/configuration failures.

This document defines how callables normalize those failures to stable, client-safe `HttpsError` responses.

## Why This Exists

Without normalization, plain `Error` values can bubble out of callable handlers and cause:

- Unstructured client failures with inconsistent error codes
- Leaking implementation details in error messages
- Retry behavior that is not aligned with the actual failure type

## Normalization Rules

### 1. Preserve existing `HttpsError`

If an error is already an `HttpsError`, rethrow it unchanged.

### 2. Identity conflict errors

When a bootstrap failure indicates an email/Firebase UID ownership conflict, return:

- Code: `failed-precondition`
- Message: `User identity is already linked to another account.`

This is used in:

- `spendCredits`
- `generateReply`
- `generateImage`
- `exchangeToken`

### 3. Cloud SQL configuration errors

When bootstrap fails because required Cloud SQL env vars are missing, return:

- Code: `failed-precondition`
- Message: `Server configuration is incomplete.`

This is currently handled in `exchangeToken`.

### 4. Unknown bootstrap failures

Fallback for non-specific failures:

- Code: `internal`
- Message: `Failed to bootstrap user.`

## Logging Guidance

Always log the original error server-side with context (`firebaseUid`, `email`, handler name), then throw sanitized `HttpsError` values to clients.

## Client-Side Expectations

Clients should treat these codes consistently:

- `failed-precondition`: account-linking or environment/config state prevents the operation
- `internal`: unexpected server failure, retry may be possible depending on UX policy

## Related Files

- `functions/src/spendCredits.ts`
- `functions/src/exchangeToken.ts`
- `functions/src/generateReply.ts`
- `functions/src/generateImage.ts`
- `functions/src/services/userRepository.ts`
