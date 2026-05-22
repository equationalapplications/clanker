# Credits Redesign Phase 4: Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all `hasUnlimited` / `isUnlimited` / `SUBSCRIPTION_TIERS` logic from frontend utilities and UI components. Update `CreditsDisplay` to show expiry date. Update subscribe, accept-terms, landing, terms, and privacy pages to reflect the new credit model.

**Architecture:** The `SubscriptionSnapshot` type gains `nextExpiryDate: string | null` (already returned by `exchangeToken` after Phase 2). The auth machine context carries this field. Frontend derives "credits expiring soon" from `nextExpiryDate` instead of `planTier`. All feature gates check `credits > 0` (or `>= 2` for voice) — no tier check.

**Tech Stack:** React Native / Expo, XState, `useSelector`, TypeScript

---

## Prerequisite

Phase 2 merged to staging. `exchangeToken` returns `nextExpiryDate` in the subscription snapshot.

---

## File Structure

- Modify: `src/auth/bootstrapSession.ts` — add `nextExpiryDate` to `SubscriptionSnapshot`
- Modify: `src/config/constants.ts` — remove `SUBSCRIPTION_TIERS`
- Modify: `src/utilities/getUserCredits.ts` — remove `hasUnlimited`, `isUnlimited`, `SUBSCRIPTION_TIERS`
- Modify: `src/hooks/useAuthSnapshot.ts` — remove `hasUnlimited`, simplify `AuthCreditsSnapshot`
- Modify: `src/hooks/useUserCredits.ts` — remove deductCredits (or simplify)
- Modify: `src/components/CreditCounterIcon.tsx` — remove premium infinite badge
- Modify: `src/components/CreditsDisplay.tsx` — remove unlimited UI; add expiry date display
- Modify: `src/views/ChatView.tsx` (or wherever `hasUnlimited` guards chat) — remove guard
- Modify: `src/hooks/useVoiceChat.ts` — update low-credit check to ≥ 2, update message text
- Modify: `app/(drawer)/subscribe.tsx` — rewrite for new credit model
- Modify: `app/(drawer)/accept-terms.tsx` — remove unlimited references
- Modify: `app/index.web.tsx` — update marketing copy
- Modify: `app/terms.tsx` — update ToS
- Modify: `app/privacy.tsx` — update credit language

---

## Task 1: Update `SubscriptionSnapshot` Type and Constants

**Files:**
- Modify: `src/auth/bootstrapSession.ts`
- Modify: `src/config/constants.ts`

- [ ] **Step 1: Add `nextExpiryDate` to `SubscriptionSnapshot`**

In `src/auth/bootstrapSession.ts`, update the interface:

```typescript
export interface SubscriptionSnapshot {
  planTier: string
  planStatus: string
  currentCredits: number
  termsVersion: string | null
  termsAcceptedAt: string | null
  nextExpiryDate: string | null   // ← add this
}
```

- [ ] **Step 2: Remove `SUBSCRIPTION_TIERS` from constants**

Open `src/config/constants.ts`. Find and remove:

```typescript
// Remove this:
// Subscription tiers where credits are NOT consumed
export const SUBSCRIPTION_TIERS: PlanTier[] = [
  PLAN_TIERS.MONTHLY_20,
  PLAN_TIERS.MONTHLY_50,
]
```

Keep `PLAN_TIERS` and all other constants.

- [ ] **Step 3: TypeScript check**

```bash
cd .
npx tsc --noEmit
```

Expected: errors in files that reference `SUBSCRIPTION_TIERS` or `hasUnlimited` — we fix those in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/auth/bootstrapSession.ts src/config/constants.ts
git commit -m "feat(frontend): add nextExpiryDate to SubscriptionSnapshot, remove SUBSCRIPTION_TIERS"
```

---

## Task 2: Rewrite `useAuthSnapshot.ts`

**Files:**
- Modify: `src/hooks/useAuthSnapshot.ts`

- [ ] **Step 1: Rewrite `AuthCreditsSnapshot` and `useAuthCredits`**

Replace `src/hooks/useAuthSnapshot.ts` with:

```typescript
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

export interface AuthCreditsSnapshot {
  totalCredits: number
  nextExpiryDate: string | null
}

export function useAuthSubscription(): SubscriptionSnapshot | null {
  const authService = useAuthMachine()
  return useSelector(authService, (state) => state.context.subscription)
}

export function useAuthCredits(): AuthCreditsSnapshot {
  const authService = useAuthMachine()
  const subscription = useSelector(authService, (state) => state.context.subscription)

  return {
    totalCredits: Math.max(0, subscription?.currentCredits ?? 0),
    nextExpiryDate: subscription?.nextExpiryDate ?? null,
  }
}

