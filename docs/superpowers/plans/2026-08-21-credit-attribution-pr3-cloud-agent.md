# Credit Spend Attribution — PR 3 of 3 (cloud-agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every credit spend in `cloud-agent` — the highest-volume writer, one spend per ADK chat iteration — records a `(user_id, amount, reason)` event atomically with the spend.

**Architecture:** `cloud-agent`'s raw-SQL `spendCredit` drops its amount default and gains a required third `reason` param, inserting one `credit_spend_events` row inside its existing transaction after allocations succeed and before the subscriptions-cache UPDATE. All 4 call sites pass explicit costs plus registry tokens. The table itself ships in PR 2 — **this PR must not merge before prod migration `0024` is applied** (deploys go straight to prod; the INSERT would reject on a missing table and fail every cloud turn).

**Tech Stack:** TypeScript 6, Drizzle `sql` templates over raw SQL, Express/ADK handlers, `node:test` + `node:assert/strict` over compiled `dist/**/*.test.js`.

**Spec:** [2026-08-21-streaming-id-unification-and-credit-spend-attribution-design](../specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md) (Fix B, `cloud-agent` half)
**Sibling plan:** [pr2 functions](../plans/2026-08-21-credit-attribution-pr2-functions.md) — creates the table this PR writes to.

## Global Constraints

- PR targets **`staging`**, never `main`; user merges explicitly. Branch off current `staging` — no file overlaps PR 2 except the spec doc, edited in disjoint regions.
- **Merge gate:** prod migration `0024_credit_spend_events.sql` applied (PR 2 Task 5) BEFORE this PR merges. Verify with the user at ship time.
- No `--write`/`--fix` gates, no formatting sweeps, formatting isolated from logic commits. No `BREAKING CHANGE:` footer.
- `reason` free-form text; new token this PR: `scheduled_trigger`. Costs explicit everywhere (`AGENT_TURN_CREDIT_COST` passed instead of relying on the removed default).
- Tests are `node:test`, run from built `dist/`. Jest syntax is DOA.
- Existing handler/tool test doubles stubbing `spendCredit` with fewer parameters stay valid TS (fewer-param assignability) and ignore the extra runtime argument — expected, not a regression.
- Baseline: `cd cloud-agent && npm test` passes before this branch (288 tests per project memory).

## File Structure

- Branch: `git checkout staging && git pull && git checkout -b feat/credit-attribution-cloud-agent` before Task 1 (staging may already contain PR 2 by then; the two PRs touch disjoint files, so either order works).
- Modify `cloud-agent/src/services/creditService.ts` — type + signature + INSERT.
- Modify `cloud-agent/src/services/creditService.test.ts` — capturing mock helpers, new assertions, queue shifts.
- Modify 4 call-site files (Task 2 Step 4).
- Modify spec doc (Status flip + `scheduled_trigger` row) — final task.

---

### Task 1: spendCredit signature + event insert (TDD)

**Files:**

- Test: `cloud-agent/src/services/creditService.test.ts`
- Modify: `cloud-agent/src/services/creditService.ts` (type line 11, impl lines 24–106)

**Interfaces:**

- Consumes: table `credit_spend_events` from PR 2 (raw SQL — cloud-agent has no local schema declaration, matching how it already touches `credit_transactions`).
- Produces: `spendCredit(userId: string, amount: number, reason: string): Promise<CreditSpendAllocation[]>` on the exported `CreditService` type — throws `INSUFFICIENT_CREDITS` / `INVALID_CREDIT_AMOUNT` as today; no default amount.

- [ ] **Step 1: Add capture helpers to the test file**

After the existing `makeExecuteDb` helper, add:

```ts
// Renders a drizzle SQL template object (static text chunks + Param values)
// into one string so assertions can see both the statement and its bound values.
function renderQuery(query: unknown): string {
  const chunks = (query as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? []
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value
      return Array.isArray(value) ? value.join('') : String(value ?? '')
    })
    .join(' ')
}

// Same response-queue semantics as makeExecuteDb (shared index across db and tx
// execute), plus a rendered log of every query that ran.
function makeCapturingDb(responses: Array<{ rows: unknown[] } | Error>): {
  db: DrizzleClient
  queries: string[]
} {
  const queries: string[] = []
  let callIndex = 0
  const run = async (query: unknown) => {
    queries.push(renderQuery(query))
    const response = responses[callIndex++]
    if (response instanceof Error) throw response
    return response ?? { rows: [] }
  }
  const db = {
    execute: run,
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) =>
      callback({ execute: run } as unknown as DrizzleClient),
  } as unknown as DrizzleClient
  return { db, queries }
}
```

- [ ] **Step 2: Update existing spend tests for the shifted call sequence and required args**

