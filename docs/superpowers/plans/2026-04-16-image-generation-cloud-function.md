# Image Generation Cloud Function Follow-Up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move character image generation from client-side Firebase AI calls to a secure Firebase 2nd Gen callable function with server-side auth, abuse controls, and plan/credit enforcement. Remove all direct client-side GenAI access from the app — after this plan, the app has zero AI SDK imports.

**Architecture:** The app sends an image prompt to a new `generateImage` callable function. The function validates Firebase auth + App Check, resolves the Supabase user, enforces subscription/credit rules, generates an image server-side via Vertex AI (`gemini-2.5-flash-image`), and returns raw base64 image data + billing metadata. The client stores the base64 locally (SQLite `avatar_data` column) exactly as the current `useLocalImageGeneration` flow does. No cloud storage (Supabase Storage) is used for images.

**Tech Stack:** Firebase Functions v2 callable, Firebase Admin, Supabase service-role helpers, Vertex AI server SDK (`@google-cloud/vertexai` — already installed), Expo React Native app callable client.

**Follows:** [Chat Response Cloud Function Plan](./2026-04-16-chat-response-cloud-function.md) — mirrors `generateReply` callable pattern.

---

### Task 1: Add secure callable for image generation

**Files:**
- Create: `functions/src/generateImage.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/runtimeConfig.ts` (if image model/config params needed)
- Test: `functions/src/generateImage.test.ts`

- [ ] **Step 1: Write failing tests for auth, validation, and billing rules**

```ts
// examples
// rejects unauthenticated
// rejects missing/blank prompt
// rejects prompt exceeding length ceiling
// allows unlimited tiers without credit decrement
// decrements 1 credit for payg/free image generation
// rejects when no unlimited plan and credits <= 0
// returns base64 + mimeType on success
// does not spend credit when Vertex AI call fails
```

- [ ] **Step 2: Run functions tests to verify failure**

Run: `cd functions && npm run test`
Expected: FAIL in new `generateImage` tests until handler exists.

- [ ] **Step 3: Implement callable handler (mirror `generateReply` pattern)**

```ts
// pseudocode — same auth/billing skeleton as generateReply
// 1. verify request.auth + token uid/email
// 2. parse data.prompt, validate length (ceiling TBD, e.g. 2000 chars)
// 3. resolve Supabase user (uid first, email fallback)
// 4. fetch active subscription row (plan_tier, current_credits)
// 5. enforce access: unlimited tiers OR available credits >= 1
// 6. init Vertex AI model: gemini-2.5-flash-image
//    - responseModalities: [IMAGE] (or [TEXT, IMAGE] per model requirements)
//    - enhance prompt for avatar-quality output (small, square, clean)
// 7. generate image server-side
// 8. extract base64 + mimeType from response inlineData parts
// 9. spend 1 credit only for non-unlimited plan, only after successful generation
// 10. return { imageBase64, mimeType, creditsSpent, remainingCredits, planTier }
```

- [ ] **Step 4: Add safety and anti-abuse controls**

```ts
// enforce App Check
// prompt length ceiling + reject empty/whitespace prompt
// per-user throttling guard (time-window or DB-backed counter)
// structured logs: uid, plan tier, credits spent, latency, error code
// fail closed on config/model initialization errors
// cap response payload size (base64 can be large)
```

- [ ] **Step 5: Export callable from `index.ts`**

```ts
// add to functions/src/index.ts: export { generateImage } from "./generateImage"
// @google-cloud/vertexai already installed (v1.10.0) — no npm install needed
```

- [ ] **Step 6: Re-run functions tests and fix**

Run: `cd functions && npm run test`
Expected: PASS for `generateImage` + all existing suites.

### Task 2: Route app image generation through callable + clean up dead code

**Files:**
- Create: `src/services/imageGenerationService.ts` (typed callable wrapper)
- Rename: `src/hooks/useLocalImageGeneration.ts` → `src/hooks/useImageGeneration.ts`
- Modify: `src/hooks/useImageGeneration.ts` (after rename — call callable instead of Vertex AI)
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx` (update import from renamed hook)
- Modify: `src/config/firebaseConfig.ts` (add `generateImageFn` callable export)
- Modify: `src/config/firebaseConfig.web.ts` (add `generateImageFn` callable export)
- Delete: `src/services/vertexAIService.ts` (barrel file — no longer needed)
- Delete: `src/services/vertexAIService.web.ts` (client AI SDK — no longer needed)
- Delete: `src/services/vertexAIService.native.ts` (client AI SDK — no longer needed)
- Delete: `src/services/imageStorageService.ts` (unused Supabase upload path)
- Delete: `src/hooks/useImageGeneration.ts` (dead code — before rename of useLocalImageGeneration)
- Delete: `src/utilities/generateImage.ts` (unused wrapper)
- Modify: `package.json` (remove `firebase/ai` and `@react-native-firebase/ai` deps if no other consumers)

- [ ] **Step 1: Add `generateImageFn` to firebase config exports**

```ts
// firebaseConfig.ts (native):
const generateImageFn = httpsCallable(functionsInstance, 'generateImage')
// export { ..., generateImageFn }

