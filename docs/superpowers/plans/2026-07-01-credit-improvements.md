# Credit Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the multi-credit spend correctness bug, remove a dead client-facing spend callable, reconcile two billing policy contradictions, and document per-action credit consumption as a single source of truth.

**Architecture:** Five independent changes to the shared credit system. The core fix rewrites `spendCredits` (Firebase Functions) to consume across multiple `credit_transactions` rows instead of requiring one row to hold the full amount. The rest are targeted deletions / single-line policy edits plus a docs table. Cloud-agent `spendCredit` is untouched (fixed 1-credit spends can never fragment).

**Tech Stack:** TypeScript, Drizzle ORM (Cloud SQL / Postgres), Firebase Functions v2 (`onCall`), `node:test` + `node:assert/strict`, React Native client callables.

**Decisions locked in (from brainstorming):**
- #2 EXECUTION_TIMEOUT → **no refund** (align code to doc; consistent with SELECTOR_NOT_FOUND).
- #4 live-voice connect gate → **require ≥ 2** (raise server to match client + docs).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `functions/src/services/creditService.ts` | Modify `spendCredits` (lines ~159-189) | Consume across multiple rows honoring net balance |
| `functions/src/services/creditService.test.ts` | Add test | Cover fragmented multi-row spend |
| `functions/src/spendCredits.ts` | Delete | Dead client-controlled callable |
| `functions/src/spendCredits.test.ts` | Delete | Test for deleted callable |
| `functions/src/index.ts` | Remove export (lines 21-23) | Stop deploying the callable |
| `src/config/firebaseConfig.ts` | Remove `spendCreditsFn` (lines 89, 127) | Drop client binding |
| `src/config/firebaseConfig.web.ts` | Remove `spendCreditsFn` (lines 145, 184) | Drop web client binding |
| `cloud-agent/src/tools/browserAction.ts` | Remove refund in EXECUTION_TIMEOUT branch (lines ~147) | Align timeout policy to doc |
| `cloud-agent/src/handlers/wsLiveAgentHandler.ts` | Change gate `balance <= 0` → `balance < 2` (line ~316) | Match client/doc ≥ 2 threshold |
| `docs/billing-and-credits.md` | Add "Credit Consumption" table | Single source of truth for per-action cost |

---

## Task 1: Fix multi-row spend (#1)

Currently `spendCredits(userId, amount)` passes a net-balance check, then selects **one** row with `remaining_balance >= amount`. When a user's balance is fragmented across rows (e.g. 1 signup + 1 subscription credit, net = 2) no single row holds 2, so a multi-credit spend spuriously returns `null` → "Insufficient credits". Fix: after the net check passes under the row lock, deduct across the earliest-expiring rows in a loop.

**Refund contract note:** `spendCredits` returns `CreditSpendAllocation[] | null` — one `{ transactionId, amount }` per row debited, with amounts summing to the spent total. `refundCredit(userId, allocations)` restores each row by its debited amount so multi-row spends are fully reversible.

**Files:**
- Modify: `functions/src/services/creditService.ts` (`spendCredits`, lines 159-189)
- Test: `functions/src/services/creditService.test.ts`

- [ ] **Step 1: Write the failing test**

Add after the existing `spendCredits returns transactionId and decrements balance on qualifying row` test (after line 180) in `functions/src/services/creditService.test.ts`:

