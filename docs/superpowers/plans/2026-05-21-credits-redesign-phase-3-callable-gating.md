# Credits Redesign Phase 3: Callable Gating

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all `UNLIMITED_TIERS`, `PREMIUM_TIERS`, `CLOUD_CHARACTER_ALLOWED_PLANS`, and `hasUnlimited` logic from every callable. Replace with the spend→execute→catch/refund pattern. Change `spendCredits` external signature to `(userId, amount)` → `string | null` (returns `transactionId` for refunds). Delete `functions/src/constants/plans.ts`.

**Architecture:** Each callable now: (1) calls `spendCredits(userId, cost)` — if `null` throw `failed-precondition`, (2) calls the external API, (3) on API failure calls `refundCredit(userId, txId, cost)` and rethrows. Credit is spent before the API call so the server never charges for work not attempted. Refunds return credits to the exact original grant row. The `spendCredits` standalone callable (client-facing) is updated to use the new signature.

**Tech Stack:** Firebase Functions v2, Drizzle ORM

origin branch for PR: feat/credits-phase-3-callable-gating
local worktree branch for PR: feat/credits-phase-3-callable-gating

---

## Prerequisite

Phase 2 merged to staging. `creditService` exports `spendCredits`, `refundCredit`.

---

## File Structure

- Modify: `functions/src/services/creditService.ts` — change `spendCredits` signature to `(userId, amount)` → `string | null`
- Modify: `functions/src/services/creditService.test.ts` — update spendCredits test
- Modify: `functions/src/generateReply.ts` — remove UNLIMITED_TIERS, spend→execute→refund
- Modify: `functions/src/generateReply.test.ts` — rewrite credit-related tests
- Modify: `functions/src/generateImage.ts` — same pattern
- Modify: `functions/src/generateImage.test.ts`
- Modify: `functions/src/generateVoiceReply.ts` — 2-credit cost
- Modify: `functions/src/generateVoiceReply.test.ts`
- Modify: `functions/src/characterFunctions.ts` — remove CLOUD_CHARACTER_ALLOWED_PLANS, spend→refund
- Modify: `functions/src/characterFunctions.test.ts`
- Modify: `functions/src/documentExtract.ts` — remove PREMIUM_TIERS, spend→refund
- Modify: `functions/src/documentExtract.test.ts`
- Modify: `functions/src/memoryFunctions.ts` — remove hasUnlimited, spend→refund
- Modify: `functions/src/memoryFunctions.test.ts`
- Modify: `functions/src/spendCredits.ts` — update to new creditService.spendCredits signature
- Modify: `functions/src/spendCredits.test.ts`
- Delete: `functions/src/constants/plans.ts`

---

## Task 1: Update `spendCredits` Signature in `creditService`

**Files:**
- Modify: `functions/src/services/creditService.ts`
- Modify: `functions/src/services/creditService.test.ts`

- [ ] **Step 1: Write failing test for new spendCredits return type**

Open `functions/src/services/creditService.test.ts`. Replace the spendCredits test:

```typescript
test('spendCredits returns null when no qualifying row found', async () => {
  const fakeTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              for: async () => [],
            }),
          }),
        }),
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const txId = await service.spendCredits('user-1', 1);
  assert.equal(txId, null);
});

test('spendCredits returns transactionId on success', async () => {
  const fakeTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              for: async () => [{ id: 'tx-abc', remainingBalance: 10 }],
            }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {},
      }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const txId = await service.spendCredits('user-1', 1);
  assert.equal(txId, 'tx-abc');
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd functions && npm test 2>&1 | grep -A 3 "spendCredits"
```

Expected: failures because current `spendCredits` returns `boolean`.

- [ ] **Step 3: Update `spendCredits` signature in `creditService.ts`**

Find the `spendCredits` method. Change:
- Return type: `Promise<boolean>` → `Promise<string | null>`
- Remove `_reason` and `_referenceId` parameters
- Return the `transactionId` on success, `null` on failure

