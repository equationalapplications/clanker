# Proactive Sweep Per-Statement DB Deadlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the proactive sweep's `claim` and `loadContext` (and a default for the other DB ops) with transaction-scoped `statement_timeout` deadlines so one hung statement aborts while the sweep still finishes its batch, with unit and integration regression tests proving it.

**Architecture:** A `withStatementTimeout(db, deadlineMs, fn)` helper wraps each op's queries in a transaction that first runs `set_config('statement_timeout', ms, is_local => true)`. `is_local = true` reverts the setting at COMMIT/ROLLBACK, so the deadline never leaks onto the shared `getDb()` pool. Postgres cancels the offending statement server-side (SQLSTATE `57014`) and the connection stays usable.

The six sweep ops fall into two groups by WHERE the per-row try/catch sits:

- `claim` and `loadContext` run INSIDE the per-row loop's try/catch — their 57014 lands in the per-row catch and strands the row (claimed, NULL `resolved_at`) for the reaper, exactly as the prior dead-letter behaviour.
- `selectDue`, `reapStaleClaims`, and `deleteExpired` run OUTSIDE that loop (selectDue at the top of the sweep, the other two as the sweep's tail). They are still wrapped in `withStatementTimeout` with `SWEEP_STATEMENT_DEFAULT_MS`, so a hung statement is cancelled server-side, but their 57014 propagates to whatever wraps the sweep body — NOT into the per-row catch. That is intentional: the tail statements have no row to strand, and the per-sweep try/catch in `proactiveWakeupSweep.ts` is what bounds them. Stranding semantics are unchanged; only the window shrinks.

**Tech Stack:** TypeScript, drizzle-orm (`node-postgres` driver, already a dependency), node:test for both unit and integration suites (this is the `functions` package convention — Jest syntax is DOA here).

**Spec:** `docs/superpowers/specs/2026-09-09-proactive-sweep-statement-deadlines-design.md`

## Global Constraints

- Node 24 / Expo 57 / TypeScript pinned (see `package.json`); TS 7 is excluded. Never run `npm audit fix` or add dependencies.
- `functions` tests are node:test: `npm test` in `functions/` builds then runs `node --test` over `lib/**/*.test.js`. Run scoped: `NODE_ENV=test npm run build && node --test --test-reporter spec lib/proactiveWakeupSweep.test.js`.
- Integration tests hit real Postgres 18 (`clanker_test` DB) via `functions/src/integration/helpers/db.ts`; local Docker Postgres must be running.
- Code style: no semicolons, prettier-enforced. CI uses `:check` gates — never `--write`/`--fix`.
- PRs target `staging`, never `main`.
- Non-goals from the spec (do not touch): pool-wide `statement_timeout: 10_000` in `db/cloudSql.ts`, `WAKEUP_POST_TIMEOUT_MS`, `SWEEP_RESERVE_MS`, `SWEEP_TIME_BUDGET_MS`, `reapStaleClaims`' 1h window, the connector.
- The pool-wide timeout (`functions/src/db/cloudSql.ts:86`) stays the backstop; the new constants must all be far below 10_000.

## File Structure

- Modify `functions/src/services/proactiveWakeupGuardrails.ts` — three new per-op deadline constants (pure values, documented), plus one sentence updated in the `SWEEP_RESERVE_MS` doc comment.
- Modify `functions/src/proactiveWakeupSweep.ts` — new exported `withStatementTimeout` helper; the six ops in `buildSweepDeps` rewire their queries onto the transaction it hands back.
- Modify `functions/src/proactiveWakeupSweep.test.ts` — unit tests: helper mechanics, per-op wiring, deadline-fires behavior.
- Modify `functions/src/integration/proactiveWakeupSweep.int.test.ts` — real-Postgres tests parking statements on locks so the per-op deadline (not the pool backstop) demonstrably fires.

---

### Task 1: Deadline constants + `withStatementTimeout` helper

**Files:**

- Modify: `functions/src/services/proactiveWakeupGuardrails.ts` (add constants after `SWEEP_RESERVE_MS`, around line 73)
- Modify: `functions/src/proactiveWakeupSweep.ts` (add helper after the `DbLike` type, around line 27)
- Test: `functions/src/proactiveWakeupSweep.test.ts`

**Interfaces:**

- Consumes: nothing new (drizzle `sql` and `DbLike` already in `proactiveWakeupSweep.ts`).
- Produces: `CLAIM_DEADLINE_MS = 500`, `LOAD_CONTEXT_DEADLINE_MS = 1_500`, `SWEEP_STATEMENT_DEFAULT_MS = 2_000` (exported from `services/proactiveWakeupGuardrails.ts`); `export async function withStatementTimeout<T>(db: DbLike, deadlineMs: number, fn: (tx: DbLike) => Promise<T>): Promise<T>` in `proactiveWakeupSweep.ts`. Task 2 wires these into `buildSweepDeps`.

- [ ] **Step 1: Write the failing test**

Add to `functions/src/proactiveWakeupSweep.test.ts`. Update the import at the top of the file and append the new test:

```ts
import {
  buildSweepDeps,
  proactiveWakeupSweep,
  proactiveWakeupSweepHandler,
  withStatementTimeout,
} from './proactiveWakeupSweep.js'
```

```ts
// The set_config bind params and literal text live in the drizzle sql
// template's queryChunks: string literals arrive as StringChunk objects
// (value is a string[]), bound values as Param objects (value is a scalar).
// Verified against drizzle-orm 0.45's sql/sql.cjs. Keeping only scalar values
// yields the bind params in order; joining the string[] values yields the
// literal SQL around them (placeholders like $1 are substituted only at
// compile time, so they do NOT appear in the joined text). Shared by every
// fake in this file.
function chunksOf(query: unknown): Array<Record<string, unknown>> {
  return (query as { queryChunks?: Array<Record<string, unknown>> }).queryChunks ?? []
}

function paramsOf(query: unknown): unknown[] {
  return chunksOf(query).flatMap((c) =>
    c && typeof c === 'object' && 'value' in c && !Array.isArray(c.value) ? [c.value] : [],
  )
}

function sqlTextOf(query: unknown): string {
  return chunksOf(query)
    .flatMap((c) => (Array.isArray(c.value) ? (c.value as string[]) : []))
    .join('')
}

test('withStatementTimeout sets a transaction-local deadline and runs fn on the tx', async () => {
  const executed: Array<{ text: string; params: unknown[] }> = []
  const fakeTx = {
    execute: async (q: unknown) => {
      executed.push({ text: sqlTextOf(q), params: paramsOf(q) })
      return { rows: [] }
    },
  }
  const fakeDb = {
    transaction: async (cb: (tx: typeof fakeTx) => Promise<string>) => cb(fakeTx),
  } as unknown as Parameters<typeof withStatementTimeout>[0]

  const result = await withStatementTimeout(fakeDb, 500, async (tx) => {
    assert.equal(tx, fakeTx, 'fn must receive the transaction, not the pool')
    return 'ran'
  })

  assert.equal(result, 'ran')
  assert.equal(executed.length, 1)
  // Exactly one bind param: the deadline string. `is_local` is NOT a bind
  // param — it is literal SQL text (part of a StringChunk), which is why the
  // assertion below pins it on the joined text, not on params. The `true` is
  // the whole point: without it the deadline would leak past COMMIT onto the
  // shared pool and silently throttle every other consumer.
  assert.deepEqual(executed[0].params, ['500'])
  assert.match(executed[0].text, /set_config\('statement_timeout'/)
  assert.match(executed[0].text, /,\s*true\)\s*$/, 'is_local must be the literal true')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && NODE_ENV=test npm run build 2>&1 | tail -5`
Expected: FAIL — build error because `withStatementTimeout` is not exported from `proactiveWakeupSweep.ts`.

- [ ] **Step 3: Add the constants**

In `functions/src/services/proactiveWakeupGuardrails.ts`, insert after the `SWEEP_RESERVE_MS` constant (line 73) and before `STALE_CLAIM_TIMEOUT_MS`:

```ts
/**
 * Per-operation DB deadlines for the sweep, composing with the wall-clock
 * budgets above: the pool-wide statement_timeout (10s, db/cloudSql.ts) bounds
 * any single statement, but a sweep claim + loadContext run five statements
 * between the budget check and the POST, so a pathological hang could eat ~50s
 * of a 45s loop budget before the pool backstop fired. These per-op deadlines
 * abort the hang while the sweep still has room to log, continue, and finish
 * the rest of the batch. Applied via withStatementTimeout in
 * proactiveWakeupSweep.ts, which scopes them to the op's own transaction.
 */

/** `claim` — one UPDATE on an indexed row; normal completion is tens of ms. */
export const CLAIM_DEADLINE_MS = 500

/**
 * `loadContext` — applied PER-STATEMENT, not per-call. All five SELECTs run
 * inside one transaction, but Postgres' default READ COMMITTED isolation
 * gives each its own statement snapshot, not one snapshot for the whole
 * transaction — so the spend/count rows can shift between the first and last
 * read. What the transaction DOES give them is atomicity: if a deadline
 * cancels a later SELECT, the rolled-back transaction leaves the database
 * untouched. The wall-clock budget for the worst case is 5 × 1500ms =
 * 7500ms, which `SWEEP_RESERVE_MS` (derived below) already covers.
 */
export const LOAD_CONTEXT_DEADLINE_MS = 1_500

/** Every other sweep statement: selectDue, resolveWakeup, reapStaleClaims, deleteExpired. */
export const SWEEP_STATEMENT_DEFAULT_MS = 2_000
```

Also update one sentence in the `SWEEP_RESERVE_MS` doc comment (currently lines 68-71). Change:

```text
 * Pathological hangs in claim/loadContext are bounded by the
 * pool-wide statement_timeout in db/cloudSql.ts, not by this reserve: a hung
 * statement aborts, the row throws into the per-row catch, and the sweep
 * survives instead of being killed mid-POST.
```

to:

```text
 * Pathological hangs in claim/loadContext are bounded by the
 * per-op statement deadlines below (via withStatementTimeout), not by this
 * reserve: a hung statement aborts, the row throws into the per-row catch, and
 * the sweep survives instead of being killed mid-POST.
```

- [ ] **Step 4: Add the helper**

In `functions/src/proactiveWakeupSweep.ts`, extend the guardrails import (line 9's import block) to include the three constants:

```ts
import {
  CLAIM_DEADLINE_MS,
  LOAD_CONTEXT_DEADLINE_MS,
  SWEEP_STATEMENT_DEFAULT_MS,
  STALE_CLAIM_TIMEOUT_MS,
  SWEEP_BATCH_LIMIT,
  SWEEP_RESERVE_MS,
  SWEEP_TIME_BUDGET_MS,
  UNREAD_STALENESS_ESCAPE_MS,
  WAKEUP_POST_TIMEOUT_MS,
} from './services/proactiveWakeupGuardrails.js'
```

(Keep whatever names the existing import already pulls — just add the three new ones; the list above is the expected full set.)

Then add after the `type DbLike = ...` line (line 27):

```ts
/**
 * Runs fn on a transaction whose statement_timeout is set to deadlineMs via
 * set_config(..., is_local => true), so it reverts at COMMIT/ROLLBACK and no
 * other user of the shared pool ever sees it. set_config rather than SET LOCAL
 * because Postgres rejects bind parameters on bare SET (utility statements
 * take no placeholders) and the drizzle-parameterized form must go through a
 * function call. Postgres cancels an over-deadline statement server-side
 * (SQLSTATE 57014) and the connection returns to the pool usable — which a
 * client-side Promise.race timer cannot do: a raced timeout throws into the
 * per-row catch but leaves the server query running and the connection busy
 * until the pool-wide 10s frees it.
 */
export async function withStatementTimeout<T>(
  db: DbLike,
  deadlineMs: number,
  fn: (tx: DbLike) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', ${String(deadlineMs)}, true)`)
    return fn(tx as unknown as DbLike)
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd functions && NODE_ENV=test npm run build && node --test --test-reporter spec lib/proactiveWakeupSweep.test.js`
Expected: PASS — all tests including the new one.

- [ ] **Step 6: Commit**

```bash
git add functions/src/services/proactiveWakeupGuardrails.ts functions/src/proactiveWakeupSweep.ts functions/src/proactiveWakeupSweep.test.ts
git commit -m "feat(proactive): add per-op statement deadline constants and withStatementTimeout helper"
```

---

### Task 2: Wire the six sweep ops through `withStatementTimeout`

**Files:**

- Modify: `functions/src/proactiveWakeupSweep.ts:186-368` (`buildSweepDeps`)
- Test: `functions/src/proactiveWakeupSweep.test.ts`

**Interfaces:**

- Consumes: `withStatementTimeout` and the three constants from Task 1.
- Produces: no signature change — `buildSweepDeps` still returns the same `SweepDeps`; only the internals gain transactions. The wiring order the Task 3 unit test pins: `selectDue` → `claim` → `loadContext` → (`resolveWakeup` only on skip) → `reapStaleClaims` → `deleteExpired`.

- [ ] **Step 1: Write the failing test**

Add to `functions/src/proactiveWakeupSweep.test.ts` (the fake factory below is also used by Task 3):

```ts
// One row object whose fields satisfy every shape loadContext destructures:
// balance 1000 (passes the power check against turnCost 100), zero spend,
// zero counts, and a valid Date so the Invalid-Date guard does not fire.
const MAGIC_ROW = {
  currentCredits: 1000,
  total: 0,
  count: 0,
  lastAt: new Date('2026-09-01T00:00:00.000Z'),
}

// A drizzle-builder-shaped chainable: every method returns itself, awaiting
// resolves to [MAGIC_ROW] for selects or an array with rowCount 1 for
// update/delete (claim reads rowCount, reap/delete read .length). With
// failDeadline set, a select whose transaction's set_config deadline matches
// rejects with a 57014-shaped error — the server-side cancellation the real
// deadline produces.
function makeFakeDb(setConfigCalls: unknown[][], failDeadline: string | null = null, dueRows = 1) {
  let selects = 0
  const makeChain = (kind: string, rejects: boolean): unknown => {
    const step: any = new Proxy(function () {} as never, {
      get(_t, prop) {
        if (prop === 'then') {
          if (rejects) {
            const err = new Error('canceling statement due to statement timeout') as Error & {
              code?: string
            }
            err.code = '57014'
            return (_resolve: unknown, reject: (e: unknown) => void) => reject(err)
          }
          // The first select of the sweep is always selectDue; hand back as
          // many due rows as the test asked for. Every later select is one of
          // loadContext's five reads — one MAGIC_ROW each.
          const resolveValue =
            kind === 'select'
              ? (selects++,
                selects === 1 ? Array.from({ length: dueRows }, () => MAGIC_ROW) : [MAGIC_ROW])
              : Object.assign([], { rowCount: 1 })
          return (resolve: (v: unknown) => void) => Promise.resolve(resolveValue).then(resolve)
        }
        return () => step
      },
      apply() {
        return step
      },
    })
    return step
  }
  return {
    transaction: async (cb: (tx: never) => Promise<unknown>) => {
      const tx: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'execute') {
              return async (q: unknown) => {
                setConfigCalls.push(paramsOf(q))
                return { rows: [] }
              }
            }
            return () =>
              makeChain(prop, prop === 'select' && setConfigCalls.at(-1)?.[0] === failDeadline)
          },
        },
      )
      return cb(tx as never)
    },
  } as unknown as FakeDb
}