```typescript
test('spendCredits spends across multiple rows when balance is fragmented', async () => {
  let decrementCount = 0;

  // select() call order:
  // 1. subscriptions FOR UPDATE lock
  // 2. net balance check → 2 (>= amount)
  // 3. spend rows FOR UPDATE → two rows of 1 each (fragmented)
  // 4. syncSubscriptionCache total
  // 5. syncSubscriptionCache nextExpiry
  // 6. syncSubscriptionCache existing sub
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }],
    [{ total: 2 }],
    [{ id: 'tx-early', remainingBalance: 1 }, { id: 'tx-late', remainingBalance: 1 }],
    [{ total: 0 }],
    [{ minExpiry: null }],
    [],
  ];
  let selectIdx = 0;

  const fakeTx = {
    select: () => {
      const rows = selectQueue[selectIdx++] ?? [];
      return {
        from: () => ({
          where: () => Object.assign(Promise.resolve(rows), {
            limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
            orderBy: () => ({ for: async () => rows }),
          }),
        }),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (vals && 'remainingBalance' in vals) decrementCount++;
        },
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: (_opts?: unknown) => ({}) }),
    }),
  };
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<string | null>, _opts?: unknown) => fn(fakeTx),
  };

  const service = createCreditService({ getDb: async () => fakeDb as never });
  const result = await service.spendCredits('user-1', 2);
  assert.deepEqual(result, [
    { transactionId: 'tx-early', amount: 1 },
    { transactionId: 'tx-late', amount: 1 },
  ]);
  assert.equal(decrementCount, 2);        // both fragmented rows decremented
});
```

Note: the new implementation's spend-rows query drops `.limit(1)`, so the mock exposes `orderBy: () => ({ for })` (no intermediate `limit`). The existing single-row test keeps its `orderBy: () => ({ limit: () => ({ for }) })` shape; leave it as-is — the old chain still resolves because `.for` is what the code awaits.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm test -- --test-name-pattern='fragmented'`
Expected: FAIL — current code selects `.limit(1)` and returns `tx-early` but only decrements once (`decrementCount === 1`), so `assert.equal(decrementCount, 2)` fails. (It may instead throw on the mock shape — either way, red.)

- [ ] **Step 3: Write minimal implementation**

Replace lines 159-189 of `functions/src/services/creditService.ts` (the block from `const rows = await tx` through `return rows[0].id;`) with:

```typescript
          const rows = await tx
            .select({ id: creditTransactions.id, remainingBalance: creditTransactions.remainingBalance })
            .from(creditTransactions)
            .where(
              and(
                eq(creditTransactions.userId, userId),
                gt(creditTransactions.remainingBalance, 0),
                or(
                  isNull(creditTransactions.expiresAt),
                  gt(creditTransactions.expiresAt, sql`NOW()`)
                )
              )
            )
            .orderBy(sql`${creditTransactions.expiresAt} NULLS LAST`)
            .for('update');

          let remaining = amount;
          const allocations: Array<{ transactionId: string; amount: number }> = [];
          for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(Number(row.remainingBalance), remaining);
            await tx
              .update(creditTransactions)
              .set({ remainingBalance: sql`${creditTransactions.remainingBalance} - ${take}` })
              .where(eq(creditTransactions.id, row.id));
            allocations.push({ transactionId: row.id, amount: take });
            remaining -= take;
          }

          if (remaining > 0 || allocations.length === 0) {
            // Net balance passed under lock but rows could not cover it — should be unreachable.
            logger.warn('spendCredits: net balance sufficient but rows could not cover amount', { userId, amount, net: netResult[0]?.total });
            throw new InsufficientCreditsError();
          }

          await syncSubscriptionCache(tx, userId);

          return allocations;
```

The `gte` import is now unused. Remove `gte` from the import on line 1: change `import { eq, sql, and, or, isNull, gt, gte, ne } from 'drizzle-orm';` to `import { eq, sql, and, or, isNull, gt, ne } from 'drizzle-orm';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm test -- --test-name-pattern='spendCredits'`
Expected: PASS — all three `spendCredits` tests green (the two existing single-row tests still pass; single-credit spends touch one row and return it).

- [ ] **Step 5: Typecheck**

Run: `cd functions && npm run build` (or `npx tsc --noEmit`)
Expected: no errors; confirms the removed `gte` import isn't referenced elsewhere.

- [ ] **Step 6: Commit**

```bash
git add functions/src/services/creditService.ts functions/src/services/creditService.test.ts
git commit -m "fix(credits): spend across multiple rows so fragmented balances honor net total"
```

---

## Task 2: Remove dead client-controlled spendCredits callable (#5)

`functions/src/spendCredits.ts` deploys an `onCall` that trusts a client-supplied `amount` and has no call site in `src/` or `app/`. Delete it and every export/binding.