```typescript
async spendCredits(userId: string, amount: number): Promise<string | null> {
  const db = await deps.getDb();
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: creditTransactions.id, remainingBalance: creditTransactions.remainingBalance })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            gt(creditTransactions.remainingBalance, amount - 1),
            or(
              isNull(creditTransactions.expiresAt),
              gt(creditTransactions.expiresAt, sql`NOW()`)
            )
          )
        )
        .orderBy(sql`${creditTransactions.expiresAt} NULLS LAST`)
        .limit(1)
        .for('update');

      if (rows.length === 0) {
        return null; // Insufficient credits
      }

      const row = rows[0];

      await tx
        .update(creditTransactions)
        .set({ remainingBalance: sql`${creditTransactions.remainingBalance} - ${amount}` })
        .where(eq(creditTransactions.id, row.id));

      await tx
        .update(subscriptions)
        .set({
          currentCredits: sql`GREATEST(${subscriptions.currentCredits} - ${amount}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));

      return row.id; // Return transactionId for potential refund
    }, { isolationLevel: 'read committed' });
  } catch (error) {
    throw error;
  }
},
```

- [ ] **Step 4: Run creditService tests**

```bash
cd functions && npm test 2>&1 | grep -E "(creditService|PASS|FAIL)"
```

Expected: all creditService tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/creditService.ts functions/src/services/creditService.test.ts
git commit -m "feat(credits): spendCredits now returns transactionId | null

Returns the decremented credit_transactions row ID on success (used by callers
for refundCredit on API failure), or null on insufficient credits."
```

---

## Task 2: Update Standalone `spendCredits.ts` Callable

**Files:**
- Modify: `functions/src/spendCredits.ts`
- Modify: `functions/src/spendCredits.test.ts`

- [ ] **Step 1: Update `spendCredits.ts` to use new signature**

In `functions/src/spendCredits.ts`, find the `creditService.spendCredits` call:

```typescript
// Old:
const success = await creditService.spendCredits(user.id, amount, description, referenceId ?? undefined);
if (!success) { ... }

// New:
const txId = await creditService.spendCredits(user.id, amount);
if (txId === null) { ... }
```

Also remove the `description` field from `SpendCreditsData` (no longer needed) and its validation:

```typescript
interface SpendCreditsData {
  amount: number;
  referenceId?: string;
  // description removed — credits are now spent by callables internally
}
```

Remove the validation block for `data.description`.

- [ ] **Step 2: Run spendCredits tests**

```bash
cd functions && npm test 2>&1 | grep -E "(spendCredits|PASS|FAIL)"
```

Expected: tests pass. Update any test that passed `description` in the request data.

- [ ] **Step 3: Commit**

```bash
git add functions/src/spendCredits.ts functions/src/spendCredits.test.ts
git commit -m "feat(callable): update standalone spendCredits to new creditService signature"
```

---

## Task 3: Rewrite `generateReply.ts`

**Files:**
- Modify: `functions/src/generateReply.ts`
- Modify: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Identify all changes needed in `generateReply.ts`**

Remove:
- `const UNLIMITED_TIERS = new Set(["monthly_20", "monthly_50"]);` (line 10)
- `hasUnlimited` field from `UsageState` interface
- `creditBalance` field from `UsageState` (now always used)
- `fetchUsageState` function (replaced by simpler balance check)
- `assertUsageAuthorized` function
- `spendOneCreditIfRequired` function
- `toUsageSnapshotDetails` function
- `UsageSnapshotDetails` interface
- All `hasUnlimited` checks in `handler`

Add:
- `spendCredits` before generate call
- `refundCredit` in catch block
- Direct `creditService.getCredits` call for remaining balance

The new handler flow:
```
1. Auth check
2. Validate input
3. Get/create user
4. spendCredits(userId, 1) → txId (null = insufficient credits → throw failed-precondition)
5. try: generateText(prompt)
   catch: refundCredit(userId, txId, 1), throw internal
6. Return { reply, creditsSpent: 1, remainingCredits: await getCredits(userId) }
```

