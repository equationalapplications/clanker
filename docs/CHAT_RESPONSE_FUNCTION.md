# Chat Response Function

This document describes the secure server-side text generation path used by chat and character introduction flows.

## Summary

Text generation now runs through a Firebase 2nd Gen callable function, `generateReply`, instead of client-side Firebase AI SDK calls.

This ensures:
- Firebase Auth is verified server-side before usage.
- Access control is enforced from Cloud SQL subscription state.
- Credit spending is enforced server-side for non-unlimited tiers.
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
  "creditsSpent": "number (0 or 1)",
  "remainingCredits": "number | null",
  "planTier": "string | null"
}
```

Semantics:
- `creditsSpent = 0` for unlimited tiers (`monthly_20`, `monthly_50`).
- `creditsSpent = 1` for credit-based access (`payg`, `free`, or other non-unlimited active tiers).
- `remainingCredits` is null for unlimited tiers.

## Authorization And Billing Rules

1. Resolve Cloud SQL user from Firebase identity.
2. Load active row from `subscriptions` for that user.
3. Authorize usage:
- Unlimited tier (`monthly_20`, `monthly_50`) -> allow without credit spend.
- Otherwise require aggregate `current_credits >= 1`.
4. Generate text reply with Vertex AI.
5. If credit-based usage, spend exactly 1 credit via the Cloud SQL-backed credit service.

Generation limits:
- Vertex model config sets `maxOutputTokens = 1024` for cost/latency control.

Important billing behavior:
- Credit spending occurs after successful model generation.
- Failed model generation must not decrement credits.
- Invalid credit update payload is treated as internal error (not silently accepted).

## Error Mapping

Function returns Firebase `HttpsError` codes:
- `unauthenticated`: missing auth context or token UID mismatch.
- `invalid-argument`: prompt missing, empty after trim, exceeds 12000 chars, or `referenceId` exceeds 128 chars.
- `failed-precondition`: missing token email or missing required server config.
- `not-found`: Cloud SQL user not found for authenticated email.
- `resource-exhausted`: no unlimited tier and no available credits.
- `internal`: downstream failures (subscription query, model invocation, credit RPC, unexpected failures).

Operational logs include separate debug signals for:
- Authenticated email with no Cloud SQL user.
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
- unlimited plan no-spend flow
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
