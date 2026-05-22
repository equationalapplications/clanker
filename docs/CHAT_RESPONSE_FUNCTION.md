# Chat Response Function

This document describes the secure server-side text generation path used by chat and character introduction flows.

## Summary

Text generation now runs through a Firebase 2nd Gen callable function, `generateReply`, instead of client-side Firebase AI SDK calls.

This ensures:
- Firebase Auth is verified server-side before usage.
- Access control is enforced from Cloud SQL credit ledger state.
- Credit spending is enforced server-side for all applicable requests.
- Vertex AI credentials and model invocation remain server-only.

## Endpoint

- Function name: `generateReply`
- Type: Firebase callable (`onCall`, Gen 2)
- Region: `us-central1`
- App Check: enforced
- Invoker: public at Cloud Run layer (with tag + IAM runbook requirements)

## Request Contract

Input payload:

```json
{
  "prompt": "string (required, non-empty after trim, max 12000 chars)",
  "referenceId": "string (optional, max 128 chars, idempotency/reference key for credit spend RPC)"
}
```

Auth requirements:
- Firebase auth context must be present.
- Context UID must match token UID.
- Email must exist in Firebase token.

## Response Contract

```json
{
  "reply": "string",
  "creditsSpent": "number",
  "remainingCredits": "number",
  "planTier": "string | null",
  "planStatus": "'active' | 'cancelled' | 'expired' | null",
  "verifiedAt": "string"
}
```

Semantics:
- `creditsSpent = 1` for all successful text generation requests.
- `remainingCredits` reflects the balance after the spend operation.
- `planTier` and `planStatus` mirror the current Cloud SQL subscription state when available.
- `verifiedAt` is an ISO 8601 timestamp used by the app’s usage snapshot plumbing.

## Authorization And Billing Rules

1. Resolve Cloud SQL user from Firebase identity (create on first authenticated call when absent).
2. Ensure Cloud SQL user and subscription row exist.
3. Reserve one credit via the Cloud SQL-backed credit service; capture the `transactionId`.
4. Generate text reply with Vertex AI.
5. On model failure: refund 1 credit to the same grant row via `transactionId`, then return `internal` error.

Generation limits:
- Vertex model config sets `maxOutputTokens = 1024` for cost/latency control.

Important billing behavior:
- Credit is reserved (decremented) before model generation begins.
- On model failure, the credit is refunded to the same grant row — no net spend occurs.
- Invalid credit update payload is treated as internal error (not silently accepted).

## Error Mapping

Function returns Firebase `HttpsError` codes:
- `unauthenticated`: missing auth context or token UID mismatch.
- `invalid-argument`: prompt missing, empty after trim, exceeds 12000 chars, or `referenceId` exceeds 128 chars.
- `failed-precondition`: missing token email, missing required server config, or insufficient credits.
- `internal`: user lookup/create failures, downstream failures (subscription query, model invocation, credit RPC), or other unexpected failures.

Operational logs include separate debug signals for:
- Cloud SQL user with no active subscription rows.

## Client Integration

All text generation routes through `src/services/chatReplyService.ts`:
- Chat response generation.
- Character introduction generation.

Client-side Vertex AI text generation code was removed from:
- `src/services/vertexAIService.web.ts`
- `src/services/vertexAIService.native.ts`

Image generation remains on existing client-side path.

## Testing

Function tests live in `functions/src/generateReply.test.ts`.

Covered behavior:
- unauthenticated rejection
- empty prompt rejection
- pay-as-you-go spend flow
- subscription credit spend flow
- zero-credit rejection
- no spend on model failure
- response shape on success

## Deploy And Operations

From `functions/`:

```bash
npm run typecheck
npm run lint
npm run test
npm run deploy
```

After deploy for new callable service `generatereply`, apply org-policy bypass tag and public invoker IAM as documented in `docs/FIREBASE_FUNCTIONS.md`.
