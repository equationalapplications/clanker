# Credit Economy Repricing (July 2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the finalized July 2026 credit pricing table — metered live-voice and agent-loop billing, new billing on previously-free summarize/embedding calls, a grounded/standard split on chat, and the cloud-agent multi-row credit allocator needed to support >1-credit spends.

**Architecture:** Three independently-testable areas, in dependency order: (1) `cloud-agent/` — port a multi-row FIFO credit allocator, ripple its new type through five callers, then move agent-turn billing inside the ADK tool loop; (2) `functions/` — bump/add per-callable credit costs, including a new grounded/standard split in `generateReply`; (3) client + docs — connect-gate constant and consumer-facing copy. cloud-agent goes first because its type change is foundational and has zero product-behavior risk on its own (pure refactor + new tests) before the riskier loop-billing change lands on top of it.

**Tech Stack:** TypeScript, Firebase Functions v2 (`onCall`), Express + `ws` on Cloud Run, Drizzle ORM (raw SQL via `sql` tagged templates in cloud-agent, query builder in functions), `@google/adk` agent runner, Node's built-in `node:test` + `node:assert/strict`, React Native hooks (Jest) for the client hook.

**Full pricing table, locked decisions (hard cutover, no rate versioning, `LOW_CREDIT_THRESHOLD` stays 5, embedding `MAX_TEXT_LENGTH` stays 8,000), and the "what does NOT change" list all live in the approved spec — read `docs/superpowers/specs/2026-07-01-credit-economy-repricing-design.md` before starting if anything below is ambiguous.**

---

## Task 1: Port multi-row FIFO credit allocator into cloud-agent

**Why first:** cloud-agent's `spendCredit` currently does a single-row atomic decrement and can only ever spend exactly 1 credit. Live voice needs 5 credits/tick, which can span multiple `credit_transactions` rows for a user with a fragmented balance. This task replaces the single-row implementation with the same multi-row FIFO allocator `functions/src/services/creditService.ts` already uses (translated from Drizzle's query builder into cloud-agent's raw-SQL `tx.execute(sql\`...\`)` style, since cloud-agent has no typed Drizzle schema for these tables).

**Files:**
- Modify: `cloud-agent/src/services/creditService.ts`
- Modify: `cloud-agent/src/services/creditService.test.ts`

- [ ] **Step 1: Write failing tests for multi-row spend and array-shaped refund**

Add these tests to `cloud-agent/src/services/creditService.test.ts`, right after the existing `test('spendCredit does not update subscriptions when spend fails', ...)` block (before the `// ── refundCredit ──` comment):

```typescript
test('spendCredit spans multiple rows when amount exceeds the first row balance', async () => {
  // Call 1: INSERT subscriptions
  // Call 2: SELECT FOR UPDATE on subscriptions
  // Call 3: SELECT SUM(...) net active balance -> '7' (>= 5)
  // Call 4: SELECT id, remaining_balance ... FOR UPDATE -> two rows (3, then 4)
  // Call 5: UPDATE credit_transactions row tx-1 (- 3)
  // Call 6: UPDATE credit_transactions row tx-2 (- 2)
  // Call 7: UPDATE subscriptions current_credits cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '7' }] },
    { rows: [{ id: 'tx-1', remaining_balance: '3' }, { id: 'tx-2', remaining_balance: '4' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 5)
  assert.deepEqual(allocations, [
    { transactionId: 'tx-1', amount: 3 },
    { transactionId: 'tx-2', amount: 2 },
  ])
})

test('spendCredit throws INSUFFICIENT_CREDITS when net balance across all rows is short', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE, Call 3: SELECT SUM -> '3' (< 5)
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [{ total: '3' }] }])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 5),
    (err: Error) => {
      assert.equal(err.message, 'INSUFFICIENT_CREDITS')
      return true
    },
  )
})

test('spendCredit defaults amount to 1 when not passed', async () => {
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '1' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '1' }] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1')
  assert.deepEqual(allocations, [{ transactionId: 'tx-abc', amount: 1 }])
})

test('refundCredit restores every row in a multi-row allocation atomically', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: UPDATE credit_transactions tx-1 RETURNING id
  // Call 4: UPDATE credit_transactions tx-2 RETURNING id
  // Call 5: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ id: 'tx-1' }] },
    { rows: [{ id: 'tx-2' }] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  await assert.doesNotReject(() =>
    cs.refundCredit('user-1', [
      { transactionId: 'tx-1', amount: 3 },
      { transactionId: 'tx-2', amount: 2 },
    ]),
  )
})

test('refundCredit is a no-op for an empty allocation array', async () => {
  let executeCalls = 0
  const db = {
    execute: async () => { executeCalls++; return { rows: [] } },
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) =>
      callback({ execute: async () => { executeCalls++; return { rows: [] } } } as unknown as DrizzleClient),
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', [])
  assert.equal(executeCalls, 0)
})
```

Also update the two existing single-row tests immediately above (`'spendCredit returns txId when a qualifying row exists'` and `'refundCredit resolves without throwing'`) to the new shapes:

```typescript
test('spendCredit returns an allocation array when a qualifying row exists', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: SELECT SUM net active balance, Call 4: SELECT id, remaining_balance FOR UPDATE
  // Call 5: UPDATE credit_transactions, Call 6: UPDATE subscriptions cache
  const db = makeExecuteDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '1' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '1' }] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  const allocations = await cs.spendCredit('user-1', 1)
  assert.deepEqual(allocations, [{ transactionId: 'tx-abc', amount: 1 }])
})
```

```typescript
test('refundCredit resolves without throwing', async () => {
  // Call 1: INSERT subscriptions, Call 2: SELECT FOR UPDATE subscriptions
  // Call 3: UPDATE credit_transactions RETURNING id, Call 4: UPDATE subscriptions cache
  const db = makeExecuteDb([{ rows: [] }, { rows: [{ user_id: 'user-1' }] }, { rows: [{ id: 'tx-abc' }] }, { rows: [] }])
  const cs = createCreditService(db)
  await assert.doesNotReject(() => cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 1 }]))
})
```

And the `'refundCredit makes correct number of execute calls'` test's call to `cs.refundCredit('user-1', 'tx-abc')` becomes `cs.refundCredit('user-1', [{ transactionId: 'tx-abc', amount: 1 }])` (same execute-call-count assertion logic still applies, one row instead of a raw string).

- [ ] **Step 2: Run tests to verify they fail (compile error expected — types don't match yet)**

Run: `cd cloud-agent && npm run build 2>&1 | head -40`
Expected: TypeScript errors on `spendCredit`/`refundCredit` call sites in the test file — `Argument of type 'string' is not assignable to parameter of type 'number'` (old signature took `(userId)` only) or similar, since the implementation hasn't changed yet.

- [ ] **Step 3: Port the multi-row FIFO allocator into the implementation**

Replace the full contents of `cloud-agent/src/services/creditService.ts`:

```typescript
import { sql } from 'drizzle-orm'
import type { DrizzleClient } from '../db/client.js'

export type CreditSpendAllocation = {
  transactionId: string
  amount: number
}

export type CreditService = {
  spendCredit: (userId: string, amount?: number) => Promise<CreditSpendAllocation[]>
  refundCredit: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>
  getBalance: (userId: string) => Promise<number>
}

export function createCreditService(db: DrizzleClient): CreditService {
  return {
    async spendCredit(userId: string, amount = 1): Promise<CreditSpendAllocation[]> {
      // Match functions/ lock order to prevent deadlocks:
      // 1. Ensure subscriptions row exists and lock it first
      // 2. Then lock and update credit_transactions
      return await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO subscriptions (user_id, current_credits)
          VALUES (${userId}, 0)
          ON CONFLICT (user_id) DO NOTHING
        `)

        await tx.execute(sql`
          SELECT user_id FROM subscriptions
          WHERE user_id = ${userId}
          FOR UPDATE
        `)

        // Ensure the user has a non-negative net active balance (adjustments can create negative rows).
        const netResult = await tx.execute<{ total: string | null }>(sql`
          SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0) AS total
          FROM credit_transactions
          WHERE user_id = ${userId}
            AND (expires_at IS NULL OR expires_at > NOW())
        `)
        const netCredits = Number(netResult.rows[0]?.total ?? 0)
        if (netCredits < amount) {
          throw new Error('INSUFFICIENT_CREDITS')
        }

        // Lock every qualifying row FIFO (expiring soonest first), then allocate
        // the requested amount across as many rows as needed.
        const rows = await tx.execute<{ id: string; remaining_balance: string }>(sql`
          SELECT id, remaining_balance FROM credit_transactions
          WHERE user_id = ${userId}
            AND remaining_balance > 0
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY expires_at ASC NULLS LAST, id ASC
          FOR UPDATE
        `)

        let remaining = amount
        const allocations: CreditSpendAllocation[] = []
        for (const row of rows.rows) {
          if (remaining <= 0) break
          const take = Math.min(Number(row.remaining_balance), remaining)
          await tx.execute(sql`
            UPDATE credit_transactions
            SET remaining_balance = remaining_balance - ${take}
            WHERE id = ${row.id}
          `)
          allocations.push({ transactionId: row.id, amount: take })
          remaining -= take
        }

        if (remaining > 0 || allocations.length === 0) {
          // Net balance passed under lock but rows could not cover it — should be unreachable.
          throw new Error('INSUFFICIENT_CREDITS')
        }

        // Update subscriptions cache (row is already locked)
        try {
          await tx.execute(sql`
            UPDATE subscriptions
            SET current_credits = (
              SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0)
              FROM credit_transactions
              WHERE user_id = ${userId}
                AND (expires_at IS NULL OR expires_at > NOW())
            )
            WHERE user_id = ${userId}
          `)
        } catch (err) {
          // Best-effort cache sync; credit_transactions is the source of truth.
          console.warn(`subscriptions.current_credits decrement failed user=${userId}`, err)
        }

        return allocations
      })
    },

    async refundCredit(userId: string, allocations: CreditSpendAllocation[]): Promise<void> {
      if (allocations.length === 0) {
        return
      }

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO subscriptions (user_id, current_credits)
          VALUES (${userId}, 0)
          ON CONFLICT (user_id) DO NOTHING
        `)

        await tx.execute(sql`
          SELECT user_id FROM subscriptions
          WHERE user_id = ${userId}
          FOR UPDATE
        `)

        for (const { transactionId, amount } of allocations) {
          const updated = await tx.execute<{ id: string }>(sql`
            UPDATE credit_transactions
            SET remaining_balance = remaining_balance + ${amount}
            WHERE id = ${transactionId}
              AND user_id = ${userId}
              AND (expires_at IS NULL OR expires_at > NOW())
            RETURNING id
          `)

          if (updated.rows.length === 0) {
            // Original row expired between spend and refund; insert a non-expiring compensation.
            await tx.execute(sql`
              INSERT INTO credit_transactions (
                user_id, delta, reason, initial_amount, remaining_balance, transaction_type, expires_at
              )
              VALUES (${userId}, ${amount}, 'refund_compensation', ${amount}, ${amount}, 'legacy', NULL)
            `)
          }
        }

        try {
          await tx.execute(sql`
            UPDATE subscriptions
            SET current_credits = (
              SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0)
              FROM credit_transactions
              WHERE user_id = ${userId}
                AND (expires_at IS NULL OR expires_at > NOW())
            )
            WHERE user_id = ${userId}
          `)
        } catch (err) {
          console.warn(`subscriptions.current_credits increment failed user=${userId}`, err)
        }
      })
    },

    async getBalance(userId: string): Promise<number> {
      const result = await db.execute<{ total: string | null }>(sql`
        SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0) AS total
        FROM credit_transactions
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
      `)
      const total = result.rows[0]?.total
      return total !== null && total !== undefined ? Number(total) : 0
    },
  }
}
```

