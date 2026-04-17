# Image Generation Function

This document defines the server-side image generation callable contract used by the app.

## Overview

Image generation now runs only through Firebase 2nd Gen callable `generateImage`.
Client code sends a prompt, backend enforces auth and billing, backend calls Vertex AI
(`gemini-2.5-flash-image`), and returns raw base64 image data.

The app stores returned base64 locally in SQLite (`characters.avatar_data`).
No Supabase Storage upload is used for generated avatars.

## Callable Contract

### Input

```ts
type GenerateImageRequest = {
  prompt: string // non-empty, trimmed, max 2000 chars
}
```

### Output

```ts
type GenerateImageResponse = {
  imageBase64: string
  mimeType: string
  creditsSpent: number
  remainingCredits: number | null
  planTier: string | null
}
```

## Security Model

`generateImage` enforces all of the following before model access:

- Firebase Authentication (valid callable auth context)
- Firebase App Check (`enforceAppCheck: true`)
- Supabase identity resolution (Firebase UID first, email fallback)
- Subscription/credit authorization (unlimited tiers or >=1 credit)
- Prompt validation (non-empty, max length)
- Per-user rate limiting (in-memory request window)
- Payload-size guard on returned base64 data

If any check fails, function fails closed with `HttpsError`.

## Billing Rules

- Unlimited tiers (`monthly_20`, `monthly_50`):
  - allowed access
  - `creditsSpent = 0`
  - no credit decrement
- Non-unlimited tiers (`payg`, free, etc.):
  - require available credits
  - spend exactly 1 credit after successful model generation only
  - no credit spend when Vertex/model call fails

## Storage Behavior

- Function returns base64 and metadata only.
- Client persists base64 in local SQLite via `saveCharacterImageLocally`.
- UI renders via data URI from local value.
- `avatar` cloud URL field is not used in this path.

## Logging

Success logs include:

- Firebase UID
- Supabase user ID
- Plan tier
- Credits spent and remaining credits
- Latency
- Approximate payload byte size

Error logs include model and billing failures with context.

## Client Integration

- Callable export: `generateImageFn` in Firebase config (native + web)
- Wrapper: `src/services/imageGenerationService.ts`
- Hook: `src/hooks/useImageGeneration.ts`
- Screen usage: character edit route calls `useImageGeneration`

## AI Access Policy

App now has zero direct GenAI SDK imports.
All AI model access (chat + image) flows through Firebase callable functions.