export function useAuthTerms(): { termsVersion: string | null; termsAcceptedAt: string | null } {
  const subscription = useAuthSubscription()
  return {
    termsVersion: subscription?.termsVersion ?? null,
    termsAcceptedAt: subscription?.termsAcceptedAt ?? null,
  }
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit 2>&1 | grep "useAuthSnapshot"
```

Fix any errors in files that imported `hasUnlimited` from this hook.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuthSnapshot.ts
git commit -m "feat(frontend): remove hasUnlimited from useAuthCredits, add nextExpiryDate"
```

---

## Task 3: Rewrite `getUserCredits.ts`

**Files:**
- Modify: `src/utilities/getUserCredits.ts`

- [ ] **Step 1: Simplify `getUserCredits`**

Replace `src/utilities/getUserCredits.ts` with:

```typescript
import { getCurrentUser } from '../config/firebaseConfig'
import { getUserState } from '../services/apiClient'

export interface UserCredits {
  totalCredits: number
  nextExpiryDate: string | null
}

export const getUserCredits = async (): Promise<UserCredits> => {
  if (!getCurrentUser()) {
    return { totalCredits: 0, nextExpiryDate: null }
  }

  try {
    const state = await getUserState()

    if (!state?.subscription) {
      return { totalCredits: 0, nextExpiryDate: null }
    }

    return {
      totalCredits: Math.max(0, state.subscription.currentCredits),
      nextExpiryDate: state.subscription.nextExpiryDate ?? null,
    }
  } catch (error) {
    console.error('Error checking user credits:', error)
    return { totalCredits: 0, nextExpiryDate: null }
  }
}
```

Remove `deductCredits` export if it is no longer called anywhere. Check:

```bash
grep -r "deductCredits" ./src/
```

If `deductCredits` is called from UI code (e.g., a "pay" button), keep it but update to remove `description` param (align with Phase 3's `spendCredits.ts` removal of description). If unused, delete it.

- [ ] **Step 2: Commit**

```bash
git add src/utilities/getUserCredits.ts
git commit -m "feat(frontend): simplify getUserCredits to return totalCredits + nextExpiryDate"
```

---

## Task 4: Update `CreditCounterIcon.tsx`

**Files:**
- Modify: `src/components/CreditCounterIcon.tsx`

- [ ] **Step 1: Remove premium infinite badge**

Open `src/components/CreditCounterIcon.tsx`. Find and remove:
- The `"👑∞"` or `"∞"` premium badge rendering
- Any `hasUnlimited` prop or check
- Any tooltip text like "Premium subscriber, unlimited credits"

The component should always show the numeric credit count. Example updated render:

```typescript
// Before (hasUnlimited variant):
// {hasUnlimited ? <Text>👑∞</Text> : <Text>{totalCredits}</Text>}

// After (always show count):
<Text>{totalCredits}</Text>
```

Update the component's props interface to remove `hasUnlimited` if it exists.

- [ ] **Step 2: Check callers**

```bash
grep -r "CreditCounterIcon" ./src/
```

Remove any `hasUnlimited` prop passed from caller sites.

- [ ] **Step 3: Commit**

```bash
git add src/components/CreditCounterIcon.tsx
git commit -m "feat(ui): CreditCounterIcon always shows numeric credit count"
```

---

## Task 5: Rewrite `CreditsDisplay.tsx`

**Files:**
- Modify: `src/components/CreditsDisplay.tsx`

- [ ] **Step 1: Remove unlimited UI, add expiry display**

Open `src/components/CreditsDisplay.tsx`. Remove:
- `unlimitedContainer` style
- `unlimitedChip` style
- "You have unlimited credits" text/view
- Any `hasUnlimited` prop or check

Add expiry date display. The component receives `nextExpiryDate: string | null` (ISO string). Display it only when credits exist and will expire:

```typescript
// Add near credit balance display:
{nextExpiryDate && totalCredits > 0 && (
  <Text style={styles.expiryText}>
    Credits expire {new Date(nextExpiryDate).toLocaleDateString()}
  </Text>
)}
```

Update the component props:

```typescript
interface CreditsDisplayProps {
  totalCredits: number
  nextExpiryDate: string | null
  // remove: hasUnlimited
}
```

Update the subscribe/purchase messaging:
- Monthly subscription button: "300 credits/month · $20"
- One-time pack button: "100 credits · $10"
- Remove any "unlimited" language

- [ ] **Step 2: Update callers**

```bash
grep -r "CreditsDisplay" ./src/
```

Update caller sites to pass `nextExpiryDate` instead of `hasUnlimited`.

- [ ] **Step 3: Commit**

```bash
git add src/components/CreditsDisplay.tsx
git commit -m "feat(ui): CreditsDisplay removes unlimited UI, shows credit expiry date"
```

---

## Task 6: Update `ChatView.tsx` and `useVoiceChat.ts`

**Files:**
- Modify: relevant chat view file (likely `src/views/ChatView.tsx` or similar)
- Modify: `src/hooks/useVoiceChat.ts`

- [ ] **Step 1: Remove `hasUnlimited` guard in ChatView**

Search for `hasUnlimited` in the chat view:

```bash
grep -rn "hasUnlimited" ./src/
```

For each occurrence in chat/message views:
- Remove `if (hasUnlimited) { ... }` branches
- The only gate is `credits <= 0` → show "insufficient credits" UI

Example:

```typescript
// Before:
const canSend = hasUnlimited || totalCredits > 0

// After:
const canSend = totalCredits > 0
```

- [ ] **Step 2: Update `useVoiceChat.ts` for 2-credit voice requirement**

Open `src/hooks/useVoiceChat.ts`. Find the insufficient-credits check. Update:

```typescript
// Before (1-credit check or hasUnlimited bypass):
// if (!hasUnlimited && credits < 1) { showMessage('Subscribe for unlimited access') }

// After (voice requires 2 credits):
const VOICE_CREDIT_COST = 2
if (totalCredits < VOICE_CREDIT_COST) {
  // Show low-credit message
  showMessage('You need at least 2 credits for voice replies. Purchase more credits to continue.')
  return
}
```

Also update any text that says "subscribe for unlimited" → "purchase more credits".

- [ ] **Step 3: Commit**

```bash
git add src/ # stage only modified files
git commit -m "feat(ui): chat gates on credits > 0; voice requires >= 2 credits"
```

---

## Task 7: Update Pages

**Files:**
- Modify: `app/(drawer)/subscribe.tsx`
- Modify: `app/(drawer)/accept-terms.tsx`
- Modify: `app/index.web.tsx`
- Modify: `app/terms.tsx`
- Modify: `app/privacy.tsx`

- [ ] **Step 1: Rewrite `subscribe.tsx`**

The subscribe page should present the two credit options clearly:

```
Monthly Plan — $20/month
• 300 credits per billing cycle
• Credits expire at the end of each billing cycle
• All features: chat, voice, image generation, document import, memory

One-Time Pack — $10
• 100 credits
• Valid for 31 days from purchase
• All features available with sufficient credits
```

Remove all "unlimited credits" language. Remove any text like "never run out of credits" or "unlimited for subscribers".

- [ ] **Step 2: Update `accept-terms.tsx`**

Search for and remove:
- "unlimited credits"
- "credits not consumed for subscribers"
- "premium only features"

Replace with accurate language:
- "300 credits per month ($20/month) or 100 credits one-time ($10)"
- "Free credits from signup never expire"
- "Purchased credits expire after 31 days"

- [ ] **Step 3: Update `index.web.tsx` marketing copy**

Remove "unlimited credits" from marketing copy. Replace with:
- "300 credits/month for $20 — chat, voice, image generation, and more"
- "One-time packs: 100 credits for $10"
- Brief explanation of credit expiry

- [ ] **Step 4: Update `terms.tsx`**

Add/update credit expiry policy section:
```
Credits: Free signup credits (50 credits) never expire. Credits from monthly 
subscriptions expire at the end of each billing cycle. One-time credit pack 
purchases expire 31 days from purchase date. All features are available to 
any user with sufficient credits.
```

Remove "unlimited access for subscribers" language.

- [ ] **Step 5: Update `privacy.tsx`**

Search for credit-related language. Update any references to unlimited, premium-only, or subscription-exclusive features.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "feat(pages): update subscribe, terms, privacy, landing for new credit model

Remove unlimited language throughout. Describe 300 credits/month ($20) and
100 credits one-time ($10). Document credit expiry policy (31-day for paid,
never for signup credits)."
```

---

## Task 8: Final TypeScript Build and Smoke Test

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any remaining `hasUnlimited`, `isUnlimited`, or `SUBSCRIPTION_TIERS` references.

- [ ] **Step 2: Grep for remnants**

```bash
grep -rn "hasUnlimited\|isUnlimited\|SUBSCRIPTION_TIERS\|unlimited credits\|unlimited access" \
  ./src/ \
  ./app/
```

Address each occurrence. Marketing copy in landing page may intentionally retain value language — ensure it describes credits, not "unlimited".

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix(frontend): phase 4 cleanup — remove remaining unlimited references"
```