Note the original single-row version's INSERT/lock block appeared both in `spendCredit` and `refundCredit`; the port keeps that duplication (matches the original file's structure, not introducing a new shared helper — YAGNI, this is a 2-call-site duplication, not worth abstracting).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-agent && npm test -- --test-name-pattern="spendCredit|refundCredit|getBalance"`
Expected: all tests in `creditService.test.ts` pass (the `getBalance` tests are unaffected by this change and should already pass).

- [ ] **Step 5: Commit**

```bash
cd cloud-agent
git add src/services/creditService.ts src/services/creditService.test.ts
git commit -m "feat(cloud-agent): port multi-row FIFO credit allocator, support amount > 1"
```

---

## Task 2: Ripple the new CreditService type through the three simple callers

**Why:** `spendCredit` now returns `CreditSpendAllocation[]` instead of `string`, and `refundCredit` takes that array instead of a raw txId. Three callers use the service in a simple spend-once/refund-once pattern with no other behavior change: `browserAction.ts`, `wsAgentHandler.ts`, `schedulerTriggerHandler.ts`. This task is a pure type-signature ripple — no product behavior changes, all three still spend exactly 1 credit as before.

**Files:**
- Modify: `cloud-agent/src/tools/browserAction.ts`
- Modify: `cloud-agent/src/tools/browserAction.test.ts`
- Modify: `cloud-agent/src/handlers/wsAgentHandler.ts`
- Modify: `cloud-agent/src/handlers/wsAgentHandler.test.ts`
- Modify: `cloud-agent/src/handlers/schedulerTriggerHandler.ts`
- Modify: `cloud-agent/src/handlers/schedulerTriggerHandler.test.ts`

- [ ] **Step 1: Update `browserAction.ts` and its test**

In `cloud-agent/src/tools/browserAction.ts`, update the import (line 5):

```typescript
import type { CreditService } from '../services/creditService.js'
```
→
```typescript
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
```

Line 93 — `let txId: string | null = null` → `let allocations: CreditSpendAllocation[] | null = null`

Line 96 — `try { txId = await deps.creditService.spendCredit(deps.userId) }` → `try { allocations = await deps.creditService.spendCredit(deps.userId) }`

Lines 111-113:
```typescript
        if (txId) {
          try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ }
        }
```
→
```typescript
        if (allocations) {
          try { await deps.creditService.refundCredit(deps.userId, allocations) } catch { /* logged */ }
        }
```

Line 131:
```typescript
          if (txId) { try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ } }
```
→
```typescript
          if (allocations) { try { await deps.creditService.refundCredit(deps.userId, allocations) } catch { /* logged */ } }
```

In `cloud-agent/src/tools/browserAction.test.ts`, three mock definitions change shape:

Line 29: `creditService: { spendCredit: async () => { calls.spend++; return 'tx1' }, refundCredit: async () => { calls.refund++ } },`
→ `creditService: { spendCredit: async () => { calls.spend++; return [{ transactionId: 'tx1', amount: 1 }] }, refundCredit: async () => { calls.refund++ } },`

Line 158 and line 196 (identical text, both instances): `creditService: { spendCredit: async () => 'tx1', refundCredit: async () => {} } as never,`
→ `creditService: { spendCredit: async () => [{ transactionId: 'tx1', amount: 1 }], refundCredit: async () => {} } as never,`

Use `replace_all` for the line-158/196 edit since both occurrences get the identical replacement.

- [ ] **Step 2: Update `wsAgentHandler.ts` and its test**

In `cloud-agent/src/handlers/wsAgentHandler.ts`, update the import (line 15):

```typescript
import type { CreditService } from '../services/creditService.js'
```
→
```typescript
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
```

Line 57 — `let activeTxId: string | null = null` → `let activeAllocations: CreditSpendAllocation[] | null = null`

Lines 70-79:
```typescript
  const refundIfNeeded = async () => {
    if (userId && activeTxId && !isCompleted) {
      try {
        await cs.refundCredit(userId, activeTxId)
      } catch (refundErr) {
        console.error(`[CRITICAL] WS refundCredit failed user=${userId} txId=${activeTxId}`, refundErr)
      }
      activeTxId = null
    }
  }
```
→
```typescript
  const refundIfNeeded = async () => {
    if (userId && activeAllocations && !isCompleted) {
      try {
        await cs.refundCredit(userId, activeAllocations)
      } catch (refundErr) {
        console.error(`[CRITICAL] WS refundCredit failed user=${userId}`, refundErr)
      }
      activeAllocations = null
    }
  }
```

Lines 110-123:
```typescript
      let txId: string
      try {
        txId = await cs.spendCredit(userId)
      } catch (creditErr: unknown) {
        const msg = creditErr instanceof Error ? creditErr.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
          ws.close(4402, 'Insufficient credits')
          return
        }
        throw creditErr
      }

      activeTxId = txId
```
→
```typescript
      let allocations: CreditSpendAllocation[]
      try {
        allocations = await cs.spendCredit(userId)
      } catch (creditErr: unknown) {
        const msg = creditErr instanceof Error ? creditErr.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
          ws.close(4402, 'Insufficient credits')
          return
        }
        throw creditErr
      }

      activeAllocations = allocations