**Files:**
- Delete: `functions/src/spendCredits.ts`
- Delete: `functions/src/spendCredits.test.ts`
- Modify: `functions/src/index.ts` (lines 21-23)
- Modify: `src/config/firebaseConfig.ts` (lines 89, 127)
- Modify: `src/config/firebaseConfig.web.ts` (lines 145, 184)

- [ ] **Step 1: Delete the function and its test**

```bash
git rm functions/src/spendCredits.ts functions/src/spendCredits.test.ts
```

- [ ] **Step 2: Remove the export from `functions/src/index.ts`**

Delete lines 21-23 (the whole block):

```typescript
export {
  spendCredits,
} from "./spendCredits.js";
```

- [ ] **Step 3: Remove the client binding from `src/config/firebaseConfig.ts`**

Delete line 89:

```typescript
const spendCreditsFn = httpsCallable(functionsInstance, 'spendCredits')
```

Delete line 127 inside the `export { ... }` block:

```typescript
  spendCreditsFn,
```

- [ ] **Step 4: Remove the client binding from `src/config/firebaseConfig.web.ts`**

Delete the matching lines (≈145 and ≈184):

```typescript
const spendCreditsFn = httpsCallable(functionsInstance, 'spendCredits')
```
```typescript
  spendCreditsFn,
```

- [ ] **Step 5: Verify no dangling references**

Run: `git grep -n "spendCreditsFn\|spendCreditsHandler\|from \"./spendCredits" -- 'functions/src' 'src' 'app'`
Expected: no output. (Grep for `spendCredits` broadly will still match `creditService.spendCredits(...)` call sites — those are the service method and must stay.)

- [ ] **Step 6: Typecheck both projects**

Run: `cd functions && npm run build` and, from repo root, `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(credits): remove unused client-controlled spendCredits callable"
```

---

## Task 3: Remove EXECUTION_TIMEOUT refund (#2)

Decision: no refund on the local 30s `EXECUTION_TIMEOUT` — the extension connected and burned compute, matching `SELECTOR_NOT_FOUND` and the billing doc. Remove only the refund line; keep writing the failed task result and closing the session.

**Files:**
- Modify: `cloud-agent/src/tools/browserAction.ts` (line ~147)

- [ ] **Step 1: Delete the refund line**

In the `waitForTerminalTask` timeout branch (after `fs.writeTaskResult(... EXECUTION_TIMEOUT ...)`), delete this line (≈147):

```typescript
            if (txId) { try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ } }
```

Leave the surrounding `fs.writeTaskResult(...)`, `fs.closeSession(...)`, and `resolve(executionTimeoutTask())` intact. Do **not** touch the `EXTENSION_OFFLINE` branch (≈131) — that refund stays (extension never connected).

- [ ] **Step 2: Check for a browserAction test asserting the timeout refund**

Run: `git grep -n "EXECUTION_TIMEOUT\|executionTimeout" -- cloud-agent/src`
If a test asserts `refundCredit` is called on `EXECUTION_TIMEOUT`, update it to assert refund is **not** called (and that a `SELECTOR_NOT_FOUND`/terminal-failure-style no-refund holds). If no such assertion exists, no test change needed.

- [ ] **Step 3: Run cloud-agent tests + typecheck**

Run: `cd cloud-agent && npm test && npm run build`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/tools/browserAction.ts
git commit -m "fix(billing): no refund on browser_action EXECUTION_TIMEOUT, align to doc"
```

---

## Task 4: Raise live-voice connect gate to ≥ 2 (#4)

Server currently rejects only `balance <= 0`, letting a 1-credit user connect even though the client `useLiveVoiceChat` and `docs/real-time-voice-chat.md` require ≥ 2. Raise the server gate to match.

**Files:**
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts` (line ~315-320)

- [ ] **Step 1: Change the threshold**

In `handleAuthMessage`, change:

```typescript
      const balance = await cs.getBalance(userId)
      if (balance <= 0) {
```

to:

```typescript
      const balance = await cs.getBalance(userId)
      if (balance < 2) {
```

Leave the `INSUFFICIENT_CREDITS` error code, message, and `ws.close(4402, ...)` unchanged.