// firebaseConfig.web.ts:
const generateImageFn = httpsCallable(functionsInstance, 'generateImage')
// export { ..., generateImageFn }
```

- [ ] **Step 2: Create typed callable wrapper `src/services/imageGenerationService.ts`**

```ts
// import { generateImageFn, appCheckReady } from '~/config/firebaseConfig'
// export async function generateImageViaCallable(prompt: string): Promise<{
//   imageBase64: string; mimeType: string;
//   creditsSpent: number; remainingCredits: number; planTier: string;
// }>
// await appCheckReady
// call generateImageFn({ prompt })
// validate + return normalized response
```

- [ ] **Step 3: Delete dead code files**

```bash
# delete unused files before rename to avoid naming conflict
rm src/hooks/useImageGeneration.ts        # dead code (never called in UI)
rm src/utilities/generateImage.ts          # unused wrapper
rm src/services/imageStorageService.ts     # unused Supabase upload path
```

- [ ] **Step 4: Rename `useLocalImageGeneration` → `useImageGeneration`**

```bash
# rename active hook
mv src/hooks/useLocalImageGeneration.ts src/hooks/useImageGeneration.ts
```

- [ ] **Step 5: Refactor renamed `useImageGeneration` hook to use callable**

```ts
// replace: import { generateImageWithVertexAI } from '~/services/vertexAIService'
// with:    import { generateImageViaCallable } from '~/services/imageGenerationService'
//
// replace direct Vertex AI call with callable wrapper
// keep same return shape: base64 string → save to SQLite via localImageStorageService
// keep existing loading/error state management
```

- [ ] **Step 6: Update edit screen import**

```ts
// app/(drawer)/(tabs)/characters/[id]/edit.tsx:
// replace: import { useLocalImageGeneration } from '~/hooks/useLocalImageGeneration'
// with:    import { useImageGeneration } from '~/hooks/useImageGeneration'
// update all references from useLocalImageGeneration → useImageGeneration
```

- [ ] **Step 7: Delete client AI SDK files**

```bash
rm src/services/vertexAIService.ts         # barrel file
rm src/services/vertexAIService.web.ts     # firebase/ai client SDK
rm src/services/vertexAIService.native.ts  # @react-native-firebase/ai client SDK
```

- [ ] **Step 8: Remove client AI SDK dependencies from `package.json`**

```ts
// remove firebase/ai and @react-native-firebase/ai if no remaining imports
// grep codebase first to confirm zero remaining consumers
```

- [ ] **Step 9: Add/adjust app tests for callable image path**

```ts
// mock generateImageFn
// verify callable is invoked with correct prompt
// verify base64 response is saved to SQLite
// verify error path preserves existing UX
// verify no direct vertex service imports exist
```

### Task 3: Documentation updates

**Files:**
- Create: `docs/IMAGE_GENERATION_FUNCTION.md`
- Modify: `docs/FIREBASE_FUNCTIONS.md`
- Modify: `docs/IMAGE_GENERATION.md`
- Modify: `README.md`

- [ ] **Step 1: Document callable contract + security model**

```md
Input: prompt (string, max length TBD)
Checks: Firebase auth, App Check, subscription/credit enforcement, prompt validation
Output: { imageBase64, mimeType, creditsSpent, remainingCredits, planTier }
Storage: client-side only (SQLite avatar_data column). No cloud image storage.
```

- [ ] **Step 2: Document direct-client-AI removal**

```md
State clearly: app has zero direct GenAI SDK imports.
All AI model access (text and image) goes through Firebase callable functions.
Client AI SDK packages (firebase/ai, @react-native-firebase/ai) fully removed.
```

- [ ] **Step 3: Update Firebase runbook lists**

```md
Add generateImage to:
- callable smoke-test list
- tagged Cloud Run service list (allUsersIngress tag + IAM binding required)
- post-deploy verification steps
```

- [ ] **Step 4: Add README summary link**

```md
- [Image generation function](docs/IMAGE_GENERATION_FUNCTION.md) — server-side image generation with billing and abuse controls
```

### Task 4: Full verification

**Files:**
- Modify if needed after verification errors

- [ ] **Step 1: Run root checks**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run root lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Run root tests**

Run: `npm run test`
Expected: PASS

- [ ] **Step 4: Run functions checks**

Run: `cd functions && npm run typecheck && npm run lint && npm run test`
Expected: PASS

- [ ] **Step 5: Verify zero client AI SDK imports remain**

Run: `grep -r "firebase/ai\|@react-native-firebase/ai" src/ --include="*.ts" --include="*.tsx"`
Expected: zero matches

- [ ] **Step 6: Optional targeted manual smoke test**

```md
- callable generateImage returns base64 + mimeType for valid user
- non-subscriber with no credits is rejected
- unlimited tier user is allowed without credit decrement
- App Check/auth failures rejected
- base64 saves correctly to SQLite and renders as avatar
```

- [ ] **Step 7: Commit (if requested)**

```bash
git add -A
git commit -m "feat(image): move image generation to secure callable"
```