```

Lines 130-135:
```typescript
      if (!character) {
        await cs.refundCredit(userId, txId)
        activeTxId = null
```
→
```typescript
      if (!character) {
        await cs.refundCredit(userId, allocations)
        activeAllocations = null
```

Lines 174-176:
```typescript
      } catch (preAgentErr) {
        await cs.refundCredit(userId, txId)
        activeTxId = null
```
→
```typescript
      } catch (preAgentErr) {
        await cs.refundCredit(userId, allocations)
        activeAllocations = null
```

Lines 164-165 and 282-283 (identical `isCompleted = true\n        activeTxId = null` text, both occurrences): use `replace_all` to change `activeTxId = null` → `activeAllocations = null` in that pattern.

In `cloud-agent/src/handlers/wsAgentHandler.test.ts`, lines 42-44:
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
}
```
→
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<{ transactionId: string; amount: number }[]> => [{ transactionId: 'mock-txid', amount: 1 }],
  refundCredit: async (_userId: string, _allocations: { transactionId: string; amount: number }[]): Promise<void> => {},
}
```

Line 237 (`spendCredit: async (): Promise<string> => { throw new Error('INSUFFICIENT_CREDITS') },`) is unaffected — still throws, no return-shape dependency.

- [ ] **Step 3: Update `schedulerTriggerHandler.ts` and its test**

In `cloud-agent/src/handlers/schedulerTriggerHandler.ts`, update the import (line 6):

```typescript
import type { CreditService } from '../services/creditService.js'
```
→
```typescript
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
```

(The `Pick<CreditService, 'spendCredit' | 'refundCredit'>` parameter type at line 96 needs no edit — it adapts automatically once the underlying `CreditService` type changes.)

Lines 184-198:
```typescript
    let txId: string | null = null
    if (!isDuplicateRun) {
      try {
        txId = await creditService.spendCredit(userId)
      } catch (err) {
```
→
```typescript
    let allocations: CreditSpendAllocation[] | null = null
    if (!isDuplicateRun) {
      try {
        allocations = await creditService.spendCredit(userId)
      } catch (err) {
```
(rest of that catch block is unchanged)

Lines 215-217:
```typescript
        if (txId) {
          try { await creditService.refundCredit(userId, txId) } catch { /* logged */ }
        }
```
→
```typescript
        if (allocations) {
          try { await creditService.refundCredit(userId, allocations) } catch { /* logged */ }
        }
```

Lines 262-264:
```typescript
      if (!isDuplicateRun && abortedOffline && txId) {
        try { await creditService.refundCredit(userId, txId) } catch { /* logged */ }
      }
```
→
```typescript
      if (!isDuplicateRun && abortedOffline && allocations) {
        try { await creditService.refundCredit(userId, allocations) } catch { /* logged */ }
      }
```

In `cloud-agent/src/handlers/schedulerTriggerHandler.test.ts`, lines 27-28:
```typescript
  spendCredit?: () => Promise<string>
  refundCredit?: () => Promise<void>
```
→
```typescript
  spendCredit?: () => Promise<{ transactionId: string; amount: number }[]>
  refundCredit?: () => Promise<void>
```

Lines 67-68:
```typescript
    spendCredit: overrides.spendCredit ?? (async () => { creditCalls.spend++; return 'tx1' }),
    refundCredit: overrides.refundCredit ?? (async () => { creditCalls.refund++ }),
```
→
```typescript
    spendCredit: overrides.spendCredit ?? (async () => { creditCalls.spend++; return [{ transactionId: 'tx1', amount: 1 }] }),
    refundCredit: overrides.refundCredit ?? (async () => { creditCalls.refund++ }),
```

Line 150 (`spendCredit: async () => { throw new Error('INSUFFICIENT_CREDITS') },`) is unaffected.

- [ ] **Step 4: Typecheck and run all three test files**

Run: `cd cloud-agent && npm run typecheck`
Expected: no errors.

Run: `cd cloud-agent && npm test -- --test-name-pattern="browser_action|browserAction|wsAgentHandler|scheduler-trigger|scheduler trigger"`
Expected: all tests pass unchanged (this task changes types and variable names only, not behavior — every existing assertion should still hold).

If the name-pattern filter doesn't match cleanly, fall back to the full suite for this step: `npm test 2>&1 | tail -60` and confirm no failures in `browserAction.test.ts`, `wsAgentHandler.test.ts`, or `schedulerTriggerHandler.test.ts`.

- [ ] **Step 5: Commit**

```bash
cd cloud-agent
git add src/tools/browserAction.ts src/tools/browserAction.test.ts src/handlers/wsAgentHandler.ts src/handlers/wsAgentHandler.test.ts src/handlers/schedulerTriggerHandler.ts src/handlers/schedulerTriggerHandler.test.ts
git commit -m "refactor(cloud-agent): ripple CreditSpendAllocation[] type through browserAction, wsAgentHandler, schedulerTriggerHandler"
```

---

## Task 3: wsLiveAgentHandler — 5-credit tick, gate raised to 5

**Files:**
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts`
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`

- [ ] **Step 1: Update the shared mock and two override closures in the test file**

In `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`, lines 44-48:
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}
```
→
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<{ transactionId: string; amount: number }[]> => [{ transactionId: 'mock-txid', amount: 5 }],
  refundCredit: async (_userId: string, _allocations: { transactionId: string; amount: number }[]): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}
```

Lines 734-738 (`'billing tick with INSUFFICIENT_CREDITS...'` test override) — `spendCredit: async (): Promise<string> => { throw new Error('INSUFFICIENT_CREDITS') },` needs no shape change (still throws), only the return type annotation reads oddly with the old `Promise<string>` — update it to `Promise<{ transactionId: string; amount: number }[]>` for consistency:
```typescript
    spendCredit: async (): Promise<{ transactionId: string; amount: number }[]> => {
      throw new Error('INSUFFICIENT_CREDITS')
    },
```

Lines 780-784 (`'billing ticks do not overlap...'` test override):
```typescript
    spendCredit: async (): Promise<string> => {
      spendCalls++
      await new Promise((resolve) => setTimeout(resolve, 120))
      return 'mock-txid'
    },
```
→
```typescript
    spendCredit: async (): Promise<{ transactionId: string; amount: number }[]> => {
      spendCalls++
      await new Promise((resolve) => setTimeout(resolve, 120))
      return [{ transactionId: 'mock-txid', amount: 5 }]
    },
```

- [ ] **Step 2: Add two new gate-boundary tests**

Add these right after the existing `'one credit at open closes with 4402'` test (around line 274):

```typescript
test('four credits at open closes with 4402 (below new gate)', async () => {
  const db = makeMockDb([[mockUser]])
  const cs = { ...mockCreditService, getBalance: async () => 4 }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('close', (code) => {
      clearTimeout(timeout)
      assert.equal(code, 4402)
      resolve()
    })
    ws.on('error', reject)
  })

  await close()
})

test('five credits at open allows the session to proceed', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const cs = { ...mockCreditService, getBalance: async () => 5 }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; remainingCredits?: number }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        assert.equal(msg.remainingCredits, 5)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})
```

- [ ] **Step 3: Run tests to verify the new gate tests fail (server still gates at 2)**

Run: `cd cloud-agent && npm run build 2>&1 | tail -40`

This should build clean (only test additions so far, real logic unchanged). Then:

Run: `cd cloud-agent && npm test -- --test-name-pattern="four credits|five credits"`
Expected: `'four credits at open closes with 4402'` passes trivially (still true under old gate too), but `'five credits at open allows the session to proceed'` FAILS — the server still gates at `balance < 2`, so 5 credits already passes today. **This means the "five credits" test doesn't actually prove anything new yet without also testing a value between the old and new gate.** Replace it: to get a real red-then-green cycle, temporarily change the test's `getBalance` to `async () => 3` (passes old gate of 2, should be REJECTED under the new gate of 5) before implementing, confirm it currently passes (wrongly, since old code allows balance=3), then implement the gate change, then flip the assertion to expect a 4402 close, then after the source fix confirms rejection, revert the test back to the `5`-credits-allowed version, which will now correctly fail until the tick amount is also fixed to spend 5 (see next step) — OR, more simply: skip the manual red/green dance here and go straight to Step 4, then run the full boundary pair (4402 at 4, success at 5) together as the verification in Step 5. This tick-billing change is small enough that a strict single-test red/green isn't worth the churn; verify both boundary tests as a pair after the implementation step.

- [ ] **Step 4: Implement the gate and tick amount changes**

In `cloud-agent/src/handlers/wsLiveAgentHandler.ts`, line 316:
```typescript
      if (balance < 2) {
```
→
```typescript
      if (balance < 5) {
```

Line 339:
```typescript
            await cs.spendCredit(userId!)
```
→
```typescript
            await cs.spendCredit(userId!, 5)
```

- [ ] **Step 5: Run the full gate + tick test set to verify pass**

Run: `cd cloud-agent && npm test -- --test-name-pattern="credit|4402|session_ready|billing"`
Expected: all pass, including the two new boundary tests (`'four credits at open closes with 4402 (below new gate)'` and `'five credits at open allows the session to proceed'`).

Run the full file to be safe: `cd cloud-agent && npm run build && NODE_ENV=test node --test --test-reporter spec "dist/handlers/wsLiveAgentHandler.test.js"`
Expected: all ~35+ tests in the file pass.

- [ ] **Step 6: Commit**

```bash
cd cloud-agent
git add src/handlers/wsLiveAgentHandler.ts src/handlers/wsLiveAgentHandler.test.ts
git commit -m "feat(cloud-agent): live voice bills 5 credits/tick, connect gate raised to 5"
```

---

## Task 4: Move agent-turn billing inside the ADK tool loop, hard-stop at 5

**Why this shape:** `runAgentReal` (the production `runAgentFn`) currently has zero direct unit tests — it's only exercised end-to-end via `index.test.ts`'s route tests using a *mocked* `runAgentFn`, which bypasses the real ADK loop entirely. To make the new per-loop billing behavior actually testable, this task extracts the event-consuming loop into a new, directly-testable pure function, `consumeAgentEvents`, that takes an `AsyncIterable` of ADK events plus a credit service and returns the same `{reply, toolCalls, groundingMetadata}` shape. `runAgentReal` becomes a thin wrapper that builds the ADK runner/session and delegates event consumption to it.

**Files:**
- Create: `cloud-agent/src/services/agentEventLoop.ts`
- Create: `cloud-agent/src/services/agentEventLoop.test.ts`
- Modify: `cloud-agent/src/index.ts`
- Modify: `cloud-agent/src/index.test.ts`

- [ ] **Step 1: Write failing tests for `consumeAgentEvents`**

Create `cloud-agent/src/services/agentEventLoop.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Event as AdkEvent } from '@google/adk'
import type { CreditSpendAllocation } from './creditService.js'

const { consumeAgentEvents } = await import('./agentEventLoop.js')

function fakeEvent(overrides: Partial<AdkEvent> = {}): AdkEvent {
  return {
    id: `evt-${Math.random()}`,
    invocationId: 'inv-1',
    actions: {},
    ...overrides,
  } as AdkEvent
}

function textEvent(text: string): AdkEvent {
  return fakeEvent({ content: { role: 'model', parts: [{ text }] } })
}

function functionCallEvent(name: string): AdkEvent {
  return fakeEvent({ content: { role: 'model', parts: [{ functionCall: { name, args: {} } }] } })
}

async function* toAsyncIterable(events: AdkEvent[]): AsyncGenerator<AdkEvent> {
  for (const e of events) yield e
}

const FALLBACK_REPLY = "I've done what I can for now — let me know if you'd like me to continue."

test('consumeAgentEvents spends 1 credit per functionCall-bearing event and returns the final reply', async () => {
  const spendCalls: string[] = []
  const cs = {
    spendCredit: async (userId: string) => {
      spendCalls.push(userId)
      return [{ transactionId: `tx-${spendCalls.length}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([functionCallEvent('get_current_time'), textEvent('It is 3pm.')])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(spendCalls.length, 1)
  assert.deepEqual(spendCalls, ['user-1'])
  assert.equal(result.reply, 'It is 3pm.')
  assert.deepEqual(result.toolCalls, ['get_current_time'])
})

test('consumeAgentEvents hard-stops at 5 loop iterations and returns a fallback reply', async () => {
  const cs = {
    spendCredit: async () => [{ transactionId: 'tx', amount: 1 }] as CreditSpendAllocation[],
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'),
    functionCallEvent('tool_c'),
    functionCallEvent('tool_d'),
    functionCallEvent('tool_e'),
    functionCallEvent('tool_f'), // never consumed — loop stops after the 5th
  ])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(result.toolCalls.length, 5)
  assert.equal(result.reply, FALLBACK_REPLY)
})

test('consumeAgentEvents degrades gracefully when credits run out mid-loop (no throw, no refund)', async () => {
  let calls = 0
  const cs = {
    spendCredit: async () => {
      calls += 1
      if (calls === 2) throw new Error('INSUFFICIENT_CREDITS')
      return [{ transactionId: `tx-${calls}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async () => {
      throw new Error('refundCredit should not be called on a graceful mid-loop degrade')
    },
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'), // this spend throws INSUFFICIENT_CREDITS
    functionCallEvent('tool_c'), // never reached
  ])
  const result = await consumeAgentEvents(events, 'user-1', cs)
  assert.equal(result.toolCalls.length, 2)
  assert.equal(result.reply, FALLBACK_REPLY)
})

test('consumeAgentEvents refunds only the credits spent this turn on a genuine ADK error', async () => {
  let calls = 0
  const refunded: unknown[] = []
  const cs = {
    spendCredit: async () => {
      calls += 1
      return [{ transactionId: `tx-${calls}`, amount: 1 }] as CreditSpendAllocation[]
    },
    refundCredit: async (_userId: string, allocations: CreditSpendAllocation[]) => {
      refunded.push(allocations)
    },
  }
  const events = toAsyncIterable([
    functionCallEvent('tool_a'),
    functionCallEvent('tool_b'),
    fakeEvent({ errorCode: 'SAFETY', errorMessage: 'blocked' }),
  ])
  await assert.rejects(
    () => consumeAgentEvents(events, 'user-1', cs),
    (err: Error) => {
      assert.match(err.message, /ADK error \(SAFETY\)/)
      return true
    },
  )
  assert.deepEqual(refunded, [[
    { transactionId: 'tx-1', amount: 1 },
    { transactionId: 'tx-2', amount: 1 },
  ]])
})

test('consumeAgentEvents throws when the loop completes normally with an empty final reply', async () => {
  const cs = {
    spendCredit: async () => [{ transactionId: 'tx', amount: 1 }] as CreditSpendAllocation[],
    refundCredit: async () => {},
  }
  const events = toAsyncIterable([fakeEvent({ content: { role: 'model', parts: [{ text: '' }] } })])
  await assert.rejects(
    () => consumeAgentEvents(events, 'user-1', cs),
    (err: Error) => {
      assert.equal(err.message, 'ADK returned an empty final reply')
      return true
    },
  )
})
```

- [ ] **Step 2: Run tests to verify they fail (module doesn't exist yet)**

Run: `cd cloud-agent && npm run build 2>&1 | head -20`
Expected: `Cannot find module './agentEventLoop.js'` or equivalent.

- [ ] **Step 3: Implement `consumeAgentEvents`**

Create `cloud-agent/src/services/agentEventLoop.ts`:

```typescript
import { isFinalResponse } from '@google/adk'
import type { Event as AdkEvent } from '@google/adk'
import type { GroundingMetadata } from '@google/genai'
import { hasGroundingData } from '../groundingMetadata.js'
import type { CreditService, CreditSpendAllocation } from './creditService.js'

const MAX_LOOP_ITERATIONS = 5
const DEGRADED_FALLBACK_REPLY =
  "I've done what I can for now — let me know if you'd like me to continue."

export interface ConsumeAgentEventsResult {
  reply: string
  toolCalls: string[]
  groundingMetadata?: GroundingMetadata
}

function eventHasFunctionCall(event: AdkEvent): boolean {
  return event.content?.parts?.some((part) => 'functionCall' in part) ?? false
}

function extractText(event: AdkEvent): string {
  if (!event.content?.parts) return ''
  return event.content.parts
    .filter((p): p is { text: string } => 'text' in p)
    .map((p) => p.text)
    .join('')
}

/**
 * Consumes one ADK agent run's event stream, billing 1 credit per internal
 * tool-call loop iteration (capped at MAX_LOOP_ITERATIONS) instead of a flat
 * per-turn charge. Hitting the cap, or running out of credits mid-loop, stops
 * the stream early and returns a graceful fallback reply rather than throwing —
 * only a genuine ADK error refunds the credits already spent this turn.
 */
export async function consumeAgentEvents(
  events: AsyncIterable<AdkEvent>,
  userId: string,
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
): Promise<ConsumeAgentEventsResult> {
  let reply = ''
  let lastText = ''
  const toolCalls: string[] = []
  let groundingMetadata: GroundingMetadata | undefined
  let loopCount = 0
  let degraded = false
  const spentAllocations: CreditSpendAllocation[] = []

  try {
    for await (const event of events) {
      if (event.errorCode || event.errorMessage) {
        throw new Error(`ADK error (${event.errorCode ?? 'unknown'}): ${event.errorMessage ?? 'no message'}`)
      }

      if (eventHasFunctionCall(event)) {
        for (const part of event.content!.parts!) {
          if ('functionCall' in part) {
            const fc = (part as { functionCall?: { name?: string } }).functionCall
            if (fc?.name) toolCalls.push(fc.name)
          }
        }

        loopCount += 1
        try {
          const allocations = await creditService.spendCredit(userId)
          spentAllocations.push(...allocations)
        } catch (creditErr) {
          const msg = creditErr instanceof Error ? creditErr.message : ''
          if (msg === 'INSUFFICIENT_CREDITS') {
            degraded = true
            break
          }
          throw creditErr
        }

        if (loopCount === MAX_LOOP_ITERATIONS) {
          degraded = true
          break
        }
      }

      if (hasGroundingData(event.groundingMetadata)) {
        groundingMetadata = event.groundingMetadata
      }

      const text = extractText(event)
      if (text) lastText = text

      if (isFinalResponse(event) && event.content?.parts) {
        reply = text
      }
    }

    if (!reply.trim()) {
      if (degraded) {
        reply = lastText.trim() || DEGRADED_FALLBACK_REPLY
      } else {
        throw new Error('ADK returned an empty final reply')
      }
    }
  } catch (err) {
    if (spentAllocations.length > 0) {
      try {
        await creditService.refundCredit(userId, spentAllocations)
      } catch (refundErr) {
        console.error(`[CRITICAL] refundCredit failed user=${userId}`, refundErr)
      }
    }
    throw err
  }

  return { reply, toolCalls, groundingMetadata }
}
```

- [ ] **Step 4: Run `agentEventLoop.test.ts` to verify pass**

Run: `cd cloud-agent && npm run build && NODE_ENV=test node --test --test-reporter spec "dist/services/agentEventLoop.test.js"`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit the new module**

```bash
cd cloud-agent
git add src/services/agentEventLoop.ts src/services/agentEventLoop.test.ts
git commit -m "feat(cloud-agent): add consumeAgentEvents — per-loop credit billing with hard stop at 5"
```

- [ ] **Step 6: Wire `runAgentReal` to use `consumeAgentEvents`, and add `creditService` to `RunAgentParams`**

In `cloud-agent/src/index.ts`, update the `@google/adk` import (line 7):
```typescript
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
```
→
```typescript
import { InMemoryRunner, createEvent, createEventActions } from '@google/adk'
```

Remove the now-unused `hasGroundingData` import (line 12) entirely — it's only used inside the loop being extracted:
```typescript
import { hasGroundingData } from './groundingMetadata.js'
```
(delete this line)

Add the new import alongside the other `./services/*` imports:
```typescript
import { consumeAgentEvents } from './services/agentEventLoop.js'
```

Update `RunAgentParams` (lines 41-51):
```typescript
export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  firebaseUid: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
  timezone: string
  embed: (text: string) => Promise<number[]>
}
```
→
```typescript
export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  firebaseUid: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
  timezone: string
  embed: (text: string) => Promise<number[]>
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
}
```

Replace the body of `runAgentReal` (lines 65-138) with the thin version:
```typescript
export async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }> {
  const { db, userId, firebaseUid, characterId, systemInstruction, message, history, timezone, embed, creditService } = params
  const bridge = admin.apps.length ? {
    firebaseUid,
    userId,
    firestoreSession: defaultFirestoreSession(),
    fcmDispatcher: defaultFcmDispatcher(),
    creditService: createCreditService(db),
    instanceId: INSTANCE_ID,
  } : undefined
  const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge)
  const runner = new InMemoryRunner({ agent, appName: 'clanker-cloud-agent' })
  const sessionId = crypto.randomUUID()

  const session = await runner.sessionService.createSession({
    appName: 'clanker-cloud-agent',
    userId,
    sessionId,
  })

  if (history.length > 0) {
    for (const turn of history) {
      await runner.sessionService.appendEvent({
        session,
        event: createEvent({
          invocationId: crypto.randomUUID(),
          author: turn.role === 'user' ? 'user' : agent.name,
          content: turn,
          actions: createEventActions(),
        }),
      })
    }
  }

  const events = runner.runAsync({
    userId,
    sessionId,
    newMessage: { role: 'user', parts: [{ text: message }] },
  })

  return consumeAgentEvents(events, userId, creditService)
}
```

(Note: `bridge.creditService: createCreditService(db)` is left untouched — that's a separate instance used by the `browser_action` tool's own contextual billing inside `buildAgent`, unrelated to this turn-level billing seam. Not in scope for this task.)

- [ ] **Step 7: Remove pre-loop spend/refund from the `POST /agent/run` route handler**

In `cloud-agent/src/index.ts`, replace the block from `// SPEND FIRST` through the `// 4. RESPOND` `res.json(...)` call (originally lines 258-320) with:

```typescript
      if (unsyncedHistory.length > 0) {
        try {
          await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory, embedText)
        } catch (err) {
          // Swallow sync errors so the agent can still respond (matches Firebase generateReply behavior)
          console.error('bulkInsertUnsynced failed:', err)
        }
      }

      const wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
      const systemInstruction = assembleSystemInstruction(character, wikiContext)

      // Credit spend now happens per internal ADK loop iteration inside runAgentFn
      // (see services/agentEventLoop.ts) — refund-on-failure is handled there too.
      const result = await runAgentFn({ db, userId, firebaseUid, characterId, systemInstruction, message, history, timezone, embed: embedText, creditService: cs })

      // GET BALANCE — graceful degrade if this fails
      let newBalance: number | null = null
      try {
        newBalance = await cs.getBalance(userId)
      } catch (balErr) {
        console.warn(`getBalance failed user=${userId}, returning null snapshot`, balErr)
      }

      // RESPOND
      res.json({
        reply: result.reply,
        toolCalls: result.toolCalls,
        usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
        groundingMetadata: result.groundingMetadata,
      })
```

The surrounding outer `try { ... } catch (err) { console.error('agent/run error:', err); ...; res.status(500)... }` stays exactly as-is — it already handles any error thrown by `runAgentFn` (including the `consumeAgentEvents`-internal refund-then-rethrow) by logging and returning 500.

- [ ] **Step 8: Remove the four now-obsolete route-level credit tests from `index.test.ts`**

In `cloud-agent/src/index.test.ts`, delete these four tests entirely (they tested route-level pre-spend/refund behavior that no longer exists — that responsibility moved into `consumeAgentEvents`, already covered by Task 4 Step 1's dedicated tests):
- `test('POST /agent/run returns 402 when spendCredit throws INSUFFICIENT_CREDITS', ...)` (originally lines 322-337)
- `test('POST /agent/run calls refundCredit and returns 500 when runAgentFn throws', ...)` (originally lines 339-357)
- `test('POST /agent/run swallows refundCredit failure and still returns 500 with ADK error', ...)` (originally lines 359-377)
- `test('POST /agent/run does not call runAgentFn when spendCredit throws INSUFFICIENT_CREDITS', ...)` (originally lines 406-424)

Keep `'POST /agent/run returns usageSnapshot.remainingCredits on success'` and `'POST /agent/run returns usageSnapshot: null and 200 when getBalance throws'` — both are still route-level behavior (`cs.getBalance` is still called at the end of the handler) and need no changes.

- [ ] **Step 9: Update the shared `mockCreditService` type in `index.test.ts`**

Lines 84-88:
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}
```
→
```typescript
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<{ transactionId: string; amount: number }[]> => [{ transactionId: 'mock-txid', amount: 1 }],
  refundCredit: async (_userId: string, _allocations: { transactionId: string; amount: number }[]): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}
```

- [ ] **Step 10: Typecheck and run the full cloud-agent suite**

Run: `cd cloud-agent && npm run typecheck`
Expected: no errors. If `mockRunAgent`/`failingAgent` in `index.test.ts` (lines 79, 285, 346, 367) fail to typecheck because they don't return `groundingMetadata`, that's pre-existing (the return type already marks it optional) — no change needed there.

Run: `cd cloud-agent && npm run lint`
Expected: no errors (watch for the removed `hasGroundingData`/`isFinalResponse` imports — if `eslint` flags anything else unused after the route-handler simplification, e.g. an unused `preAgentErr`/`adkErr` catch binding from the removed try/catch wrappers, remove it).

Run: `cd cloud-agent && npm test 2>&1 | tail -80`
Expected: full suite passes, including `index.test.ts`, `agentEventLoop.test.ts`, and everything touched in Tasks 1-3.

- [ ] **Step 11: Commit**

```bash
cd cloud-agent
git add src/index.ts src/index.test.ts
git commit -m "feat(cloud-agent): bill agent turns per internal loop iteration instead of a flat 1/turn"
```

---

## Task 5: Client — raise the live-voice connect gate to 5

**Files:**
- Modify: `src/hooks/useLiveVoiceChat.ts`
- Modify: `__tests__/useLiveVoiceChat.test.tsx`

- [ ] **Step 1: Write a failing boundary test**

In `__tests__/useLiveVoiceChat.test.tsx`, the existing test `'startCall shows alert if insufficient credits'` (lines 108-126) mocks `remainingCredits: 1` to trigger the alert. Add a new test immediately after it (after the closing `})` at line 126), following the exact same structure with `remainingCredits: 4` — the new boundary value that must still be rejected under the raised gate:

```typescript
  test('startCall shows alert if credits are below the new gate of 5', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 4 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Insufficient Credits',
      expect.any(String),
      expect.any(Array),
    )
  })
```

- [ ] **Step 2: Run to verify it currently passes (gate is still 2, so 4 already exceeds it — this test won't be red yet)**

Run: `npm test -- __tests__/useLiveVoiceChat.test.tsx -t "below the new gate"`

This will pass immediately since 4 ≥ 2 (today's gate) does NOT trigger the alert today — meaning this test as constructed actually expects the alert but the current code with gate=2 would NOT show it for remainingCredits=4. **Correction:** since `4 >= 2`, the *current* code does NOT alert at 4 credits, so this test is genuinely red against today's code (call would proceed instead of showing the alert). Confirm failure output shows `Alert.alert` was not called, or the call proceeded when it shouldn't have.

- [ ] **Step 3: Update `MIN_CREDITS_FOR_CALL`**

In `src/hooks/useLiveVoiceChat.ts`, line 31:
```typescript
const MIN_CREDITS_FOR_CALL = 2
```
→
```typescript
const MIN_CREDITS_FOR_CALL = 5
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- __tests__/useLiveVoiceChat.test.tsx`
Expected: full file passes, including the new boundary test and the existing `remainingCredits: 1` test (still correctly rejected) and all `remainingCredits: 10`/`8`/`9` success-path tests (still comfortably above 5, unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveVoiceChat.ts __tests__/useLiveVoiceChat.test.tsx
git commit -m "feat: raise live-voice client connect gate to 5 credits, matching the server"
```

---

## Task 6: Bump `convertDocumentText` and `generateImage` to 2 credits

**Files:**
- Modify: `functions/src/convertDocumentText.ts`
- Modify: `functions/src/generateImage.ts`
- Modify: `functions/src/generateImage.test.ts`

(`convertDocumentText.test.ts` needs no changes — it never asserts the `amount` argument passed to `spendCredits`, only that spend/refund happen at all.)

- [ ] **Step 1: Write failing assertions in `generateImage.test.ts`**

Update the three existing tests that assert credit amounts:

Lines 135-138 (`'generateImageHandler spends one credit for payg users'` — rename to reflect the new cost):
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return [{ transactionId: 'mock-tx-id', amount: 1 }];
    };
```
→
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 2);
      return [{ transactionId: 'mock-tx-id', amount: 2 }];
    };
```
And line 160: `assert.equal(result.creditsSpent, 1);` → `assert.equal(result.creditsSpent, 2);`
Rename the test at line 126: `"generateImageHandler spends one credit for payg users"` → `"generateImageHandler spends two credits for payg users"`

Lines 179-188 (`'generateImageHandler rejects unsupported mime type from model and refunds credit'`):
```typescript
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return [{ transactionId: 'mock-tx-id', amount: 1 }];
    };
    creditService.refundCredit = async (userId, allocations) => {
      assert.equal(userId, user.id);
      assert.deepEqual(allocations, [{ transactionId: 'mock-tx-id', amount: 1 }]);
      refundCalls += 1;
    };
```
→
```typescript
    creditService.spendCredits = async () => {
      spendCalls += 1;
      return [{ transactionId: 'mock-tx-id', amount: 2 }];
    };
    creditService.refundCredit = async (userId, allocations) => {
      assert.equal(userId, user.id);
      assert.deepEqual(allocations, [{ transactionId: 'mock-tx-id', amount: 2 }]);
      refundCalls += 1;
    };
```

Lines 261-266 and 284 (`'generateImageHandler allows cancelled plans to spend remaining credits'`):
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return [{ transactionId: 'mock-tx-id', amount: 1 }];
    };
```
→
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 2);
      return [{ transactionId: 'mock-tx-id', amount: 2 }];
    };
```
And line 284: `assert.equal(result.creditsSpent, 1);` → `assert.equal(result.creditsSpent, 2);`

- [ ] **Step 2: Run to verify failures**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/generateImage.test.js"`
Expected: the three updated tests fail (`amount`/`creditsSpent` assertions expect 2, source still spends/returns 1).

- [ ] **Step 3: Bump the source cost constants**

In `functions/src/generateImage.ts`, line 127:
```typescript
  const spendAllocations = await credits.spendCredits(userId, 1);
```
→
```typescript
  const spendAllocations = await credits.spendCredits(userId, 2);
```

Line 351 (inside the `logger.info` call): `creditsSpent: 1,` → `creditsSpent: 2,`
Line 366 (in the returned response object): `creditsSpent: 1,` → `creditsSpent: 2,`

In `functions/src/convertDocumentText.ts`, line 186-187:
```typescript
  // 4. Charge 1 credit before conversion; refunded on any failure below.
  const spendAllocations = await deps.creditService.spendCredits(user.id, 1);
```
→
```typescript
  // 4. Charge 2 credits before conversion; refunded on any failure below.
  const spendAllocations = await deps.creditService.spendCredits(user.id, 2);
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/generateImage.test.js" "lib/convertDocumentText.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd functions
git add src/generateImage.ts src/generateImage.test.ts src/convertDocumentText.ts
git commit -m "feat(functions): bump convertDocumentText and generateImage to 2 credits"
```

---

## Task 7: Bill `summarizeText` (currently free)

**Why bigger than a one-line change:** `summarizeText.ts` has no user-DB-resolution step at all today — it never calls `userRepository.getOrCreateUserByFirebaseIdentity`, because it never needed a DB `user.id` (credits are keyed by the internal DB UUID, not the Firebase UID). Billing requires adding that resolution step first, matching the exact pattern already used in `convertDocumentText.ts`.

**Files:**
- Modify: `functions/src/summarizeText.ts`
- Modify: `functions/src/summarizeText.test.ts`

- [ ] **Step 1: Write failing tests for billing behavior**

Replace the full contents of `functions/src/summarizeText.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {summarizeTextHandler} from "./summarizeText.js";
import type {CreditSpendAllocation} from "./services/creditService.js";

let authCounter = 0;

function buildAuth() {
  authCounter += 1;
  const uid = `firebase-uid-${authCounter}`;
  return {
    uid,
    token: {
      uid,
      email: `person-${authCounter}@example.com`,
    },
  };
}

function makeOptions(overrides: {
  generateSummary?: (prompt: string) => Promise<string>;
  spendCreditsImpl?: (userId: string, amount: number) => Promise<CreditSpendAllocation[] | null>;
  refundCreditImpl?: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>;
} = {}) {
  return {
    generateSummary: overrides.generateSummary ?? (async () => "mock summary"),
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: "user-1",
        firebaseUid: "firebase-uid-1",
        email: "test@example.com",
        displayName: null,
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    creditService: {
      spendCredits: overrides.spendCreditsImpl ?? (async () => [{transactionId: "mock-tx-id", amount: 1}]),
      refundCredit: overrides.refundCreditImpl ?? (async () => {}),
    },
  };
}

test("summarizeTextHandler rejects unauthenticated calls", async () => {
  await assert.rejects(
    async () => summarizeTextHandler({auth: null, data: {text: "hello", maxCharacters: 100}} as never),
    (err: unknown) => err instanceof HttpsError && err.code === "unauthenticated"
  );
});

test("summarizeTextHandler validates input payload", async () => {
  const auth = buildAuth();

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {
          auth,
          data: {
            text: "   ",
            maxCharacters: 200,
          },
        } as never,
        makeOptions({generateSummary: async () => "unused"}),
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "invalid-argument"
  );
});

test("summarizeTextHandler trims and truncates generated summary", async () => {
  const auth = buildAuth();

  const result = await summarizeTextHandler(
    {
      auth,
      data: {
        text: "Long conversation transcript",
        maxCharacters: 12,
      },
    } as never,
    makeOptions({generateSummary: async () => " 0123456789ABCDEF "}),
  );

  assert.equal(result.summary, "0123456789AB");
});

test("summarizeTextHandler spends 1 credit before summarizing", async () => {
  const auth = buildAuth();
  let spentAmount: number | null = null;

  const result = await summarizeTextHandler(
    {
      auth,
      data: {text: "hello", maxCharacters: 50},
    } as never,
    makeOptions({
      spendCreditsImpl: async (_userId, amount) => {
        spentAmount = amount;
        return [{transactionId: "mock-tx-id", amount: 1}];
      },
    }),
  );

  assert.equal(spentAmount, 1);
  assert.equal(result.summary, "mock summary");
});

test("summarizeTextHandler rejects when credits are insufficient", async () => {
  const auth = buildAuth();

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({spendCreditsImpl: async () => null}),
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "failed-precondition"
  );
});

test("summarizeTextHandler refunds the credit when the model call fails", async () => {
  const auth = buildAuth();
  let refunded = false;

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({
          generateSummary: async () => { throw new Error("Vertex AI unavailable"); },
          refundCreditImpl: async () => { refunded = true; },
        }),
      ),
  );

  assert.equal(refunded, true);
});

test("summarizeTextHandler refunds the credit when the model returns an empty summary", async () => {
  const auth = buildAuth();
  let refunded = false;

  await assert.rejects(
    async () =>
      summarizeTextHandler(
        {auth, data: {text: "hello", maxCharacters: 50}} as never,
        makeOptions({
          generateSummary: async () => "   ",
          refundCreditImpl: async () => { refunded = true; },
        }),
      ),
    (err: unknown) => err instanceof HttpsError && err.code === "internal"
  );

  assert.equal(refunded, true);
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd functions && npm run build 2>&1 | head -40`
Expected: TypeScript errors — `summarizeTextHandler` doesn't accept a second argument with `userRepository`/`creditService` fields yet (its `SummarizeTextOptions` only has `generateSummary`).

- [ ] **Step 3: Add user resolution and billing to the handler**

In `functions/src/summarizeText.ts`, add imports after the existing ones (after line 4):
```typescript
import { userRepository } from "./services/userRepository.js";
import { creditService } from "./services/creditService.js";
```

Add a cost constant after `MAX_OUTPUT_TOKENS` (line 12):
```typescript
const SUMMARIZE_TEXT_COST = 1;
```

Update `SummarizeTextOptions` (lines 25-27):
```typescript
interface SummarizeTextOptions {
  generateSummary?: GenerateSummaryFn;
}
```
→
```typescript
interface SummarizeTextOptions {
  generateSummary?: GenerateSummaryFn;
  userRepository?: Pick<typeof userRepository, "getOrCreateUserByFirebaseIdentity">;
  creditService?: Pick<typeof creditService, "spendCredits" | "refundCredit">;
}
```

Replace the handler body (lines 138-171):
```typescript
const handler = async (
  request: CallableRequest,
  options: SummarizeTextOptions = {}
): Promise<SummarizeTextResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const {text, maxCharacters} = parseInput(request.data);
  const users = options.userRepository ?? userRepository;
  const credits = options.creditService ?? creditService;

  const user = await users.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email: typeof decoded.email === "string" ? decoded.email.trim() : "",
    displayName: decoded.name,
  });

  const spendAllocations = await credits.spendCredits(user.id, SUMMARIZE_TEXT_COST);
  if (!spendAllocations) {
    throw new HttpsError("failed-precondition", "Insufficient credits to summarize text.");
  }

  const generateSummary = options.generateSummary ?? getSummaryGenerator();

  let summary: string;
  try {
    summary = await generateSummary(buildPrompt(text, maxCharacters));
  } catch (error) {
    logger.error("summarizeText model call failed", {error});
    try {
      await credits.refundCredit(user.id, spendAllocations);
    } catch (refundError) {
      logger.error("Failed to refund credits after summarizeText failure", {userId: user.id, error: refundError});
    }
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to summarize text.");
  }

  const normalizedSummary = truncateSummary(summary, maxCharacters);
  if (!normalizedSummary) {
    try {
      await credits.refundCredit(user.id, spendAllocations);
    } catch (refundError) {
      logger.error("Failed to refund credits after empty summarizeText result", {userId: user.id, error: refundError});
    }
    throw new HttpsError("internal", "Model returned an empty summary.");
  }

  return {summary: normalizedSummary};
};
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/summarizeText.test.js"`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd functions
git add src/summarizeText.ts src/summarizeText.test.ts
git commit -m "feat(functions): bill summarizeText 1 credit/call (was unbilled)"
```

---

## Task 8: Bill `generateEmbedding` (currently free) with the `Math.ceil` formula

**Files:**
- Modify: `functions/src/generateEmbedding.ts`
- Modify: `functions/src/generateEmbedding.test.ts`

- [ ] **Step 1: Rewrite the test file with a `makeOptions` helper and billing tests**

Replace the full contents of `functions/src/generateEmbedding.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {generateEmbeddingHandler} from "./generateEmbedding.js";
import type {CreditSpendAllocation} from "./services/creditService.js";

let counter = 0;
function buildAuth() {
  counter += 1;
  const uid = `uid-${counter}`;
  return { uid, token: { uid, email: `user-${counter}@example.com` } };
}

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);
const mockEmbedder = async (_text: string, _taskType: string) => MOCK_EMBEDDING;

function makeOptions(overrides: {
  embedder?: (text: string, taskType: string) => Promise<number[]>;
  spendCreditsImpl?: (userId: string, amount: number) => Promise<CreditSpendAllocation[] | null>;
  refundCreditImpl?: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>;
} = {}) {
  return {
    embedder: overrides.embedder ?? mockEmbedder,
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: "user-1",
        firebaseUid: "firebase-uid-1",
        email: "test@example.com",
        displayName: null,
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
    creditService: {
      spendCredits: overrides.spendCreditsImpl ?? (async () => [{transactionId: "mock-tx-id", amount: 1}]),
      refundCredit: overrides.refundCreditImpl ?? (async () => {}),
    },
  };
}

test("generateEmbedding: rejects unauthenticated request", async () => {
  const request = { auth: null, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "unauthenticated");
      return true;
    }
  );
});

test("generateEmbedding: rejects missing or invalid request data", async () => {
  const auth = buildAuth();
  const invalidRequests = [
    { auth, data: null },
    { auth, data: undefined },
    { auth, data: "not-an-object" },
    { auth, data: 123 },
    { auth, data: [] },
  ] as Array<{ auth: unknown; data: unknown }>;

  for (const request of invalidRequests) {
    await assert.rejects(
      () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
      (err: HttpsError) => {
        assert.equal(err.code, "invalid-argument");
        assert.match(err.message, /Request data must be an object/i);
        return true;
      }
    );
  }
});

test("generateEmbedding: rejects empty text", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /text/i);
      return true;
    }
  );
});

test("generateEmbedding: rejects whitespace-only text", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "   " } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /text/i);
      return true;
    }
  );
});

test("generateEmbedding: rejects text over max length", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "x".repeat(8_001) } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /8000/);
      return true;
    }
  );
});

test("generateEmbedding: accepts text of exactly max length", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "x".repeat(8_000) } };
  const result = await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions()
  );
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

test("generateEmbedding: rejects invalid taskType", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello", taskType: "INVALID_TYPE" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /taskType/);
      return true;
    }
  );
});

test("generateEmbedding: returns embedding for valid request", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "Tell me about dragons." } };
  const result = await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions()
  );
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

test("generateEmbedding: passes taskType to embedder", async () => {
  const auth = buildAuth();
  const capturedArgs: { text: string; taskType: string }[] = [];
  const trackingEmbedder = async (text: string, taskType: string) => {
    capturedArgs.push({ text, taskType });
    return MOCK_EMBEDDING;
  };

  const request = { auth, data: { text: "hello", taskType: "RETRIEVAL_QUERY" } };
  await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: trackingEmbedder }));
  assert.equal(capturedArgs.length, 1);
  assert.equal(capturedArgs[0].taskType, "RETRIEVAL_QUERY");
});

test("generateEmbedding: defaults taskType to RETRIEVAL_DOCUMENT", async () => {
  const auth = buildAuth();
  const capturedArgs: { text: string; taskType: string }[] = [];
  const trackingEmbedder = async (text: string, taskType: string) => {
    capturedArgs.push({ text, taskType });
    return MOCK_EMBEDDING;
  };

  const request = { auth, data: { text: "hello" } };
  await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: trackingEmbedder }));
  assert.equal(capturedArgs[0].taskType, "RETRIEVAL_DOCUMENT");
});

test("generateEmbedding: wraps embedder errors as HttpsError internal", async () => {
  const auth = buildAuth();
  const failingEmbedder = async (_text: string, _taskType: string): Promise<number[]> => {
    throw new Error("Vertex AI exploded");
  };
  const request = { auth, data: { text: "hello" } };
  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions({ embedder: failingEmbedder })),
    (err: HttpsError) => {
      assert.equal(err.code, "internal");
      return true;
    }
  );
});

test("generateEmbedding: throttles a single user after too many requests within the window", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello" } };

  // Throttle limit is 20 requests/minute per user.
  for (let i = 0; i < 20; i++) {
    await generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions());
  }

  await assert.rejects(
    () => generateEmbeddingHandler(request as unknown as CallableRequest, makeOptions()),
    (err: HttpsError) => {
      assert.equal(err.code, "resource-exhausted");
      return true;
    }
  );
});

test("generateEmbedding: does not throttle a different user", async () => {
  const throttledAuth = buildAuth();
  const throttledRequest = { auth: throttledAuth, data: { text: "hello" } };
  for (let i = 0; i < 20; i++) {
    await generateEmbeddingHandler(throttledRequest as unknown as CallableRequest, makeOptions());
  }

  const otherAuth = buildAuth();
  const otherRequest = { auth: otherAuth, data: { text: "hello" } };
  const result = await generateEmbeddingHandler(otherRequest as unknown as CallableRequest, makeOptions());
  assert.deepEqual(result.embedding, MOCK_EMBEDDING);
});

// ── Billing ──────────────────────────────────────────────────────────────────

test("generateEmbedding: spends 1 credit for a request under 50,000 characters", async () => {
  const auth = buildAuth();
  let spentAmount: number | null = null;
  const request = { auth, data: { text: "hello" } };

  await generateEmbeddingHandler(
    request as unknown as CallableRequest,
    makeOptions({
      spendCreditsImpl: async (_userId, amount) => {
        spentAmount = amount;
        return [{ transactionId: "mock-tx-id", amount }];
      },
    }),
  );

  assert.equal(spentAmount, 1);
});

test("generateEmbedding: rejects when credits are insufficient", async () => {
  const auth = buildAuth();
  const request = { auth, data: { text: "hello" } };

  await assert.rejects(
    () =>
      generateEmbeddingHandler(
        request as unknown as CallableRequest,
        makeOptions({ spendCreditsImpl: async () => null }),
      ),
    (err: HttpsError) => {
      assert.equal(err.code, "failed-precondition");
      return true;
    }
  );
});

test("generateEmbedding: refunds the credit when the embedder fails", async () => {
  const auth = buildAuth();
  let refunded = false;
  const request = { auth, data: { text: "hello" } };

  await assert.rejects(() =>
    generateEmbeddingHandler(
      request as unknown as CallableRequest,
      makeOptions({
        embedder: async () => { throw new Error("Vertex AI exploded"); },
        refundCreditImpl: async () => { refunded = true; },
      }),
    ),
  );

  assert.equal(refunded, true);
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd functions && npm run build 2>&1 | head -40`
Expected: TypeScript errors — `generateEmbeddingHandler`'s `EmbeddingOptions` doesn't have `userRepository`/`creditService` fields yet.

- [ ] **Step 3: Add user resolution and billing to the handler**

In `functions/src/generateEmbedding.ts`, add imports after the existing ones (after line 4):
```typescript
import type {DecodedIdToken} from "firebase-admin/auth";
import { userRepository } from "./services/userRepository.js";
import { creditService } from "./services/creditService.js";
```

Add a constant after `MAX_TEXT_LENGTH` (line 8):
```typescript
const EMBEDDING_CHARS_PER_CREDIT = 50_000;
```

Update `EmbeddingOptions` (lines 72-74):
```typescript
export interface EmbeddingOptions {
  embedder?: (text: string, taskType: string) => Promise<number[]>;
}
```
→
```typescript
export interface EmbeddingOptions {
  embedder?: (text: string, taskType: string) => Promise<number[]>;
  userRepository?: Pick<typeof userRepository, "getOrCreateUserByFirebaseIdentity">;
  creditService?: Pick<typeof creditService, "spendCredits" | "refundCredit">;
}
```

Replace the tail of `generateEmbeddingHandler`, from the `taskType` resolution through the return (lines 146-174):
```typescript
  let taskType: GenerateEmbeddingTaskType = "RETRIEVAL_DOCUMENT";
  if (rawTaskType !== undefined && rawTaskType !== null) {
    if (typeof rawTaskType !== "string") {
      throw new HttpsError("invalid-argument", "taskType must be a string.");
    }
    if (!ALLOWED_TASK_TYPES.has(rawTaskType as GenerateEmbeddingTaskType)) {
      throw new HttpsError(
        "invalid-argument",
        `taskType must be one of: ${[...ALLOWED_TASK_TYPES].join(", ")}.`
      );
    }
    taskType = rawTaskType as GenerateEmbeddingTaskType;
  }

  const embedder = options.embedder ?? defaultEmbedder;
  let embedding: number[];
  try {
    embedding = await embedder(text.trim(), taskType);
  } catch (error) {
    logger.error("generateEmbedding: embedder failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate embedding.");
  }

  return { embedding };
};
```
→
```typescript
  let taskType: GenerateEmbeddingTaskType = "RETRIEVAL_DOCUMENT";
  if (rawTaskType !== undefined && rawTaskType !== null) {
    if (typeof rawTaskType !== "string") {
      throw new HttpsError("invalid-argument", "taskType must be a string.");
    }
    if (!ALLOWED_TASK_TYPES.has(rawTaskType as GenerateEmbeddingTaskType)) {
      throw new HttpsError(
        "invalid-argument",
        `taskType must be one of: ${[...ALLOWED_TASK_TYPES].join(", ")}.`
      );
    }
    taskType = rawTaskType as GenerateEmbeddingTaskType;
  }

  const trimmedText = text.trim();
  const users = options.userRepository ?? userRepository;
  const credits = options.creditService ?? creditService;
  const decoded = request.auth.token as DecodedIdToken;

  const user = await users.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email: typeof decoded.email === "string" ? decoded.email.trim() : "",
    displayName: decoded.name,
  });

  const cost = Math.ceil(trimmedText.length / EMBEDDING_CHARS_PER_CREDIT);
  const spendAllocations = await credits.spendCredits(user.id, cost);
  if (!spendAllocations) {
    throw new HttpsError("failed-precondition", "Insufficient credits to generate embedding.");
  }

  const embedder = options.embedder ?? defaultEmbedder;
  let embedding: number[];
  try {
    embedding = await embedder(trimmedText, taskType);
  } catch (error) {
    logger.error("generateEmbedding: embedder failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    try {
      await credits.refundCredit(user.id, spendAllocations);
    } catch (refundError) {
      logger.error("Failed to refund credits after generateEmbedding failure", {userId: user.id, error: refundError});
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate embedding.");
  }

  return { embedding };
};
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/generateEmbedding.test.js"`
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
cd functions
git add src/generateEmbedding.ts src/generateEmbedding.test.ts
git commit -m "feat(functions): bill generateEmbedding Math.ceil(chars/50000) credits (was unbilled)"
```

---

## Task 9: Split `generateReply` into grounded (3) / standard (1)

**Files:**
- Modify: `functions/src/generateReply.ts`
- Modify: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Update the 5 existing tests that assert the old flat cost**

`buildStructuredRequestData(...)` (the test file's shared helper) never sets a `tools` field — every test using it exercises the **grounded** default path, which now costs 3, not 1. Apply these four edits:

**Edit A** — in `test("generateReplyHandler allows intro requests with structured payload to proceed", ...)`, replace:
```typescript
    creditService.spendCredits = async () => [{ transactionId: 'mock-tx-id', amount: 1 }];
    creditService.getCredits = async () => 2;

    let generateTextCalled = false;
```
with:
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      assert.equal(amount, 3);
      return [{ transactionId: 'mock-tx-id', amount: 3 }];
    };
    creditService.getCredits = async () => 2;

    let generateTextCalled = false;
```
and further down in the same test, replace `assert.equal(result.creditsSpent, 1);` with `assert.equal(result.creditsSpent, 3);`.

**Edit B** — rename `test("generateReplyHandler spends one credit for payg users", ...)` to `test("generateReplyHandler spends three credits for payg users on the grounded default path", ...)`, and inside it replace:
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return [{ transactionId: 'mock-tx-id', amount: 1 }];
    };
```
with:
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 3);
      return [{ transactionId: 'mock-tx-id', amount: 3 }];
    };
```
and later in the same test replace `assert.equal(result.creditsSpent, 1);` with `assert.equal(result.creditsSpent, 3);`.

**Edit C** — in `test("generateReplyHandler allows cancelled plans to spend remaining credits", ...)`, replace:
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 1);
      return [{ transactionId: 'mock-tx-id', amount: 1 }];
    };
```
with:
```typescript
    creditService.spendCredits = async (_userId, amount) => {
      spendCalls += 1;
      assert.equal(amount, 3);
      return [{ transactionId: 'mock-tx-id', amount: 3 }];
    };
```
and replace `assert.equal(result.creditsSpent, 1);` with `assert.equal(result.creditsSpent, 3);` later in the same test.

**Edit D** — in `test("generateReplyHandler does not bootstrap a subscription in the new credit flow", ...)`, replace:
```typescript
    creditService.spendCredits = async () => [{ transactionId: 'mock-tx-id', amount: 1 }];
    creditService.getCredits = async () => 49;
```
with:
```typescript
    creditService.spendCredits = async () => [{ transactionId: 'mock-tx-id', amount: 3 }];
    creditService.getCredits = async () => 49;
```
and replace `assert.equal(result.creditsSpent, 1);` with `assert.equal(result.creditsSpent, 3);` in the same test.

**Edit E** — in `test("generateReplyHandler still returns reply when unsyncedHistory DB insert fails", ...)`, replace:
```typescript
    creditService.spendCredits = async () => [{ transactionId: 'mock-tx-id', amount: 1 }];
    creditService.getCredits = async () => 4;
```
with:
```typescript
    creditService.spendCredits = async () => [{ transactionId: 'mock-tx-id', amount: 3 }];
    creditService.getCredits = async () => 4;
```
and replace `assert.equal(result.creditsSpent, 1);` with `assert.equal(result.creditsSpent, 3);` (the one at line ~1125, following `assert.equal(result.reply, "reply despite db failure");`).

Leave `test("generateReplyHandler returns functionCalls instead of throwing on an empty text response", ...)` (the one asserting `result.creditsSpent === 1` at line 626) **unchanged** — it explicitly passes `tools: [{ name: 'get_current_time', ... }]`, so it's the standard path and correctly stays at 1.

- [ ] **Step 2: Add a new explicit grounded-vs-standard cost test**

Add this test near the functionCalls test (after it, for locality):

```typescript
test("generateReplyHandler charges 3 credits when no tools are supplied (grounded default)", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let capturedAmount: number | null = null;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async (_userId, amount) => {
      capturedAmount = amount;
      return [{ transactionId: 'mock-tx-id', amount }];
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: "grounded reply" }),
      }
    );

    assert.equal(capturedAmount, 3);
    assert.equal(result.creditsSpent, 3);
  });
});

test("generateReplyHandler charges 1 credit when explicit tools are supplied (standard)", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);
    let capturedAmount: number | null = null;

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async (_userId, amount) => {
      capturedAmount = amount;
      return [{ transactionId: 'mock-tx-id', amount }];
    };
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
          systemInstruction: 'You are a helpful assistant.',
          tools: [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }],
        },
      } as never,
      {
        generateText: async () => ({ text: "standard reply" }),
      }
    );

    assert.equal(capturedAmount, 1);
    assert.equal(result.creditsSpent, 1);
  });
});
```

- [ ] **Step 3: Run to verify failures**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/generateReply.test.js" 2>&1 | tail -60`
Expected: the 5 updated tests and 2 new tests fail — `chargeForReply` still hardcodes `1`, ignoring `tools`.

- [ ] **Step 4: Thread `tools`-derived cost through `chargeForReply`**

In `functions/src/generateReply.ts`, replace `chargeForReply` (lines 535-546):
```typescript
async function chargeForReply(
  userId: string,
  credits: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>
): Promise<{ spendAllocations: CreditSpendAllocation[]; remainingCredits: number }> {
  const spendAllocations = await credits.spendCredits(userId, 1);
  if (spendAllocations === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const remainingCredits = await credits.getCredits(userId);
  return { spendAllocations, remainingCredits };
}
```
with:
```typescript
function computeReplyCost(tools?: ToolDeclaration[]): number {
  return tools && tools.length > 0 ? 1 : 3;
}

async function chargeForReply(
  userId: string,
  credits: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>,
  cost: number
): Promise<{ spendAllocations: CreditSpendAllocation[]; remainingCredits: number }> {
  const spendAllocations = await credits.spendCredits(userId, cost);
  if (spendAllocations === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const remainingCredits = await credits.getCredits(userId);
  return { spendAllocations, remainingCredits };
}
```

Update the call site (lines 649-652):
```typescript
  try {
    const charge = await chargeForReply(user.id, credits);
    spendAllocations = charge.spendAllocations;
    remainingCredits = charge.remainingCredits;
```
with:
```typescript
  const cost = computeReplyCost(tools);

  try {
    const charge = await chargeForReply(user.id, credits, cost);
    spendAllocations = charge.spendAllocations;
    remainingCredits = charge.remainingCredits;
```

Update the two hardcoded response literals — line 670 (inside the `functionCalls` early-return branch):
```typescript
        creditsSpent: 1,
```
→
```typescript
        creditsSpent: cost,
```
and line 689 (final success return):
```typescript
      creditsSpent: 1,
```
→
```typescript
      creditsSpent: cost,
```

(`tools` is already destructured from `parsed` at line 569, in scope at the `computeReplyCost(tools)` call site. `ToolDeclaration` is already imported/used elsewhere in this file — no new import needed.)

- [ ] **Step 5: Run to verify pass**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/generateReply.test.js" 2>&1 | tail -80`
Expected: full file passes (all pre-existing tests plus the 2 new ones).

- [ ] **Step 6: Commit**

```bash
cd functions
git add src/generateReply.ts src/generateReply.test.ts
git commit -m "feat(functions): split generateReply into grounded (3 credits) / standard (1 credit)"
```

---

## Task 10: Update `docs/billing-and-credits.md`

**Files:**
- Modify: `docs/billing-and-credits.md`

- [ ] **Step 1: Rewrite the Credit Consumption table and connect-gate line**

Replace lines 24-39 of `docs/billing-and-credits.md`:

```markdown
### Credit Consumption

Per-action costs. Firebase text/chat paths charge **per round-trip** (a multi-tool turn costs more); cloud-agent text turns charge **per internal tool-call loop iteration, capped at 5**. Live voice is billed separately on a 60-second timer. This difference is intentional.

| Action | Path | Cost | Refund on failure |
|---|---|---|---|
| Text chat reply (grounded) | `generateReply` (Functions), no explicit `tools` (default googleSearch) | 3 / round-trip | Yes |
| Text chat reply (standard) | `generateReply` (Functions), explicit `tools` supplied | 1 / round-trip | Yes |
| Image generation | `generateImage` | 2 | Yes |
| Document text conversion | `convertDocumentText` | 2 | Yes |
| Summarization | `summarizeText` | 1 | Yes |
| Embeddings | `generateEmbedding` | 1 / 50,000 characters (`Math.ceil`) | Yes |
| Wiki LLM / sync, memory write/heal | `wikiLlm`, `wikiSync`, `memoryWrite`, `memoryHeal` | 1 each | Yes |
| Agent turn (text) | cloud-agent `POST /agent/run` | 1 / internal tool-call loop iteration, max 5 | Yes (only credits actually spent this turn) |
| Live voice | cloud-agent `/agent/live` | 5 / 60s timer | Partial minute not billed |
| Scheduler trigger | cloud-agent scheduler-trigger | 1 (deduped) | Yes |
| `browser_action` tool | contextual | Voice: 1; Text: pre-billed (skipped) | See Browser Action Billing |

**Live voice connect gate:** a session requires a balance of **≥ 5** to start (enforced by both the client and the server). Billing runs on a 60-second timer, so a session shorter than the first tick is not billed.
```

- [ ] **Step 2: Verify the table renders correctly and matches the spec**

Run: `grep -A2 "Live voice connect gate" docs/billing-and-credits.md`
Expected: shows the updated `≥ 5` line. Manually diff the 12 cost values in the new table against the Overview table in `docs/superpowers/specs/2026-07-01-credit-economy-repricing-design.md` — every number must match exactly.

- [ ] **Step 3: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs: update Credit Consumption table for the July 2026 repricing"
```

---

## Task 11: Update consumer-facing copy

**Files:**
- Modify: `app/index.web.tsx`
- Modify: `src/components/LandingPage/FeaturesSection.tsx`

- [ ] **Step 1: Update the meta description**

In `app/index.web.tsx`, line 29:
```typescript
          content="Create AI characters, chat with them, and talk in real time with live voice calls. Hands-free conversations with web search and shared memory. 1 credit per minute for live voice."
```
→
```typescript
          content="Create AI characters, chat with them, and talk in real time with live voice calls. Hands-free conversations with web search and shared memory. 5 credits per minute for live voice."
```

- [ ] **Step 2: Update the landing page feature copy**

In `src/components/LandingPage/FeaturesSection.tsx`, line 11:
```typescript
    body: 'Experience natural, uninterrupted conversations that feel exactly like a real phone call. Talk hands-free on speakerphone, interrupt your character seamlessly if you change your mind, and listen as they search the web or check your shared memory mid-conversation. (Live voice sessions cost just 1 credit per minute.)',
```
→
```typescript
    body: 'Experience natural, uninterrupted conversations that feel exactly like a real phone call. Talk hands-free on speakerphone, interrupt your character seamlessly if you change your mind, and listen as they search the web or check your shared memory mid-conversation. (Live voice sessions cost 5 credits per minute.)',
```

Leave `app/(drawer)/(tabs)/characters/[id]/edit.tsx:469` ("Costs 1 credit per sync.") and `app/support.tsx:92` ("Voice replies cost 2 credits per reply") untouched — the former is `wikiSync` (unchanged), the latter references the dead `generateVoiceReply` path being deleted by a separate spec.

- [ ] **Step 3: Verify no other stale references remain**

Run: `grep -rn "1 credit per minute\|1 credit/minute\|1 credit / 60s\|1 credit per 60" app/ src/ --include="*.tsx" --include="*.ts"`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add app/index.web.tsx src/components/LandingPage/FeaturesSection.tsx
git commit -m "docs: update consumer-facing copy to 5 credits/minute for live voice"
```

---

## Final verification (run after all 11 tasks)

```bash
cd cloud-agent && npm run typecheck && npm run lint && npm test
cd ../functions && npm run typecheck && npm run lint && npm test
cd .. && npm run typecheck && npm run lint && npm test -- __tests__/useLiveVoiceChat.test.tsx
```

All three suites must pass with zero failures before considering this plan complete.