- [ ] **Step 2: Write failing tests**

Open `functions/src/generateReply.test.ts`. Add these tests (keep existing auth/validation tests):

```typescript
test('generateReply throws failed-precondition when spendCredits returns null', async () => {
  const mockSpendCredits = async (_userId: string, _amount: number) => null;
  const result = await generateReplyHandler(
    makeAuthRequest({ prompt: 'Hello' }),
    {
      generateText: async () => 'reply',
      creditService: { spendCredits: mockSpendCredits, getCredits: async () => 0, refundCredit: async () => {} },
    } as never
  ).catch(e => e);
  assert.equal(result?.code, 'failed-precondition');
});

test('generateReply refunds credit and throws internal when generateText fails', async () => {
  let refundCalled = false;
  const result = await generateReplyHandler(
    makeAuthRequest({ prompt: 'Hello' }),
    {
      generateText: async () => { throw new Error('Vertex failed'); },
      creditService: {
        spendCredits: async () => 'tx-123',
        getCredits: async () => 9,
        refundCredit: async () => { refundCalled = true; },
      },
    } as never
  ).catch(e => e);
  assert.ok(refundCalled, 'refundCredit must be called on API failure');
  assert.equal(result?.code, 'internal');
});

test('generateReply spends credit BEFORE calling generateText', async () => {
  const callOrder: string[] = [];
  await generateReplyHandler(
    makeAuthRequest({ prompt: 'Hello' }),
    {
      generateText: async () => { callOrder.push('generate'); return 'reply'; },
      creditService: {
        spendCredits: async () => { callOrder.push('spend'); return 'tx-123'; },
        getCredits: async () => 9,
        refundCredit: async () => {},
      },
    } as never
  );
  assert.deepEqual(callOrder, ['spend', 'generate']);
});
```

Note: `makeAuthRequest` and the second `options` parameter of `generateReplyHandler` must be set up to accept `creditService` overrides. The existing handler uses module-level `creditService` — update the handler to accept injected deps (follow the same pattern as stripeWebhook uses `deps`).

- [ ] **Step 3: Rewrite the handler in `generateReply.ts`**

Replace the credit-related functions and update the handler:

```typescript
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService as defaultCreditService } from "./services/creditService.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";

// Remove: UNLIMITED_TIERS, UsageState, fetchUsageState, assertUsageAuthorized,
//         spendOneCreditIfRequired, UsageSnapshotDetails, toUsageSnapshotDetails

// Keep: DEFAULT_MODEL, DEFAULT_REGION, MAX_PROMPT_LENGTH, MAX_REFERENCE_ID_LENGTH,
//       MAX_OUTPUT_TOKENS, GenerateReplyData, GenerateReplyResponse,
//       parseInput, getModel, getTextGenerator, isIdentityConflictError, getProjectId

// Update GenerateReplyResponse to remove planTier/planStatus/verifiedAt optional:
export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number;
}

// Update handler to accept optional creditService injection:
interface GenerateReplyOptions {
  generateText?: GenerateTextFn;
  creditService?: Pick<typeof defaultCreditService, 'spendCredits' | 'getCredits' | 'refundCredit'>;
}

const handler = async (
  request: CallableRequest,
  options: GenerateReplyOptions = {}
): Promise<GenerateReplyResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const decoded = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const email = decoded.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "Firebase user email is required.");
  }

  const { prompt } = parseInput(request.data);

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    if (isIdentityConflictError(error)) {
      throw new HttpsError("failed-precondition", "User identity is already linked to another account.");
    }
    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const credits = options.creditService ?? defaultCreditService;

  // Spend credit BEFORE calling the external API
  const txId = await credits.spendCredits(user.id, 1);
  if (txId === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const generateText = options.generateText ?? getTextGenerator();

  let reply: string;
  try {
    reply = (await generateText(prompt)).trim();
  } catch (error) {
    // Refund the credit — API call failed
    await credits.refundCredit(user.id, txId, 1);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate chat response.");
  }

  if (!reply) {
    await credits.refundCredit(user.id, txId, 1);
    throw new HttpsError("internal", "Model returned an empty chat response.");
  }

  const remainingCredits = await credits.getCredits(user.id);

  return { reply, creditsSpent: 1, remainingCredits };
};
```

