# Power Meter & 100x Credit Inflation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiply all credit units ×100 (DB + constants), rename the user-facing unit to "Power", and replace the numeric header badge with a plan-relative power meter with soft low-power UX.

**Architecture:** One SQL migration inflates stored balances; every cost/grant constant becomes its final ×100 literal (no runtime scaling). Bootstrap gains `grantedTotal` (SUM of `initial_amount` over live rows) so the client computes fill = remaining/granted. A single `usePowerBalance` hook translates credits→Power for the UI; a new `PowerMeter` component replaces `CreditCounterIcon`.

**Tech Stack:** Postgres (hand-written Drizzle SQL migrations — never `drizzle-kit generate`), Firebase Functions (TypeScript, jest), cloud-agent (TypeScript), Expo/React Native + react-native-paper, XState auth machine.

**Spec:** `docs/superpowers/specs/2026-07-07-power-meter-credit-inflation-design.md`

**Verification baseline:** run `npx jest` (root), `cd functions && npm test`, `cd cloud-agent && npm test` before starting; note any pre-existing failures.

---

### Task 1: SQL migration — inflate stored balances ×100

**Files:**
- Create: `functions/drizzle/0020_credit_power_scale.sql`

- [ ] **Step 1: Write the migration** (next free index is 0020; check `ls functions/drizzle` first — if 0020 exists, use the next number and adjust filename below)

```sql
-- Inflate all credit units by 100 (user-facing unit becomes "Power").
-- Historical conversion factor CREDIT_SCALE = 100. Run exactly once.
UPDATE credit_transactions
SET initial_amount = initial_amount * 100,
    remaining_balance = remaining_balance * 100;

UPDATE subscriptions
SET current_credits = current_credits * 100;
```

Note: `subscriptions.current_credits` is a cache synced from the ledger (`syncSubscriptionCache`); inflate it too so the cache is consistent until the first sync.

- [ ] **Step 2: Verify on local DB**

Start local stack per `docs/db-migrations.md` / memory (`docker compose -f docker-compose.local.yml up -d`, `npm run migrate:dev`, seed via `scripts/seedLocal.ts` if DB fresh). Then:

```bash
psql "$LOCAL_DB_URL" -c "SELECT SUM(remaining_balance) FROM credit_transactions;"
# record value N, apply migration (migrate:dev picks it up), then:
psql "$LOCAL_DB_URL" -c "SELECT SUM(remaining_balance) FROM credit_transactions;"
# Expected: exactly N * 100
```

- [ ] **Step 3: Commit**

```bash
git add functions/drizzle/0020_credit_power_scale.sql
git commit -m "feat(db): inflate credit units x100 for Power migration"
```

---

### Task 2: Functions — grant & cost constants ×100

**Files:**
- Modify: `functions/src/services/subscriptionService.ts:68` (signup 50 → 5000)
- Modify: `functions/src/stripeWebhook.ts:429,523,591` (300 → 30000) and pack grant call sites near lines 453, 616 (100 → 10000)
- Modify: `functions/src/revenueCatWebhook.ts:407` (300 → 30000) and pack grants near lines 426, 489 (100 → 10000)
- Modify: `functions/src/generateReply.ts:536` (`computeReplyCost`: 1→100, 3→300)
- Modify: `functions/src/summarizeText.ts:15` (`SUMMARIZE_TEXT_COST = 100`)
- Modify: `functions/src/generateImage.ts:127` (2 → 200)
- Modify: `functions/src/convertDocumentText.ts:187` (2 → 200)
- Modify: `functions/src/generateEmbedding.ts:14` (`computeEmbeddingCreditCost`: `Math.ceil(...) * 100`)
- Modify: `functions/src/wikiLlm.ts:159`, `functions/src/wikiSync.ts:785`, `functions/src/memoryFunctions.ts:1500,1561`, `functions/src/characterFunctions.ts:164` (1 → 100)
- Test: corresponding existing `*.test.ts` files

- [ ] **Step 1: Update the two computed-cost functions**

```typescript
// functions/src/generateReply.ts
function computeReplyCost(tools?: ToolDeclaration[]): number {
  return tools && tools.length > 0 ? 100 : 300;
}
```

```typescript
// functions/src/generateEmbedding.ts
const EMBEDDING_COST_PER_WINDOW = 100;

export function computeEmbeddingCreditCost(textLength: number): number {
  return Math.ceil(textLength / EMBEDDING_CHARS_PER_CREDIT) * EMBEDDING_COST_PER_WINDOW;
}
```

