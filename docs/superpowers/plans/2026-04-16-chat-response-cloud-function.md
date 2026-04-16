# Chat Response Cloud Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chatbot text response generation from client-side Firebase AI calls to a secure Firebase 2nd Gen callable function with server-side auth + plan/credit enforcement.

**Architecture:** The app sends a prebuilt prompt/context payload to a new callable function. The function validates Firebase auth, resolves the Supabase user, checks subscription row (`user_app_subscriptions`), enforces access rules (subscriber unlimited OR credits), decrements credits only for non-unlimited tiers, then calls Gemini/Vertex server-side and returns text. Client chat flow stores returned text exactly like current AI reply handling.

**Tech Stack:** Firebase Functions v2 callable, Firebase Admin, Supabase service-role RPC/REST helpers, Vertex AI server SDK, Expo React Native app callable client.

---

### Task 1: Add secure callable for chat response generation

**Files:**
- Create: `functions/src/generateReply.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/package.json`
- Test: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Write failing tests for validation and billing rules**

```ts
// examples
// rejects unauthenticated
// rejects missing/blank prompt
// allows monthly_20 without decrement
// decrements 1 credit for payg/free
// rejects when no unlimited plan and credits <= 0
```

- [ ] **Step 2: Run function tests to verify failure**

Run: `cd functions && npm run test`
Expected: FAIL in new `generateReply` tests until handler exists.

- [ ] **Step 3: Implement callable handler with strict checks**

```ts
// pseudocode
// verify request.auth + token uid/email
// parse data.prompt + optional metadata
// resolve supabase user by email
// fetch active subscription row (plan_tier, current_credits)
// if tier in monthly_20/monthly_50 => unlimited allowed
// else require current_credits >= 1 then call spend_user_credits RPC with amount=1
// call server-side Gemini/Vertex with prompt
// return { reply, creditsSpent, remainingCredits, planTier }
```

- [ ] **Step 4: Export callable from index and add dependency**

Run: `cd functions && npm install @google-cloud/vertexai`

- [ ] **Step 5: Re-run functions tests and fix**

Run: `cd functions && npm run test`
Expected: PASS for `generateReply` + existing suites.

### Task 2: Route app chat response generation through callable

**Files:**
- Modify: `src/services/aiChatService.ts`
- Create: `src/services/chatReplyService.ts`
- Modify: `src/config/firebaseConfig.ts`
- Modify: `src/config/firebaseConfig.web.ts`
- Optional Modify: `src/services/vertexAIService.web.ts`, `src/services/vertexAIService.native.ts`

- [ ] **Step 1: Add typed client wrapper around `generateReplyFn`**

```ts
// call generateReplyFn({ prompt, metadata })
// return normalized text
```

- [ ] **Step 2: Replace direct chat text generation usage**

```ts
// aiChatService.ts: generateChatResponse(...) -> generateChatReplyViaCloudFunction(...)
```

- [ ] **Step 3: Keep image generation untouched**

```ts
// only text chatbot flow moved server-side
```

- [ ] **Step 4: Preserve current fallback UX**

```ts
// existing offline/online fallback message behavior remains
```

### Task 3: Documentation updates

**Files:**
- Create: `docs/CHAT_RESPONSE_FUNCTION.md`
- Modify: `README.md`
- Modify: `docs/FIREBASE_FUNCTIONS.md`

- [ ] **Step 1: Document callable contract + security model**

```md
Input: prompt + optional metadata
Checks: Firebase auth, active subscription, credit spend rules
Output: reply + billing metadata
```

- [ ] **Step 2: Add README summary link**

```md
- Chat response function — server-side AI generation and billing enforcement
```

- [ ] **Step 3: Update Firebase functions doc list**

```md
Add `generateReply` to core functions and runbook callable list
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

- [ ] **Step 5: Commit (if requested)**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts functions/src/index.ts functions/package.json src/services/aiChatService.ts src/services/chatReplyService.ts src/config/firebaseConfig.ts src/config/firebaseConfig.web.ts docs/CHAT_RESPONSE_FUNCTION.md docs/FIREBASE_FUNCTIONS.md README.md docs/superpowers/plans/2026-04-16-chat-response-cloud-function.md
git commit -m "feat(chat): move AI reply generation to secure callable"
```