Note: `GenerateReplyResponse` drops `planTier`, `planStatus`, `verifiedAt` — these were only relevant for the unlimited-tier logic. If any frontend code reads these fields, update it in Phase 4.

- [ ] **Step 4: Run generateReply tests**

```bash
cd functions && npm test 2>&1 | grep -E "(generateReply|PASS|FAIL)"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts
git commit -m "feat(callable): generateReply uses spend→generate→refund pattern

Removes UNLIMITED_TIERS and hasUnlimited logic. Spends 1 credit before
calling Vertex AI; refunds on failure. Returns remainingCredits from
credit_transactions SUM."
```

---

## Task 4: Rewrite `generateImage.ts`

**Files:**
- Modify: `functions/src/generateImage.ts`
- Modify: `functions/src/generateImage.test.ts`

- [ ] **Step 1: Write failing tests (same pattern as Task 3)**

Add to `functions/src/generateImage.test.ts`:

```typescript
test('generateImage throws failed-precondition on null txId', async () => {
  // mock creditService.spendCredits returning null
  // assert throws with code 'failed-precondition'
});

test('generateImage refunds credit on image generation failure', async () => {
  // mock spendCredits returning 'tx-123'
  // mock generateImage throwing
  // assert refundCredit called with ('user-id', 'tx-123', 1)
});

test('generateImage spends credit before calling image API', async () => {
  // assert callOrder is ['spend', 'generate']
});
```

Implement these following the same mock pattern as Task 3.

- [ ] **Step 2: Apply changes to `generateImage.ts`**

Apply the same changes as `generateReply.ts`:
- Remove `UNLIMITED_TIERS`, `hasUnlimited`, `UsageState`, `fetchUsageState`, `assertUsageAuthorized`, `spendOneCredit...` functions
- Add `creditService` to `GenerateImageOptions`
- New flow: `spendCredits(userId, 1)` → generate image → `refundCredit` on failure
- Update `GenerateImageResponse` to remove `planTier`, `planStatus`, `verifiedAt`

```typescript
export interface GenerateImageResponse {
  imageBase64: string;
  mimeType: string;
  creditsSpent: number;
  remainingCredits: number;
}
```

The updated handler body (credit section):

```typescript
const credits = options.creditService ?? defaultCreditService;

const txId = await credits.spendCredits(user.id, 1);
if (txId === null) {
  throw new HttpsError("failed-precondition", "Insufficient credits.");
}

let imageResult: GeneratedImageResult;
try {
  imageResult = await generateImageFn(prompt);
} catch (error) {
  await credits.refundCredit(user.id, txId, 1);
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Failed to generate image.");
}

const remainingCredits = await credits.getCredits(user.id);
return { imageBase64: imageResult.imageBase64, mimeType: imageResult.mimeType, creditsSpent: 1, remainingCredits };
```

- [ ] **Step 3: Run tests and commit**

```bash
cd functions && npm test 2>&1 | grep -E "(generateImage|PASS|FAIL)"
git add functions/src/generateImage.ts functions/src/generateImage.test.ts
git commit -m "feat(callable): generateImage uses spend→generate→refund pattern"
```

---

## Task 5: Rewrite `generateVoiceReply.ts`

**Files:**
- Modify: `functions/src/generateVoiceReply.ts`
- Modify: `functions/src/generateVoiceReply.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `functions/src/generateVoiceReply.test.ts`:

```typescript
test('generateVoiceReply spends 2 credits', async () => {
  let spentAmount: number | null = null;
  // mock creditService.spendCredits capturing amount arg
  // verify spentAmount === 2
});