- [ ] **Step 2: Update all literal spend/grant amounts**

Exact replacements at the file:line locations listed above. Sanity sweep afterward:

```bash
grep -rn "spendCredits(" functions/src --include="*.ts" | grep -v test | grep -vE "100|200|300|500|cost|amount|COST"
# Expected: no remaining single-digit literal spends
```

- [ ] **Step 3: Update existing Functions tests to new constants**

Mechanical sweep: run `cd functions && npm test`; every failure will be an assertion on an old amount (50/300/100/1/2/3). Update expected values ×100 — e.g. signup grant assertions to 5000, webhook grant assertions to 30000/10000, reply cost to 100/300, embedding cost cases to multiples of 100. Do NOT change test structure or delete tests.

- [ ] **Step 4: Run Functions tests**

Run: `cd functions && npm test`
Expected: PASS (same pass/fail set as the pre-task baseline)

- [ ] **Step 5: Commit**

```bash
git add functions/src
git commit -m "feat(functions): credit costs and grants x100 (Power units)"
```

---

### Task 3: Cloud-agent — costs, voice billing, connect gate ×100

**Files:**
- Modify: `cloud-agent/src/services/creditService.ts:23` (`amount = 1` → `amount = 100`)
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts:352` (`balance < 5` → `balance < 500`) and `:375` (`spendCredit(userId!, 5)` → `spendCredit(userId!, 500)`)
- Test: cloud-agent test files covering these (find via `grep -rln "spendCredit\|INSUFFICIENT_CREDITS" cloud-agent/src --include="*.test.ts"`)

- [ ] **Step 1: Change the default spend amount**

```typescript
// cloud-agent/src/services/creditService.ts
async spendCredit(userId: string, amount = 100): Promise<CreditSpendAllocation[]> {
```

This single default covers agent loop iterations (`agentEventLoop.ts:104`), scheduler trigger (`schedulerTriggerHandler.ts:187`), and voice `browser_action` (`browserAction.ts:96`) — all call `spendCredit(userId)` with no amount. Verify no other explicit amounts exist:

```bash
grep -rn "spendCredit(" cloud-agent/src --include="*.ts" | grep -v test | grep -E ", [0-9]"
# Expected: only wsLiveAgentHandler.ts voice spends (change those to 500)
```

- [ ] **Step 2: Voice gate and per-minute spend**

At `wsLiveAgentHandler.ts:352` change `if (balance < 5)` to `if (balance < 500)`. At `:375` change `spendCredit(userId!, 5)` to `spendCredit(userId!, 500)`. Check `makeBillingController` (`wsLiveAgentHandler.ts:36-65`) and the surrounding handler for any other literal `5` spend/gate amounts and update them to 500 as well.

- [ ] **Step 3: Update cloud-agent tests to new constants**

Run `cd cloud-agent && npm test`; update failing amount assertions (1→100, 5→500). No structural changes.

- [ ] **Step 4: Run cloud-agent tests**

Run: `cd cloud-agent && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src
git commit -m "feat(cloud-agent): credit costs and voice gate x100 (Power units)"
```

---

### Task 4: Backend `grantedTotal` in credit service + bootstrap payload

**Files:**
- Modify: `functions/src/services/creditService.ts` (add `getGrantedTotal`)
- Modify: `functions/src/exchangeToken.ts` (include `grantedTotal` in response payload next to synced credits)
- Test: `functions/src/services/creditService.test.ts`, `functions/src/exchangeToken.test.ts`

- [ ] **Step 1: Write failing test for `getGrantedTotal`**

Add to `functions/src/services/creditService.test.ts`, following the existing mock-db test style in that file:

```typescript
describe('getGrantedTotal', () => {
  it('sums initial_amount over live rows only (remaining > 0, unexpired)', async () => {
    // rows: signup 5000/5000 live; pack 10000/0 exhausted; sub 30000/1200 live;
    // expired pack 10000/400 (expires_at in past)
    // Expected grantedTotal: 5000 + 30000 = 35000
  });
  it('returns 0 when user has no live rows', async () => { /* expect 0 */ });
});
```

Implement the row fixtures using the same mock/transaction helpers the file already uses for `getCredits`/`spendCredits` tests (mirror an existing `describe` block).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx jest creditService -t getGrantedTotal`
Expected: FAIL — `getGrantedTotal is not a function`

- [ ] **Step 3: Implement `getGrantedTotal`**

Add to the service object in `createCreditService` (`functions/src/services/creditService.ts`), next to `getCredits`:

```typescript
async getGrantedTotal(userId: string): Promise<number> {
  const db = await deps.getDb();
  const rows = await db
    .select({ total: sql<string>`COALESCE(SUM(${creditTransactions.initialAmount}), 0)` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        gt(creditTransactions.remainingBalance, 0),
        or(isNull(creditTransactions.expiresAt), gt(creditTransactions.expiresAt, new Date())),
      ),
    );
  return Number(rows[0]?.total ?? 0);
},
```

Match the file's actual imports/identifiers (`creditTransactions` schema object, drizzle `and/or/eq/gt/isNull/sql` helpers) — reuse whatever the `getCredits`/spend queries already import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx jest creditService -t getGrantedTotal`
Expected: PASS

- [ ] **Step 5: Add `grantedTotal` to exchangeToken payload (test-first)**

In `functions/src/exchangeToken.test.ts`, extend an existing success-path test to assert the response includes `grantedTotal` from `creditService.getGrantedTotal`. Then in `functions/src/exchangeToken.ts`, next to the `syncedCredits` fetch (line ~94):

```typescript
let grantedTotal = 0;
try {
    grantedTotal = await deps.creditService.getGrantedTotal(user.id);
} catch (grantedError) {
    logger.warn("creditService.getGrantedTotal failed, meter will show loading state", { userId: user.id, grantedError });
}
```

Include `grantedTotal` in the returned payload alongside the existing credits/subscription fields (find where `syncedCredits` is placed in the response object and add `grantedTotal` there). Failure mode: `grantedTotal: 0` — client treats 0 as "unknown" and shows the loading meter (spec §5).

- [ ] **Step 6: Run Functions tests**

Run: `cd functions && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add functions/src
git commit -m "feat(functions): expose grantedTotal for power meter denominator"
```

---

### Task 5: Client plumbing — `grantedTotal` through bootstrap + `usePowerBalance` hook

**Files:**
- Modify: `src/auth/bootstrapSession.ts` (carry `grantedTotal` from exchangeToken response)
- Modify: `src/machines/authMachine.ts` (store `grantedTotal` in context subscription snapshot, alongside `currentCredits` handling at line ~390)
- Modify: `src/hooks/useAuthSnapshot.ts` (expose `grantedTotal` in `AuthCreditsSnapshot`)
- Create: `src/hooks/usePowerBalance.ts`
- Test: `__tests__/usePowerBalance.test.ts` (follow the pattern of existing hook tests in `__tests__/`)

- [ ] **Step 1: Thread `grantedTotal` through bootstrap → machine → snapshot**

Follow the exact path `currentCredits` takes today: `src/auth/bootstrapSession.ts` (payload parse, ~line 20/70), `src/machines/authMachine.ts` (~line 390), `src/hooks/useAuthSnapshot.ts` (add to `AuthCreditsSnapshot`):

```typescript
// useAuthSnapshot.ts — AuthCreditsSnapshot gains:
grantedTotal: number   // 0 = unknown/loading
```

Default to `0` wherever `currentCredits` defaults today.

- [ ] **Step 2: Write failing tests for `usePowerBalance`**

`__tests__/usePowerBalance.test.ts` — pure-logic tests via the exported helper (Step 3) so no renderer gymnastics needed:

```typescript
import { computePowerFill } from '~/hooks/usePowerBalance'

describe('computePowerFill', () => {
  it('quantizes bar to 5% steps', () =>
    expect(computePowerFill(15100, 30000).barFill).toBe(0.5))
  it('keeps minimum sliver when balance > 0 rounds to 0', () =>
    expect(computePowerFill(100, 5000).barFill).toBe(0.03))
  it('renders empty at zero balance', () =>
    expect(computePowerFill(0, 5000).barFill).toBe(0))
  it('bands use raw ratio, not quantized', () => {
    expect(computePowerFill(1100, 30000).band).toBe('red')     // 3.7%
    expect(computePowerFill(4000, 30000).band).toBe('amber')   // 13.3%
    expect(computePowerFill(20000, 30000).band).toBe('normal')
  })
  it('full at grant', () =>
    expect(computePowerFill(30000, 30000).barFill).toBe(1))
  it('unknown capacity yields loading state', () =>
    expect(computePowerFill(5000, 0).isUnknown).toBe(true))
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest usePowerBalance`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the hook**

```typescript
// src/hooks/usePowerBalance.ts
import { useUserCredits } from '~/hooks/useUserCredits'
import { useAuthCredits } from '~/hooks/useAuthSnapshot'

export type PowerBand = 'normal' | 'amber' | 'red'

export interface PowerFill {
  rawFill: number
  barFill: number
  band: PowerBand
  isUnknown: boolean
}

const MIN_SLIVER = 0.03

export function computePowerFill(totalPower: number, grantedPower: number): PowerFill {
  if (grantedPower <= 0) {
    return { rawFill: 0, barFill: 0, band: 'red', isUnknown: true }
  }
  const rawFill = Math.min(totalPower / grantedPower, 1)
  let barFill = Math.round(rawFill * 20) / 20
  if (totalPower > 0 && barFill === 0) {
    barFill = MIN_SLIVER
  }
  const band: PowerBand = rawFill >= 0.2 ? 'normal' : rawFill >= 0.05 ? 'amber' : 'red'
  return { rawFill, barFill, band, isUnknown: false }
}

export function usePowerBalance() {
  const { data, isLoading } = useUserCredits()
  const { grantedTotal } = useAuthCredits()
  const totalPower = data?.totalCredits ?? 0
  const fill = computePowerFill(totalPower, grantedTotal)
  return {
    totalPower,
    grantedPower: grantedTotal,
    ...fill,
    isLoading: isLoading || fill.isUnknown,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest usePowerBalance`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/bootstrapSession.ts src/machines/authMachine.ts src/hooks/useAuthSnapshot.ts src/hooks/usePowerBalance.ts __tests__/usePowerBalance.test.ts
git commit -m "feat: grantedTotal plumbing and usePowerBalance hook"
```

---

### Task 6: `PowerMeter` component replaces `CreditCounterIcon`

**Files:**
- Create: `src/components/PowerMeter.tsx`
- Modify: `app/(drawer)/_layout.tsx:12,124` (swap import + `headerRight`)
- Delete: `src/components/CreditCounterIcon.tsx` (after swap; also delete its test if one exists — check `__tests__/`)
- Test: `__tests__/PowerMeter.test.tsx`

- [ ] **Step 1: Write failing render tests**

`__tests__/PowerMeter.test.tsx`, using the project's existing component-test pattern (`@testing-library/react-native`, paper providers — copy setup from an existing component test such as any in `__tests__/` that renders paper components):

```typescript
// Mock ~/hooks/usePowerBalance per test:
// loading: { isLoading: true } → testID 'power-meter-loading' present, a11y label "Power loading"
// loaded 85%: { barFill: 0.85, band: 'normal', rawFill: 0.85, isLoading: false }
//   → fill element testID 'power-meter-fill' has width '85%', a11y label "Power at 85%"
// red band: { barFill: 0.05, band: 'red', rawFill: 0.03 } → fill uses error color
// press → router.push('/(drawer)/subscribe') (mock expo-router as other tests do)
// asserts NO numeric balance text is rendered
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest PowerMeter`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PowerMeter`**

```tsx
// src/components/PowerMeter.tsx
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useTheme } from 'react-native-paper'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { usePowerBalance, PowerBand } from '~/hooks/usePowerBalance'

const METER_WIDTH = 44
const METER_HEIGHT = 14

export function PowerMeter() {
  const router = useRouter()
  const theme = useTheme()
  const { isSubscriber } = useCurrentPlan()
  const { barFill, band, rawFill, isLoading } = usePowerBalance()

  const bandColor: Record<PowerBand, string> = {
    normal: theme.colors.primary,
    amber: '#E6A817',
    red: theme.colors.error,
  }

  const percent = Math.round(rawFill * 100)
  // isSubscriber from useCurrentPlan (same import pattern as old CreditCounterIcon)
  const accessibilityLabel = isLoading
    ? 'Power loading'
    : `Power at ${percent}%${isSubscriber ? ', refills monthly' : ''}`

  return (
    <Pressable
      onPress={() => router.push('/(drawer)/subscribe')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens Power and subscription management"
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 10 })}
      testID={isLoading ? 'power-meter-loading' : 'power-meter'}
    >
      <View
        style={{
          width: METER_WIDTH,
          height: METER_HEIGHT,
          borderRadius: METER_HEIGHT / 2,
          borderWidth: 1.5,
          borderColor: theme.colors.outline,
          backgroundColor: theme.colors.surfaceVariant,
          overflow: 'hidden',
          opacity: isLoading ? 0.4 : 1,
        }}
      >
        <View
          testID="power-meter-fill"
          style={{
            width: `${(isLoading ? 0 : barFill) * 100}%`,
            height: '100%',
            backgroundColor: bandColor[band],
          }}
        />
      </View>
    </Pressable>
  )
}
```

(Amber is hardcoded because paper's MD3 theme has no warning color; keep as a named constant if lint complains.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest PowerMeter`
Expected: PASS

- [ ] **Step 5: Swap into the header and delete the old badge**

In `app/(drawer)/_layout.tsx`: replace the `CreditCounterIcon` import (line 12) with `import { PowerMeter } from '~/components/PowerMeter'` and line 124 with `headerRight: () => <PowerMeter />,`. Delete `src/components/CreditCounterIcon.tsx` and any test referencing it:

```bash
grep -rln "CreditCounterIcon" src app __tests__
# Expected after edits: no matches
```

- [ ] **Step 6: Run full client test suite**

Run: `npx jest`
Expected: PASS (baseline failures only)

- [ ] **Step 7: Commit**

```bash
git add -A src/components app/"(drawer)"/_layout.tsx __tests__
git commit -m "feat: replace credit badge with PowerMeter"
```

---

### Task 7: Client voice gate ×100 + "Power" copy in voice strings

**Files:**
- Modify: `src/hooks/useLiveVoiceChat.ts:31` (`MIN_CREDITS_FOR_CALL = 500`) and user-facing strings at lines ~140, ~210
- Test: existing `useLiveVoiceChat` tests (find: `grep -rln "MIN_CREDITS_FOR_CALL\|useLiveVoiceChat" __tests__ src`)

- [ ] **Step 1: Update gate and copy**

```typescript
const MIN_CREDITS_FOR_CALL = 500
// line ~140:
'Live voice calls need more Power. Recharge to continue.',
// line ~210:
'Out of Power. Tap to recharge.',
```

- [ ] **Step 2: Update affected tests, run**

Run: `npx jest useLiveVoiceChat`
Expected: PASS after updating amount/string assertions

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLiveVoiceChat.ts __tests__
git commit -m "feat: voice gate 500 Power and friendly copy"
```

---

### Task 8: Soft low-power UX (amber banner, red composer hint, Out of Power errors)

**Files:**
- Create: `src/components/LowPowerBanner.tsx`
- Modify: `src/components/ChatView.tsx` (mount banner), `src/components/ChatComposer.tsx` + `src/components/ChatComposer.web.tsx` (red-band hint; rewrite insufficient-credit error copy)
- Test: `__tests__/LowPowerBanner.test.tsx`

- [ ] **Step 1: Write failing tests for `LowPowerBanner`**

```typescript
// __tests__/LowPowerBanner.test.tsx — mock usePowerBalance:
// band 'normal' → renders null
// band 'amber' → renders "Power getting low" once; dismiss hides it; re-render with amber again in same mount does NOT re-show (once per session)
// band 'red' → renders "Low Power — recharge to keep chatting" with recharge link → router.push('/(drawer)/subscribe')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest LowPowerBanner`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/components/LowPowerBanner.tsx
import { useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Banner } from 'react-native-paper'
import { usePowerBalance } from '~/hooks/usePowerBalance'

let amberShownThisSession = false
export function resetLowPowerSession() { amberShownThisSession = false }  // test hook

export function LowPowerBanner() {
  const router = useRouter()
  const { band, isLoading } = usePowerBalance()
  const [dismissed, setDismissed] = useState(false)
  const amberEligible = useRef(!amberShownThisSession)

  if (isLoading || dismissed) return null

  if (band === 'red') {
    return (
      <Banner
        visible
        actions={[{ label: 'Recharge', onPress: () => router.push('/(drawer)/subscribe') }]}
      >
        Low Power — recharge to keep chatting.
      </Banner>
    )
  }

  if (band === 'amber' && amberEligible.current) {
    amberShownThisSession = true
    return (
      <Banner
        visible
        actions={[
          { label: 'Recharge', onPress: () => router.push('/(drawer)/subscribe') },
          { label: 'Dismiss', onPress: () => setDismissed(true) },
        ]}
      >
        Power getting low.
      </Banner>
    )
  }

  return null
}
```

Mount `<LowPowerBanner />` in `src/components/ChatView.tsx` above the message list (find the top-level container; place banner as first child).

- [ ] **Step 4: Rewrite insufficient-credit error copy in composers**

```bash
grep -rn -i "insufficient\|credits" src/components/ChatComposer.tsx src/components/ChatComposer.web.tsx src/components/ChatView.tsx
```

Replace any user-facing "Insufficient credits" / "credits" strings with: `Out of Power — recharge to keep chatting.` Keep error *codes* and non-UI identifiers unchanged. If the composer surfaces raw backend error messages (`Insufficient credits.` from `generateReply`), map the `failed-precondition` insufficient case to the friendly string at the display site.

- [ ] **Step 5: Run tests**

Run: `npx jest LowPowerBanner ChatComposer ChatView`
Expected: PASS (update any string assertions)

- [ ] **Step 6: Commit**

```bash
git add src/components __tests__
git commit -m "feat: soft low-power UX with banner and friendly copy"
```

---

### Task 9: Subscribe screen — Power copy, refill framing, single pricing section

**Files:**
- Modify: `app/(drawer)/subscribe.tsx`
- Test: existing subscribe screen tests if any (`grep -rln "subscribe" __tests__`)

- [ ] **Step 1: Copy sweep**

In `app/(drawer)/subscribe.tsx`:
- All "credit(s)" strings → "Power"; amounts shown ×100: signup bonus "5,000 Power", monthly "30,000 Power, refills every month", pack "10,000 Power (valid 31 days)".
- This screen is the ONLY place that shows the exact balance: add a line near the top using `usePowerBalance` — `“{totalPower.toLocaleString()} Power available”`.
- Single pricing-info section listing per-action Power costs (chat 100–300, image 200, voice 500/min, etc.) — the only surface in the app where costs appear.

- [ ] **Step 2: App-wide cost-copy audit**

```bash
grep -rn -iE "cost[s]? [0-9]|[0-9]+ credit" src app --include="*.tsx" --include="*.ts" | grep -v test
# Remove/relocate any per-action cost copy found outside subscribe.tsx
grep -rn -i "credit" src/components src/hooks app --include="*.tsx" | grep -vi "test\|CreditCounter" | grep -iE "'[^']*credit|\"[^\"]*credit"
# Expected: no user-facing "credit" strings remain (identifiers are fine)
```

- [ ] **Step 3: Run client tests**

Run: `npx jest`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app src
git commit -m "feat: subscribe screen Power copy and pricing section"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/billing-and-credits.md`

- [ ] **Step 1: Rewrite unit tables**

- Add at top: *"User-facing unit name: **Power**. Backend code and schema keep `credit` naming. Units were inflated ×100 on 2026-07-07 (migration 0020)."*
- Credit Model Reference: 5,000 signup / 30,000 monthly / 10,000 pack.
- Credit Consumption table: all costs ×100 (300/100 text, 200 image, 200 doc, 100 summarize, 100/50k chars embeddings, 100 wiki/memory, 100/iteration cap 500 agent, 500+500/60s voice, ≥500 gate, 100 scheduler, 100 browser_action voice).
- Note the new `grantedTotal` bootstrap field and its live-rows definition (`remaining_balance > 0` AND unexpired).

- [ ] **Step 2: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs: billing doc in Power units with grantedTotal"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full test suites**

```bash
npx jest && (cd functions && npm test) && (cd cloud-agent && npm test)
```
Expected: all PASS (modulo pre-existing baseline failures noted at start).

- [ ] **Step 2: Grep gates**

```bash
grep -rn "CreditCounterIcon" src app __tests__            # expect: none
grep -rn "spendCredits(user.id, [1-9])\b" functions/src    # expect: none
```

- [ ] **Step 3: Manual smoke (local stack)**

Local DB up, migration applied, run app (web): header shows meter (not number); subscribe screen shows exact Power; send a chat message → meter unchanged visually (coarse steps).

**Deploy order reminder (release time, not part of this branch):** 1) run migration, 2) deploy Functions + cloud-agent, 3) publish app/OTA.