The event INSERT adds one `execute` call between the allocation UPDATEs and the subscriptions-cache UPDATE. For each successful-spend test using `makeExecuteDb`, append `{ rows: [] }` to the response array at that position and renumber the comment lines; switch calls to explicit three-arg form `'user-1', <amount>, 'chat_reply'`. Concretely:

1. `spendCredit returns an allocation array when a qualifying row exists`: responses become SEVEN entries (new 6th `{ rows: [] }` = event INSERT; old 6th cache-UPDATE becomes 7th). Comment renumbered: Call 5 UPDATE credit_transactions, **Call 6 INSERT INTO credit_spend_events**, Call 7 UPDATE subscriptions cache. Invocation: `cs.spendCredit('user-1', 1, 'chat_reply')`.
2. `spendCredit spans multiple rows…`: EIGHT entries (Calls 5,6 row updates; Call 7 event INSERT; Call 8 cache). Invocation: `cs.spendCredit('user-1', 5, 'chat_reply')`.
3. `spendCredit defaults amount to 100 when not passed`: DELETE this test — the default is being removed; replace it with the guard test in Step 3.
4. Insufficient-credit tests (`throws INSUFFICIENT_CREDITS when no qualifying row`, `…net balance across all rows is short`, `does not update subscriptions when spend fails`): add `, 'chat_reply'` args; call counts unchanged (they fail before the INSERT); the `executeCalls === 3` assertion stays correct.
5. `refundCredit` / `getBalance` tests: untouched (different methods).

- [ ] **Step 3: Write the failing new tests**

Append to the spendCredit section:

```ts
test('spendCredit inserts exactly one attribution event with user, amount, and reason', async () => {
  // Calls: INSERT subscriptions, SELECT FOR UPDATE subscriptions, SELECT net SUM,
  // SELECT rows FOR UPDATE, UPDATE credit_transactions, INSERT credit_spend_events,
  // UPDATE subscriptions cache.
  const { db, queries } = makeCapturingDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '100' }] },
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ])
  const cs = createCreditService(db)
  await cs.spendCredit('user-1', 100, 'chat_reply')
  const events = queries.filter((q) => q.includes('INSERT INTO credit_spend_events'))
  assert.equal(events.length, 1)
  assert.ok(events[0].includes('user_id'), 'inserts user_id column')
  assert.ok(events[0].includes('user-1'), 'binds userId')
  assert.ok(events[0].includes('100'), 'binds amount')
  assert.ok(events[0].includes('chat_reply'), 'binds reason')
})

test('spendCredit writes no attribution event when credits are insufficient', async () => {
  const { db, queries } = makeCapturingDb([
    { rows: [] },
    { rows: [{ user_id: 'user-1' }] },
    { rows: [{ total: '3' }] }, // < amount 5 → INSUFFICIENT_CREDITS
  ])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1', 5, 'chat_reply'),
    (err: Error) => err.message === 'INSUFFICIENT_CREDITS',
  )
  assert.equal(queries.filter((q) => q.includes('INSERT INTO credit_spend_events')).length, 0)
})

test('attribution insert precedes the cache sync so a later failure discards both', async () => {
  // Mock-level guarantee: the event INSERT is issued inside the SAME transaction
  // callback before the failing step — Postgres rolls back everything together.
  const cacheError = new Error('subscriptions cache exploded')
  const { db, queries } = makeCapturingDb([
    { rows: [] }, // INSERT subscriptions
    { rows: [{ user_id: 'user-1' }] }, // SELECT FOR UPDATE subscriptions
    { rows: [{ total: '100' }] }, // SELECT net SUM
    { rows: [{ id: 'tx-abc', remaining_balance: '100' }] }, // SELECT rows FOR UPDATE
    { rows: [] }, // UPDATE credit_transactions
    { rows: [] }, // INSERT credit_spend_events — must succeed FIRST
    cacheError, // UPDATE subscriptions cache rejects AFTER the event INSERT
  ])
  const cs = createCreditService(db)
  await assert.rejects(() => cs.spendCredit('user-1', 100, 'chat_reply'), /cache exploded/)
  assert.equal(queries.filter((q) => q.includes('INSERT INTO credit_spend_events')).length, 1)
})

test('spendCredit requires amount and reason explicitly (no default)', async () => {
  const { db } = makeCapturingDb([])
  const cs = createCreditService(db)
  await assert.rejects(() =>
    (cs.spendCredit as (...args: unknown[]) => Promise<unknown>)('user-1', undefined, 'chat_reply'),
  )
})
```

- [ ] **Step 4: Run to verify failures**