test('generateVoiceReply refunds 2 credits on TTS failure', async () => {
  let refundAmount: number | null = null;
  // mock refundCredit capturing amount arg
  // verify refundAmount === 2
});
```

- [ ] **Step 2: Apply changes to `generateVoiceReply.ts`**

Same pattern as generateReply but cost = 2:

```typescript
const VOICE_CREDIT_COST = 2;

const txId = await credits.spendCredits(user.id, VOICE_CREDIT_COST);
if (txId === null) {
  throw new HttpsError("failed-precondition", "Insufficient credits. Voice replies require 2 credits.");
}

let voiceResult: VoiceResult;
try {
  voiceResult = await generateVoice(prompt);
} catch (error) {
  await credits.refundCredit(user.id, txId, VOICE_CREDIT_COST);
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Failed to generate voice reply.");
}

const remainingCredits = await credits.getCredits(user.id);
```

Remove `UNLIMITED_TIERS`, `hasUnlimited`, all tier-check logic.

- [ ] **Step 3: Run tests and commit**

```bash
cd functions && npm test 2>&1 | grep -E "(generateVoice|PASS|FAIL)"
git add functions/src/generateVoiceReply.ts functions/src/generateVoiceReply.test.ts
git commit -m "feat(callable): generateVoiceReply spends 2 credits with refund on failure"
```

---

## Task 6: Rewrite `characterFunctions.ts`

**Files:**
- Modify: `functions/src/characterFunctions.ts`
- Modify: `functions/src/characterFunctions.test.ts`

- [ ] **Step 1: Identify current gate**

In `characterFunctions.ts`, find:
```typescript
const CLOUD_CHARACTER_ALLOWED_PLANS = new Set(['monthly_20', 'monthly_50']);
```
And any check like `if (!CLOUD_CHARACTER_ALLOWED_PLANS.has(planTier)) throw permission-denied`.

- [ ] **Step 2: Write failing tests**

Add tests for cloud character save that verify:
- `spendCredits` is called when saving a cloud character
- `null` txId throws `failed-precondition` (not `permission-denied`)
- Refund called on DB save failure

- [ ] **Step 3: Replace tier check with credit spend**

Find the character save/sync function (likely `saveCharacter` or `syncCharacter`). Replace:

```typescript
// Old:
if (!CLOUD_CHARACTER_ALLOWED_PLANS.has(sub.planTier)) {
  throw new HttpsError('permission-denied', 'Cloud character sync requires a subscription.');
}

// New (add creditService dep injection to characterFunctions options):
const txId = await credits.spendCredits(userId, 1);
if (txId === null) {
  throw new HttpsError('failed-precondition', 'Insufficient credits.');
}

try {
  await saveCharacterToDb(character);
} catch (error) {
  await credits.refundCredit(userId, txId, 1);
  throw new HttpsError('internal', 'Failed to save character.');
}
```

Remove `CLOUD_CHARACTER_ALLOWED_PLANS` constant.

- [ ] **Step 4: Run tests and commit**

```bash
cd functions && npm test 2>&1 | grep -E "(characterFunctions|PASS|FAIL)"
git add functions/src/characterFunctions.ts functions/src/characterFunctions.test.ts
git commit -m "feat(callable): characterFunctions replaces plan-tier gate with credit spend"
```

---

## Task 7: Rewrite `documentExtract.ts`

**Files:**
- Modify: `functions/src/documentExtract.ts`
- Modify: `functions/src/documentExtract.test.ts`

- [ ] **Step 1: Identify current gate**

In `documentExtract.ts`, find `PREMIUM_TIERS` import from `./constants/plans.js` and any check that gates document ingestion to premium users. Also check for `MAX_DOCUMENTS_PER_DAY` rate limiting — keep the rate limit but remove the premium bypass.

- [ ] **Step 2: Replace premium gate with credit spend**

```typescript
// Remove: import { PREMIUM_TIERS } from './constants/plans.js';
// Remove: any premium tier check before document extraction