- [ ] **Step 2: Check for a handler test asserting the old threshold**

Run: `git grep -n "balance\|INSUFFICIENT_CREDITS\|4402" -- cloud-agent/src/handlers`
If a test connects with balance === 1 and expects success, flip it to expect rejection; if a test expects rejection at balance 0, keep it. Add/adjust a case for balance 1 → rejected, balance 2 → accepted if the harness supports it.

- [ ] **Step 3: Run cloud-agent tests + typecheck**

Run: `cd cloud-agent && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/handlers/wsLiveAgentHandler.ts
git commit -m "fix(billing): require >=2 credits to start live voice, matching client/doc"
```

---

## Task 5: Add Credit Consumption table to billing doc (#10)

Consolidate scattered per-action costs (currently spread across `ai-and-chat.md`, `edge-agent.md`, `architecture-and-data.md`, `real-time-voice-chat.md`, and only-in-code voice = 2) into one table in `docs/billing-and-credits.md`, and fix the now-resolved contradictions in the existing "Browser Action Billing" section.

**Files:**
- Modify: `docs/billing-and-credits.md`

- [ ] **Step 1: Insert the consumption table**

Immediately after the `### Refunds` block (after line 17, before the `---` on line 19), insert:

```markdown

### Credit Consumption

Per-action costs. Firebase text/chat paths charge **per round-trip** (a multi-tool turn costs more); the cloud-agent charges a **flat 1 per turn**. This edge-vs-cloud difference is intentional.

| Action | Path | Cost | Refund on failure |
|---|---|---|---|
| Text chat reply | `generateReply` (Functions) | 1 / round-trip (incl. tool rounds) | Yes |
| Image generation | `generateImage` | 1 | Yes |
| Document text conversion | `convertDocumentText` | 1 | Yes |
| Wiki LLM / sync, memory write/heal | `wikiLlm`, `wikiSync`, `memoryWrite`, `memoryHeal` | 1 each | Yes |
| Agent turn (text) | cloud-agent `POST /agent/run` | 1 / turn (flat) | Yes |
| Live voice | cloud-agent `/agent/live` | 1 / 60s timer | Partial minute not billed |
| Scheduler trigger | cloud-agent scheduler-trigger | 1 (deduped) | Yes |
| `browser_action` tool | contextual | Voice: 1; Text: pre-billed (skipped) | See Browser Action Billing |

**Live voice connect gate:** a session requires a balance of **≥ 2** to start (enforced by both the client and the server). Billing runs on a 60-second timer, so a session shorter than the first tick is not billed.
```

- [ ] **Step 2: Fix the Browser Action refund line for the #2 decision**

In the existing "Browser Action Billing" section, the `**Refunds:**` line (line 32) already reads "No refund on execution errors (`SELECTOR_NOT_FOUND`, `EXECUTION_TIMEOUT`, etc.)". Confirm it still says exactly that — it now matches the code (Task 3). No wording change needed; if the text drifted, restore it to list `EXECUTION_TIMEOUT` under no-refund.

- [ ] **Step 3: Verify Markdown renders**

Run: `git diff docs/billing-and-credits.md`
Expected: table well-formed (aligned pipes), inserted between `### Refunds` and the first `---`.

- [ ] **Step 4: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs(billing): add per-action Credit Consumption table as single source of truth"
```

---

## Self-Review Notes

- **Spec coverage:** #1 (Task 1), #5 (Task 2), #2 (Task 3), #4 (Task 4), #10 (Task 5). All four scoped items + both product decisions covered.
- **Cloud-agent `spendCredit` not modified:** correct — it only ever spends 1, which cannot fragment, so the #1 fix does not apply there.
- **Type consistency:** `spendCredits` returns `Promise<CreditSpendAllocation[] | null>`; callers pass the allocation array to `refundCredit(userId, allocations)` on failure (wiki/memory/character functions updated accordingly).
- **Import hygiene:** `gte` removed from `creditService.ts` imports in Task 1; no other use exists in that file.

---

Generated from spec `docs/superpowers/specs/2026-07-01-credit-improvements-design.md` (retroactively written after implementation in PR #506).