Run: `cd cloud-agent && npm run build >/dev/null 2>&1; NODE_ENV=test node --test dist/services/creditService.test.js`
Expected: FAIL on the new assertions (no event INSERT exists yet; the two-arg happy-path tests updated in Step 2 also fail because the queue positions don't yet match an INSERT-less implementation... they actually still pass mechanically via the `?? {rows:[]}` fallback — the REAL failures are the four new tests). If any Step-2 test unexpectedly fails, fix its queue/comment first, then proceed.

- [ ] **Step 5: Implement**

In `cloud-agent/src/services/creditService.ts`:

```ts
export type CreditService = {
  spendCredit: (userId: string, amount: number, reason: string) => Promise<CreditSpendAllocation[]>
  refundCredit: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>
  getBalance: (userId: string) => Promise<number>
}
```

and the method (drop the default):

```ts
    async spendCredit(
      userId: string,
      amount: number,
      reason: string,
    ): Promise<CreditSpendAllocation[]> {
```

Immediately after the `if (remaining > 0 || allocations.length === 0) { … throw new Error('INSUFFICIENT_CREDITS') }` guard and immediately before the `// Update subscriptions cache (row is already locked)` block:

```ts
// Attribution ledger — same transaction as the spend, so it commits,
// and rolls back, atomically with it.
await tx.execute(sql`
          INSERT INTO credit_spend_events (user_id, amount, reason)
          VALUES (${userId}, ${amount}, ${reason})
        `)
```

Nothing else changes — lock order, FIFO allocation, refunds, getBalance untouched.

- [ ] **Step 6: Run service tests**

Run: `cd cloud-agent && NODE_ENV=test node --test dist/services/creditService.test.js`
Expected: PASS.

### Task 2: Tag the 4 cloud-agent call sites

**Files:**

- Modify: `cloud-agent/src/services/agentEventLoop.ts:105`
- Modify: `cloud-agent/src/tools/browserAction.ts:101` (+ import)
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts:478`
- Modify: `cloud-agent/src/handlers/schedulerTriggerHandler.ts:187` (+ import)

**Interfaces:** Consumes Task 1's three-arg `spendCredit`. `tsc` now enforces full coverage — any missed site fails typecheck.

- [ ] **Step 1: Exact replacements**

| File                             | Old                                                               | New                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentEventLoop.ts:105`          | `const allocations = await creditService.spendCredit(userId)`     | `const allocations = await creditService.spendCredit(userId, AGENT_TURN_CREDIT_COST, 'chat_reply')` — import of `AGENT_TURN_CREDIT_COST` already present (line 6)                                           |
| `browserAction.ts:101`           | `allocations = await deps.creditService.spendCredit(deps.userId)` | `allocations = await deps.creditService.spendCredit(deps.userId, AGENT_TURN_CREDIT_COST, 'browser_action')` — add `import { AGENT_TURN_CREDIT_COST } from '../constants/credits.js'` with the other imports |
| `wsLiveAgentHandler.ts:478`      | `await cs.spendCredit(userId!, LIVE_SESSION_CREDIT_COST)`         | `await cs.spendCredit(userId!, LIVE_SESSION_CREDIT_COST, 'live_voice')` — import already present (line 21)                                                                                                  |
| `schedulerTriggerHandler.ts:187` | `allocations = await creditService.spendCredit(userId)`           | `allocations = await creditService.spendCredit(userId, AGENT_TURN_CREDIT_COST, 'scheduled_trigger')` — add the same constants import                                                                        |

- [ ] **Step 2: Full backend verification**

Run: `cd cloud-agent && npm test && npm run typecheck`
Expected: PASS — including `index.test.ts`, `wsAgentHandler.test.ts`, `wsLiveAgentHandler.test.ts`, `browserAction.test.ts`, `schedulerTriggerHandler.test.ts`, `vaultTools.test.ts` whose doubles ignore the extra argument.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/services/creditService.ts cloud-agent/src/services/creditService.test.ts cloud-agent/src/services/agentEventLoop.ts cloud-agent/src/tools/browserAction.ts cloud-agent/src/handlers/wsLiveAgentHandler.ts cloud-agent/src/handlers/schedulerTriggerHandler.ts
git commit -m "feat(cloud-agent): attribute every credit spend with a required reason"
```

### Task 3: Flip the spec status + register token

- [ ] **Step 1: Spec edits**

In the design doc: Status line becomes `**Status:** Implemented 2026-08-21 — Fix A in PR #621 (merged to main via release PR #622); Fix B in feat/credit-attribution-functions + this branch`. Reason-vocabulary table gains `| scheduled_trigger | schedulerTriggerHandler.ts:187 (one spend per scheduler-triggered agent run) |`. §Schema paragraph: note cloud-agent inserts via raw SQL (already true of `credit_transactions`) if not obvious from context.

- [ ] **Step 2: Format-check and commit**

Run: `npx prettier --check` on the touched markdown only.

```bash
git add docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md
git commit -m "docs(spec): mark streaming-id + credit-attribution implemented"
```

### Task 4: Ship (with merge-gate STOP)

- [ ] **Step 1: Push and open PR** targeting `staging` from `feat/credit-attribution-cloud-agent`.
- [ ] **Step 2: STOP** — confirm with the user that prod migration `0024` is applied before they merge this PR.