// Add (before calling the extraction API):
const txId = await credits.spendCredits(userId, 1);
if (txId === null) {
  throw new HttpsError('failed-precondition', 'Insufficient credits.');
}

try {
  result = await extractDocument(document);
} catch (error) {
  await credits.refundCredit(userId, txId, 1);
  if (error instanceof HttpsError) throw error;
  throw new HttpsError('internal', 'Failed to extract document.');
}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd functions && npm test 2>&1 | grep -E "(documentExtract|PASS|FAIL)"
git add functions/src/documentExtract.ts functions/src/documentExtract.test.ts
git commit -m "feat(callable): documentExtract replaces PREMIUM_TIERS gate with credit spend"
```

---

## Task 8: Rewrite `memoryFunctions.ts`

**Files:**
- Modify: `functions/src/memoryFunctions.ts`
- Modify: `functions/src/memoryFunctions.test.ts`

- [ ] **Step 1: Identify current gate**

In `memoryFunctions.ts`, find `hasUnlimited` check (bypasses credit spend for premium users) and `PREMIUM_TIERS` usage.

- [ ] **Step 2: Replace hasUnlimited bypass with universal credit spend**

```typescript
// Remove: hasUnlimited check, PREMIUM_TIERS reference

// Add before calling the memory/wiki API:
const txId = await credits.spendCredits(userId, 1);
if (txId === null) {
  throw new HttpsError('failed-precondition', 'Insufficient credits.');
}

try {
  result = await processMemory(input);
} catch (error) {
  await credits.refundCredit(userId, txId, 1);
  if (error instanceof HttpsError) throw error;
  throw new HttpsError('internal', 'Failed to process memory operation.');
}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd functions && npm test 2>&1 | grep -E "(memoryFunctions|PASS|FAIL)"
git add functions/src/memoryFunctions.ts functions/src/memoryFunctions.test.ts
git commit -m "feat(callable): memoryFunctions removes hasUnlimited bypass, spends 1 credit"
```

---

## Task 9: Delete `constants/plans.ts`

**Files:**
- Delete: `functions/src/constants/plans.ts`

- [ ] **Step 1: Confirm no remaining imports**

```bash
grep -r "constants/plans" ./functions/src/
```

Expected: no output. If any file still imports from `constants/plans`, update it first.

- [ ] **Step 2: Delete the file**

```bash
rm ./functions/src/constants/plans.ts
```

- [ ] **Step 3: Check if constants directory is now empty**

```bash
ls ./functions/src/constants/
```

If only `plans.ts` was in `constants/`, remove the directory too:

```bash
rmdir ./functions/src/constants/
```

If other files exist (e.g., `voiceDefaults.ts`), leave the directory.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete constants/plans.ts — PREMIUM_TIERS no longer referenced"
```

---

## Task 10: Full Build and Test Pass

- [ ] **Step 1: Full TypeScript build**

```bash
cd functions && npm run build
```

Expected: no errors. Watch specifically for any remaining references to `UNLIMITED_TIERS`, `PREMIUM_TIERS`, `hasUnlimited`, or old `spendCredits(userId, amount, reason, referenceId)` calls.

Fix any remaining usages before moving on.

- [ ] **Step 2: Full test suite**

```bash
cd functions && npm test
```

Expected: all tests pass. If any test still mocks `spendCredits` with 4 arguments, update those calls.

- [ ] **Step 3: Grep for remnants**

```bash
grep -r "UNLIMITED_TIERS\|PREMIUM_TIERS\|hasUnlimited\|CLOUD_CHARACTER_ALLOWED_PLANS" \
  ./functions/src/
```

Expected: no output.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "fix(phase-3): cleanup remaining unlimited-tier references"
```
