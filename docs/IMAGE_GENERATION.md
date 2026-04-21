# Image Generation

## Overview

Character image generation is server-side only.
Client sends prompt to Firebase callable `generateImage`, function calls Vertex AI,
then returns image base64 + billing metadata.

The app stores returned base64 in SQLite `avatar_data` and renders a data URI.
No cloud object-storage upload is used in this flow.

## Architecture

1. User taps Generate in character edit screen.
2. Hook `useImageGeneration` calls `generateImageViaCallable(prompt)`.
3. Firebase callable `generateImage` validates auth + App Check + billing.
4. Function generates image with `gemini-2.5-flash-image`.
5. Function returns `{ imageBase64, mimeType, creditsSpent, remainingCredits, planTier }`.
6. Client saves `imageBase64` to SQLite via `saveCharacterImageLocally`.
7. UI refreshes from local DB-backed state.

## Security And Abuse Controls

- Authenticated callable only
- App Check enforced at function boundary
- Prompt validation (required + max length)
- Subscription/credit enforcement before generation
- Per-user throttle window in function
- Payload-size cap for returned base64

## Billing Behavior

- Unlimited tiers: no credit spend
- Non-unlimited tiers: spend one credit only after successful generation
- Failed model calls: no credit decrement

## Client Integration Files

- `src/config/firebaseConfig.ts` and `src/config/firebaseConfig.web.ts`
  - export callable `generateImageFn`
- `src/services/imageGenerationService.ts`
  - waits for App Check, calls callable, validates/normalizes payload
- `src/hooks/useImageGeneration.ts`
  - manages loading/error state and persists local avatar data

## Important Policy

App has zero direct GenAI SDK imports.
All model access now goes through Firebase callable functions.

See deep dive: [IMAGE_GENERATION_FUNCTION.md](./IMAGE_GENERATION_FUNCTION.md).