// buildSweepDeps's dbFactory param is optional, so a bare Parameters<>[0] is a
// union with undefined; strip it before awaiting the return type.
type SweepDbFactory = NonNullable<Parameters<typeof buildSweepDeps>[0]>
type FakeDb = Awaited<ReturnType<SweepDbFactory>>

function makeFakeDbFactory(
  setConfigCalls: unknown[][],
  opts: { failDeadline?: string; dueRows?: number } = {},
) {
  const db = makeFakeDb(setConfigCalls, opts.failDeadline ?? null, opts.dueRows ?? 1)
  return async () => db
}

test('wraps every DB op in a transaction whose set_config carries the op deadline, is_local true', async () => {
  const setConfigCalls: unknown[][] = []
  const savedUrl = process.env.CLOUD_AGENT_URL
  delete process.env.CLOUD_AGENT_URL // postWakeup must fail fast, never fetch
  try {
    await proactiveWakeupSweepHandler(buildSweepDeps(makeFakeDbFactory(setConfigCalls)))
  } finally {
    if (savedUrl !== undefined) process.env.CLOUD_AGENT_URL = savedUrl
  }

  // Handler order for one due row that passes the guardrails, whose POST then
  // throws on the missing env (swallowed by the per-row catch):
  //   selectDue 2000, claim 500, loadContext 1500, then the reap/delete tail.
  // resolveWakeup never runs — no skip decision happened.
  assert.deepEqual(
    setConfigCalls.map((params) => params[0]),
    ['2000', '500', '1500', '2000', '2000'],
  )
  // is_local is literal SQL text, not a bind param, so it is not in params —
  // the Task 1 helper test pins it via sqlTextOf. Here the bind-param count
  // pins the other half of the wiring: exactly one param per set_config.
  for (const params of setConfigCalls) {
    assert.equal(params.length, 1, 'set_config must bind only the deadline value')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && NODE_ENV=test npm run build && node --test --test-reporter spec lib/proactiveWakeupSweep.test.js`
Expected: FAIL — the new test fails because the ops are not wrapped yet: they call query methods the plain fake-db object does not have, so the handler throws before any set_config is recorded, and `setConfigCalls` never matches the expected sequence. That red is the expected one.

- [ ] **Step 3: Rewire the ops**

In `buildSweepDeps` (`functions/src/proactiveWakeupSweep.ts:186`), wrap each op. The pattern for every op: fetch `db` as today, then `return withStatementTimeout(db, <DEADLINE>, async (tx) => { ...existing body with db replaced by tx... })`.

`selectDue` (line 189) and `reapStaleClaims` (line 341), `resolveWakeup` (line 334), `deleteExpired` (line 360) use `SWEEP_STATEMENT_DEFAULT_MS`; `claim` (line 302) uses `CLAIM_DEADLINE_MS`; `loadContext` (line 208) uses `LOAD_CONTEXT_DEADLINE_MS`.

`selectDue`, rewritten:

```ts
    async selectDue(limit: number): Promise<DueWakeup[]> {
      const db = await dbFactory()
      return withStatementTimeout(db, SWEEP_STATEMENT_DEFAULT_MS, async (tx) =>
        tx
          .select({
            id: scheduledWakeups.id,
            characterId: scheduledWakeups.characterId,
            userId: scheduledWakeups.userId,
            firebaseUid: users.firebaseUid,
            reason: scheduledWakeups.reason,
            runKey: scheduledWakeups.runKey,
            priority: scheduledWakeups.priority,
          })
          .from(scheduledWakeups)
          .innerJoin(users, eq(scheduledWakeups.userId, users.id))
          .where(and(eq(scheduledWakeups.status, 'pending'), sql`${scheduledWakeups.dueAt} <= now()`))
          .orderBy(desc(scheduledWakeups.priority), scheduledWakeups.dueAt)
          .limit(limit),
      )
    },
```

`loadContext`: replace `const db = await dbFactory()` with the same two lines, then indent the entire existing body (all five SELECTs and the Invalid-Date guard and the return) into `return withStatementTimeout(db, LOAD_CONTEXT_DEADLINE_MS, async (tx) => { ...existing body with every `db.select`changed to`tx.select`... })`. The five `db.select(` occurrences (lines 211, 217, 234, 246, 277) become `tx.select(`. Nothing else in the body changes.

`claim`, rewritten:

```ts
    async claim(id: string, claimedAt: Date): Promise<boolean> {
      const db = await dbFactory()
      return withStatementTimeout(db, CLAIM_DEADLINE_MS, async (tx) => {
        // AND status = 'pending' is the race-safety guard: two overlapping sweeps
        // both SELECT the same row, but only the first UPDATE matches a row still
        // in 'pending' status. The second returns rowCount = 0 and we skip.
        const result = await tx
          .update(scheduledWakeups)
          .set({ status: 'claimed', claimedAt })
          .where(and(eq(scheduledWakeups.id, id), eq(scheduledWakeups.status, 'pending')))
        return result.rowCount === 1
      })
    },
```

`resolveWakeup`, rewritten:

```ts
    async resolveWakeup(id, patch): Promise<void> {
      const db = await dbFactory()
      await withStatementTimeout(db, SWEEP_STATEMENT_DEFAULT_MS, async (tx) =>
        tx
          .update(scheduledWakeups)
          .set({ status: patch.status, outcome: patch.outcome, resolvedAt: new Date() })
          .where(eq(scheduledWakeups.id, id)),
      )
    },
```

`reapStaleClaims`, rewritten (keep the existing comment block above the query):

```ts
    async reapStaleClaims(claimedBefore: Date): Promise<number> {
      const db = await dbFactory()
      return withStatementTimeout(db, SWEEP_STATEMENT_DEFAULT_MS, async (tx) => {
        // spent_amount is left as-is rather than zeroed: if the turn did commit a
        // spend before dying, that money was really taken and the day's ceiling
        // should keep counting it. The status becomes terminal so the row stops
        // being invisible to both selectDue and deleteExpired.
        const reaped = await tx
          .update(scheduledWakeups)
          .set({ status: 'skipped', outcome: 'stale_claim', resolvedAt: new Date() })
          .where(
            and(
              sql`${scheduledWakeups.status} in ('claimed','running')`,
              sql`${scheduledWakeups.resolvedAt} is null`,
              lt(scheduledWakeups.claimedAt, claimedBefore),
            ),
          )
          .returning({ id: scheduledWakeups.id })
        return reaped.length
      })
    },
```

`deleteExpired`, rewritten:

```ts
    async deleteExpired(cutoff: Date): Promise<number> {
      const db = await dbFactory()
      return withStatementTimeout(db, SWEEP_STATEMENT_DEFAULT_MS, async (tx) => {
        const deleted = await tx
          .delete(scheduledWakeups)
          .where(lt(scheduledWakeups.resolvedAt, cutoff))
          .returning({ id: scheduledWakeups.id })
        return deleted.length
      })
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && NODE_ENV=test npm run build && node --test --test-reporter spec lib/proactiveWakeupSweep.test.js`
Expected: PASS — the new wiring test and every pre-existing test. If any pre-existing test regressed, the rewiring broke something; fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/proactiveWakeupSweep.ts functions/src/proactiveWakeupSweep.test.ts
git commit -m "feat(proactive): bound sweep DB ops with per-op statement deadlines"
```

---

### Task 3: Unit regression test — deadline firing leaves the row claimed, not skipped

**Files:**

- Test: `functions/src/proactiveWakeupSweep.test.ts`

**Interfaces:**

- Consumes: `makeFakeDbFactory` with its `failDeadline` argument (Task 2), `proactiveWakeupSweepHandler`, `buildSweepDeps`.
- Produces: nothing — this is the AC3 behavior regression test. A 57014 surfacing from `loadContext` must strand the row (claimed, NULL resolved_at, reaper's job) exactly as the spec's stranding-semantics section requires, while the sweep survives and runs its tail.

- [ ] **Step 1: Write the test**

Append to `functions/src/proactiveWakeupSweep.test.ts`:

```ts
test('a 57014 from loadContext leaves rows claimed — not skipped — and the sweep finishes its tail', async () => {
  const setConfigCalls: unknown[][] = []
  const savedUrl = process.env.CLOUD_AGENT_URL
  delete process.env.CLOUD_AGENT_URL
  try {
    await proactiveWakeupSweepHandler(
      buildSweepDeps(makeFakeDbFactory(setConfigCalls, { failDeadline: '1500', dueRows: 2 })),
    )
  } finally {
    if (savedUrl !== undefined) process.env.CLOUD_AGENT_URL = savedUrl
  }

  // Two rows selected (the fake's first select returns two). Each row is
  // claimed (500 passes) then killed at loadContext (1500 rejects). The
  // decisive assertion is what is ABSENT: no resolveWakeup transaction —
  // the rows must sit claimed with NULL resolved_at for the reaper, not be
  // marked terminally skipped — and the reap/delete tail still ran.
  assert.deepEqual(
    setConfigCalls.map((params) => params[0]),
    ['2000', '500', '1500', '500', '1500', '2000', '2000'],
  )
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd functions && NODE_ENV=test npm run build && node --test --test-reporter spec lib/proactiveWakeupSweep.test.js`
Expected: PASS. This is a characterization test of behavior that falls out of Task 1+2 (the rejection simply propagates through the transaction into the existing per-row catch) — it guards against regressions, e.g. someone later "handling" the cancellation by resolving the row as skipped. If it fails, a wiring regression exists; fix Tasks 1-2, do not adjust this test's expectations.

- [ ] **Step 3: Commit**

```bash
git add functions/src/proactiveWakeupSweep.test.ts
git commit -m "test(proactive): pin deadline-firing stranding semantics (claimed, not skipped)"
```

---

### Task 4: Integration tests — real Postgres, lock-parked statements prove the per-op deadline fires

**Files:**

- Test: `functions/src/integration/proactiveWakeupSweep.int.test.ts`

**Interfaces:**

- Consumes: existing harness (`testGetDb`, `insertWakeup`, `dueRowFor`, `getPool`, `waitForBlockedBackends`, `NOW`, `DAY_START`).
- Produces: nothing — AC3's real-Postgres half.

**Design note — lock blocking, not pg_sleep injection.** The spec sketched injecting `pg_sleep` via a test-only dbFactory wrapper. That interception is not reliably possible at the `tx` seam: drizzle query builders capture the transaction's `session` at construction (`pg-core/query-builders/select.cjs` — `this.session = config.session`), and transactions pin a dedicated client via `pool.connect()` (`node-postgres/session.cjs:215-217`), so builder queries never pass through `tx.execute` — only the `set_config` statement does. A Proxy on `tx.execute` would intercept nothing the ops run. Instead these tests park a statement on a **lock** held by a second session: `statement_timeout` measures the whole statement duration _including lock waits_, so the parked statement is canceled at the per-op deadline (500ms/1500ms) — far below the pool's 10s backstop, so the per-op deadline is demonstrably what fires. This reuses the suite's own proven pattern: `waitForBlockedBackends` exists in this file for exactly this kind of forced interleave.

- [ ] **Step 1: Prerequisite — local Postgres running**

Run: `docker ps --format '{{.Names}} {{.Ports}}' | grep -i postgres`
Expected: a Postgres container published on 5432. If none, start the project's local DB (see `functions/src/integration/helpers/db.ts` for the expected URL/DB name `clanker_test`) — `ensureIntegrationDatabase()` creates the schema itself.

- [ ] **Step 2: Add the blocking-session helper and error validator**

Add after the `waitForBlockedBackends` helper in `functions/src/integration/proactiveWakeupSweep.int.test.ts` (no new imports needed — the file already imports `pg`, `assert`, and the harness helpers):

```ts
// drizzle may hand back the pg error as-is or wrapped in its own error type
// (cause chain); walk it either way.
function expectQueryCanceled(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 5 && cur; depth++) {
    const e = cur as { code?: string; cause?: unknown }
    if (e.code === '57014') return true
    cur = e.cause
  }
  assert.fail(`expected a 57014 query_canceled error, got ${String(err)}`)
}

/**
 * Runs fn inside a transaction on a dedicated pooled client, so the test can
 * take locks that park the sweep's statements. Always rolls back — the locks
 * exist only to block, never to leave state behind.
 */
async function withBlockingSession(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}
```

- [ ] **Step 3: Add the two tests**

Append at the end of the file (after the existing suites):

```ts
// --- per-op statement deadlines (AC3) -----------------------------------------

// The claim UPDATE parks on a row lock held by another session.
// statement_timeout counts lock-wait time, so the parked UPDATE is canceled
// at CLAIM_DEADLINE_MS (500ms) — far below the pool's 10s backstop, proving
// the per-op deadline is what fired.
test('claim aborts with 57014 when its UPDATE exceeds CLAIM_DEADLINE_MS', async () => {
  const id = await insertWakeup()
  await withBlockingSession(async (lockHolder) => {
    await lockHolder.query('SELECT id FROM scheduled_wakeups WHERE id = $1 FOR UPDATE', [id])
    const deps = buildSweepDeps(testGetDb)
    const claimPromise = deps.claim(id, new Date())
    // Both sides are now inside the contended window; the deadline fires
    // mid-wait without any release, because statement_timeout covers it.
    await waitForBlockedBackends(1)
    await assert.rejects(claimPromise, expectQueryCanceled)
  })
  // Canceled mid-UPDATE and rolled back: the row is untouched, still pending
  // for the next tick — not claimed, not skipped.
  const { rows } = await getPool().query(
    'SELECT status, resolved_at FROM scheduled_wakeups WHERE id = $1',
    [id],
  )
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].resolved_at, null)
})

// loadContext's fourth read (the unread count over `messages`) parks on an
// ACCESS EXCLUSIVE table lock — MVCC reads do not block on row locks, so a
// table lock is what parks a SELECT. The row is claimed first the ordinary
// way: exactly the state the sweep is in when loadContext hangs.
test('loadContext aborts with 57014 when a read exceeds LOAD_CONTEXT_DEADLINE_MS', async () => {
  const id = await insertWakeup()
  await getPool().query(
    "UPDATE scheduled_wakeups SET status = 'claimed', claimed_at = now() WHERE id = $1",
    [id],
  )
  await withBlockingSession(async (lockHolder) => {
    await lockHolder.query('LOCK TABLE messages IN ACCESS EXCLUSIVE MODE')
    const deps = buildSweepDeps(testGetDb)
    const ctxPromise = deps.loadContext(dueRowFor(id), NOW, DAY_START)
    await waitForBlockedBackends(1)
    await assert.rejects(ctxPromise, expectQueryCanceled)
  })
  // Not resolved as skipped by anything: still claimed with a NULL
  // resolved_at, recovering via reapStaleClaims per the spec's stranding
  // semantics. The deadlines shrink how often the reaper is needed; they do
  // not replace it.
  const { rows } = await getPool().query(
    'SELECT status, resolved_at FROM scheduled_wakeups WHERE id = $1',
    [id],
  )
  assert.equal(rows[0].status, 'claimed')
  assert.equal(rows[0].resolved_at, null)
})
```

- [ ] **Step 4: Run the integration suite**

Run: `cd functions && NODE_ENV=test npm run build && node --test --test-reporter spec lib/integration/proactiveWakeupSweep.int.test.js`
Expected: PASS — the two new tests take ~0.5s (claim) and ~1.5s (loadContext) of lock-wait before their deadlines cancel the parked statements, plus all pre-existing tests. If a pre-existing test fails, the transactions changed some observable the suite relied on (e.g. isolation level visibility); investigate — do not loosen the existing tests.

- [ ] **Step 5: Full package verification**

Run: `cd functions && npm test`
Expected: PASS — the whole functions suite, including both new/updated files.

Run: `cd functions && npm run typecheck`
Expected: no errors.

Run: `cd functions && npm run lint`
Expected: no errors.

Run: `npx prettier --check functions/src/proactiveWakeupSweep.ts functions/src/proactiveWakeupSweep.test.ts functions/src/services/proactiveWakeupGuardrails.ts functions/src/integration/proactiveWakeupSweep.int.test.ts`
Expected: clean. (If it flags files, format them in a formatting-only commit — never mixed with logic, per the CI-isolation rule.)

- [ ] **Step 6: Commit**

```bash
git add functions/src/integration/proactiveWakeupSweep.int.test.ts
git commit -m "test(proactive): integration-verify per-op statement deadlines cancel lock-parked statements"
```

---

## Spec coverage map

- Mechanism (`set_config` + `is_local`): Task 1 helper; `is_local` pinned by Task 1 Step 1 and Task 2 Step 1 assertions.
- Per-op deadlines table (500 / 1500 / 2000): Task 1 constants, Task 2 wiring, Task 2 Step 1 sequence assertion.
- Error handling / stranding semantics unchanged: Task 3 unit, Task 4 both tests' row-state assertions.
- Testing item 1 (wiring-level AC3): Task 2 Step 1.
- Testing item 2 (57014-style rejection, row left claimed, batch + tail continue): Task 3.
- Testing item 3 (real Postgres, forced per-statement slowness, 57014, row not skipped): Task 4 — via lock parking rather than the spec's sketched pg_sleep injection (see Task 4's design note for why interception at the tx seam cannot work in drizzle 0.45).
- AC4 (guardrails documentation): Task 1 Step 3's constants doc block.
- Handler-level "later rows still process" under a real deadline: Task 3 (two rows, both attempted after the first fails).
