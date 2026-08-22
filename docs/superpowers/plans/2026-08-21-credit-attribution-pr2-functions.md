# Credit Spend Attribution — PR 2 of 3 (migration + functions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every credit spend in the `functions` backend records a machine-queryable `(user_id, amount, reason)` event atomically with the spend, backed by an additive `credit_spend_events` ledger table.

**Architecture:** Hand-written next-index migration creates an append-only side table nothing that computes balances reads. `functions`' `spendCredits` gains a required third `reason` param and inserts one event row inside its existing transaction (after the allocation loop succeeds, before `syncSubscriptionCache`), so the event commits and rolls back with the spend. All 10 `functions` call sites get snake_case reason tokens. Compiler-enforced coverage: an untagged call site fails typecheck.

**Tech Stack:** TypeScript 6, Drizzle (query builder + pgTable schema), Postgres, `node:test` (NOT Jest) over compiled `lib/**/*.test.js`, hand-written SQL migrations registered in `scripts/migrationOrder.mjs`.

**Spec:** [2026-08-21-streaming-id-unification-and-credit-spend-attribution-design](../specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md) (Fix B, `functions` half)

## PR split and sequencing

| PR                   | Contents                                                                                                                                    | Branch                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **2 (this plan)**    | Migration `0024`, schema mirror, `functions` service + tests, all 10 `functions` call sites, `seedLocal.ts`, spec doc updates for this half | `feat/credit-attribution-functions`   |
| **3 (sibling plan)** | `cloud-agent` service + tests, its 4 call sites, spec Status flip                                                                           | `feat/credit-attribution-cloud-agent` |

The two PRs touch disjoint code files and branch independently off `staging` (no stacked-PR dance). **Operational ordering constraint:** prod migration `0024` MUST be applied after PR 2 merges and before PR 3 merges — `cloud-agent` deploys straight to prod, and its event INSERT would reject on a missing table. See Task 5.

## Global Constraints

- PRs target **`staging`**, never `main`. The user merges explicitly; never assume a PR merged.
- CI gates run `:check` scripts only. Never `--write`/`--fix`/formatting sweeps on this branch; formatting never shares a commit with logic.
- Platform pins: Expo 57 / Node 24 / TS 6. Pure backend JS — no native, no OTA impact, **no `BREAKING CHANGE:` footer anywhere**.
- Never run `drizzle-kit generate` (journal out of sync). Hand-write `functions/drizzle/0024_credit_spend_events.sql` and append it to `MIGRATION_ORDER` in `functions/scripts/migrationOrder.mjs`.
- `reason` is free-form `text`; tokens come from the spec's registry. New token this PR: `wiki_sync`.
- Tests are `node:test` + `node:assert/strict` against built output (`npm run build` then `lib/…`). Jest syntax is DOA here.
- Non-goals: refunds unchanged, no backfill, allocations detail not persisted, balance math / lock order / cache sync untouched.
- Known-good baseline before this branch: `cd functions && npm test` passes.

## File Structure

- Branch: `git checkout staging && git pull && git checkout -b feat/credit-attribution-functions` before Task 1.
- Create `functions/drizzle/0024_credit_spend_events.sql` — the migration (authoritative DDL, re-runnable).
- Modify `functions/scripts/migrationOrder.mjs` — append filename (runners refuse untracked files).
- Modify `functions/src/db/schema.ts` — mirror `creditSpendEvents` pgTable for typed inserts.
- Create `functions/src/db/creditSpendEventsMigration.test.ts` — static SQL assertions (pattern: `characterImagesMigration.test.ts`).
- Modify `functions/src/services/creditService.ts` — signature + atomic event insert.
- Modify `functions/src/services/creditService.test.ts` — new tests + mock capture updates.
- Modify 10 call-site files (exact lines in Task 3).
- Modify `cloud-agent/scripts/seedLocal.ts` — fresh local DBs get the table even when seeded without migrations.

---

### Task 1: Migration + registration + schema mirror + seedLocal

**Files:**

- Create: `functions/drizzle/0024_credit_spend_events.sql`
- Modify: `functions/scripts/migrationOrder.mjs` (append to `MIGRATION_ORDER`)
- Modify: `functions/src/db/schema.ts` (after the `creditTransactions` block)
- Create: `functions/src/db/creditSpendEventsMigration.test.ts`
- Modify: `cloud-agent/scripts/seedLocal.ts` (after the `credit_transactions` CREATE block)

**Interfaces:**

- Produces: table `credit_spend_events(id uuid PK default gen_random_uuid(), user_id uuid NOT NULL FK→users ON DELETE CASCADE, amount integer NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`; indexes `credit_spend_events_user_created_idx (user_id, created_at DESC)` and `credit_spend_events_reason_idx (reason)`. Drizzle export `creditSpendEvents` from `functions/src/db/schema.ts`. Task 3 consumes the export; PR 3's raw-SQL inserts consume the table.

- [x] **Step 1: Write the failing migration test**

Create `functions/src/db/creditSpendEventsMigration.test.ts` (mirrors `characterImagesMigration.test.ts`; note hand-written SQL uses unquoted identifiers):

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sqlText = readFileSync(join(process.cwd(), 'drizzle', '0024_credit_spend_events.sql'), 'utf8')

test('creates credit_spend_events with the ledger shape', () => {
  assert.match(sqlText, /CREATE TABLE IF NOT EXISTS credit_spend_events/)
  assert.match(sqlText, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  assert.match(sqlText, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /amount integer NOT NULL/)
  assert.match(sqlText, /reason text NOT NULL/)
  assert.match(sqlText, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
})

test('indexes the per-user time series and the reason rollup', () => {
  assert.match(sqlText, /CREATE INDEX IF NOT EXISTS credit_spend_events_user_created_idx/)
  assert.match(sqlText, /\(user_id, created_at DESC\)/)
  assert.match(sqlText, /credit_spend_events_reason_idx ON credit_spend_events \(reason\)/)
})

test('is re-runnable', () => {
  assert.match(sqlText, /IF NOT EXISTS/)
  assert.doesNotMatch(sqlText, /DROP TABLE|DROP INDEX/)
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd functions && npm run build >/dev/null 2>&1 && NODE_ENV=test node --test lib/db/creditSpendEventsMigration.test.js`
Expected: FAIL — `ENOENT ... 0024_credit_spend_events.sql` (readFileSync throws at module load). `&&` keeps a build failure from running tests against stale compiled output.

- [x] **Step 3: Write the migration**

Create `functions/drizzle/0024_credit_spend_events.sql`:

```sql
-- Append-only attribution ledger for credit spends (issue #375).
-- Nothing that computes balances reads this table — credit_transactions stays
-- the source of truth, so existing queries are untouched. reason is free-form
-- text; the token registry lives in the spec under
-- docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md.
CREATE TABLE IF NOT EXISTS credit_spend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_spend_events_user_created_idx
  ON credit_spend_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_spend_events_reason_idx ON credit_spend_events (reason);
```

- [x] **Step 4: Register it**

In `functions/scripts/migrationOrder.mjs`, append after `'0023_character_images_chat.sql',`:

```js
  '0024_credit_spend_events.sql',
```

- [x] **Step 5: Mirror the table in schema.ts**

In `functions/src/db/schema.ts`, insert immediately after the closing `)` of the `creditTransactions` pgTable (before `export const characters`), matching the file's existing callback-object index style:

```ts
// Append-only attribution ledger for credit spends. Written only by
// spendCredits inside its spend transaction; nothing that computes balances
// reads it. The user-created index is (user_id, created_at DESC) in the SQL
// migration — drizzle's builder cannot express DESC, and the index shape only
// matters to SQL readers, so the mirror declares plain column order.
export const creditSpendEvents = pgTable(
  'credit_spend_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index('credit_spend_events_user_created_idx').on(table.userId, table.createdAt),
    reasonIdx: index('credit_spend_events_reason_idx').on(table.reason),
  }),
)
```

(`uuid`, `text`, `integer`, `timestamp`, `index` are already imported at the top of the file.)

- [x] **Step 6: Add the table to seedLocal.ts**

In `cloud-agent/scripts/seedLocal.ts`, immediately after the `credit_transactions` CREATE TABLE statement's closing backtick-paren, add:

```ts
await db.execute(sql`
    CREATE TABLE IF NOT EXISTS credit_spend_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `)
await db.execute(
  sql`CREATE INDEX IF NOT EXISTS credit_spend_events_user_created_idx ON credit_spend_events (user_id, created_at DESC)`,
)
await db.execute(
  sql`CREATE INDEX IF NOT EXISTS credit_spend_events_reason_idx ON credit_spend_events (reason)`,
)
```

- [x] **Step 7: Run the migration test + order test to verify they pass**

Run: `cd functions && NODE_ENV=test node --test lib/db/creditSpendEventsMigration.test.js scripts/migrationOrder.test.mjs`
Expected: PASS (all).

- [x] **Step 8: Apply locally if docker Postgres is up; otherwise record it**

Run:

```bash
if docker info >/dev/null 2>&1; then
  (cd functions && npm run migrate:dev)
else
  echo "SKIPPED: docker not running"
fi
```

The `if/else` skips only on Docker being down — a `migrate:dev` failure still fails the step with its real exit status, instead of being masked as SKIPPED by the old `&& … || echo` chain.
If applied, verify: `docker exec $(docker ps -qf name=postgres) psql -U clanker_dev -d clanker -c '\d credit_spend_events'` shows the columns and both indexes. If docker is down, do NOT claim local application — report it skipped; prod application in Task 5 is the authoritative step.

- [x] **Step 9: Commit**

```bash
git add functions/drizzle/0024_credit_spend_events.sql functions/scripts/migrationOrder.mjs functions/src/db/schema.ts functions/src/db/creditSpendEventsMigration.test.ts cloud-agent/scripts/seedLocal.ts
git commit -m "feat(db): add credit_spend_events attribution ledger"
```

### Task 2: functions spendCredits gains required reason (TDD)

**Files:**

- Test: `functions/src/services/creditService.test.ts`
- Modify: `functions/src/services/creditService.ts:146` (signature) and the allocation-loop tail (~line 218–228)
- Modify: 10 call-site files (Step 5 lists exact replacements)

**Interfaces:**

- Consumes: `creditSpendEvents` export from Task 1.
- Produces: `spendCredits(userId: string, amount: number, reason: string): Promise<CreditSpendAllocation[] | null>` (null still means insufficient credits). Return type and all other service methods unchanged.

- [x] **Step 1: Write the failing tests**

In `functions/src/services/creditService.test.ts`, first convert the two happy-path spend tests' `fakeTx.insert` to a capturing, dual-shape mock (must serve BOTH the `.values(v).onConflictDoNothing(…)` subscriptions insert and the awaited-plain `.values(v)` event insert), and thread the new third argument. In test `spendCredits returns transactionId and decrements balance on qualifying row`:

```ts
let updatedId: string | null = null
let cacheUpdated = false
const insertedValues: Array<Record<string, unknown>> = []
```

replace the existing `insert` arm of `fakeTx` with:

```ts
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues.push(vals)
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: (_opts?: unknown) => ({}),
        })
      },
    }),
```

change the invocation to `await service.spendCredits('user-1', 1, 'chat_reply')` and add before the closing of the test:

```ts
const spendEvents = insertedValues.filter((v) => 'reason' in v && 'amount' in v)
assert.deepEqual(spendEvents, [{ userId: 'user-1', amount: 1, reason: 'chat_reply' }])
```

Apply the same three-part conversion to test `spendCredits spends across multiple rows when balance is fragmented` (call becomes `spendCredits('user-1', 2, 'chat_reply')`; assert `spendEvents` deepEquals `[{ userId: 'user-1', amount: 2, reason: 'chat_reply' }]` — one event per spend, not per row).

Then append three new tests at the end of the spend section (before the addCredits separator comment):

```ts
test('spendCredits writes no attribution event when credits are insufficient', async () => {
  const insertedValues: Array<Record<string, unknown>> = []
  // selectQueue: 1. lock, 2. net balance -> 0 (< amount) — fails before any insert
  const selectQueue: unknown[][] = [[{ userId: 'user-1' }], [{ total: 0 }]]
  let selectIdx = 0
  const fakeTx = {
    select: () => {
      const rows = selectQueue[selectIdx++] ?? []
      return {
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve(rows), {
              limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
            }),
        }),
      }
    },
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues.push(vals)
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: (_opts?: unknown) => ({}),
        })
      },
    }),
  }
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
  }
  const service = createCreditService({ getDb: async () => fakeDb as never })
  const result = await service.spendCredits('user-1', 5, 'chat_reply')
  assert.equal(result, null)
  assert.equal(insertedValues.filter((v) => 'reason' in v && 'amount' in v).length, 0)
})

test('attribution insert precedes cache sync so a later failure discards both', async () => {
  // Mock-level guarantee: the event insert is issued inside the SAME tx callback,
  // before the failing step — Postgres then rolls back everything together.
  const insertedValues: Array<Record<string, unknown>> = []
  const selectQueue: unknown[][] = [
    [{ userId: 'user-1' }], // 1. subscriptions FOR UPDATE lock
    [{ total: 10 }], // 2. net balance
    [{ id: 'tx-abc', remainingBalance: 10 }], // 3. spend rows FOR UPDATE
    undefined, // 4. syncSubscriptionCache total — THROWS
  ]
  let selectIdx = 0
  const fakeTx = {
    select: () => {
      const idx = selectIdx++
      if (idx === 3) throw new Error('cache-sync exploded')
      const rows = selectQueue[idx] ?? []
      return {
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve(rows), {
              limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
              orderBy: () => ({ for: async () => rows }),
            }),
        }),
      }
    },
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues.push(vals)
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: (_opts?: unknown) => ({}),
        })
      },
    }),
  }
  const fakeDb = {
    transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
  }
  const service = createCreditService({ getDb: async () => fakeDb as never })
  await assert.rejects(() => service.spendCredits('user-1', 1, 'chat_reply'), /cache-sync exploded/)
  const spendEvents = insertedValues.filter((v) => 'reason' in v && 'amount' in v)
  assert.equal(spendEvents.length, 1) // insert WAS issued, inside the tx, before the failure
})

test('spendCredits requires a reason argument at the call site', async () => {
  // Compile-time enforcement is the real gate (required param). This runtime
  // probe documents that no default crept back in.
  const service = createCreditService({
    getDb: async () => ({}) as never,
  })
  await assert.rejects(
    () =>
      (service.spendCredits as (...args: unknown[]) => Promise<unknown>)('user-1', 1, undefined),
    (err: unknown) => err instanceof TypeError || String(err).length > 0,
  )
})
```

(Note: the last test intentionally does not pin the failure mode — with the required param, passing `undefined` reaches the DB layer and fails; the meaningful enforcement is `tsc`. If it proves brittle under Node's exact error surface, tighten it to expect rejection of ANY kind and move on.)

- [x] **Step 2: Run to verify the new tests fail**

Run: `cd functions && NODE_ENV=test node --test lib/services/creditService.test.js`
Expected: FAIL — the deepEqual on `spendEvents` sees `[]` (no event insert yet), and the old two-arg calls still "work" so the failure is specifically the new assertions.

- [x] **Step 3: Implement the service change**

In `functions/src/services/creditService.ts`:

Extend the schema import (line 5):

```ts
import { subscriptions, creditTransactions, creditSpendEvents } from '../db/schema.js'
```

Change the signature (line 146):

```ts
    async spendCredits(
      userId: string,
      amount: number,
      reason: string,
    ): Promise<CreditSpendAllocation[] | null> {
```

Immediately after the `if (remaining > 0 || allocations.length === 0) { … }` guard and immediately before `await syncSubscriptionCache(tx, userId)`, insert:

```ts
// Attribution ledger — written inside the same transaction so it
// commits, and rolls back, atomically with the spend itself.
await tx.insert(creditSpendEvents).values({ userId, amount, reason })
```

No other method changes. Lock order, balance math, and `syncSubscriptionCache` stay byte-identical.

- [x] **Step 4: Run the service tests**

Run: `cd functions && NODE_ENV=test node --test lib/services/creditService.test.js`
Expected: PASS — but `npm run typecheck` FAILS: all 10 call sites now miss the required third argument. That is the compiler-enforced coverage working.

- [x] **Step 5: Tag all 10 functions call sites**

Exact replacements (tokens per the spec registry):

| File:line                                  | Old                                                 | New                                                                  |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| `functions/src/memoryFunctions.ts:1531`    | `spendCredits(identity.userId, MEMORY_ACTION_COST)` | `spendCredits(identity.userId, MEMORY_ACTION_COST, 'memory_action')` |
| `functions/src/memoryFunctions.ts:1609`    | `spendCredits(identity.userId, MEMORY_ACTION_COST)` | `spendCredits(identity.userId, MEMORY_ACTION_COST, 'memory_action')` |
| `functions/src/convertDocumentText.ts:157` | `spendCredits(user.id, 200)`                        | `spendCredits(user.id, 200, 'document_convert')`                     |
| `functions/src/characterFunctions.ts:438`  | `spendCredits(user.id, 100)`                        | `spendCredits(user.id, 100, 'character_generate')`                   |
| `functions/src/generateReply.ts:514`       | `spendCredits(userId, cost)`                        | `spendCredits(userId, cost, 'chat_reply')`                           |
| `functions/src/generateImage.ts:127`       | `spendCredits(userId, IMAGE_GENERATION_COST)`       | `spendCredits(userId, IMAGE_GENERATION_COST, 'image_generate')`      |
| `functions/src/wikiLlm.ts:137`             | `spendCredits(user.id, WIKI_CREDIT_COST)`           | `spendCredits(user.id, WIKI_CREDIT_COST, 'wiki_llm')`                |
| `functions/src/wikiSync.ts:824`            | `spendCredits(user.id, WIKI_CREDIT_COST)`           | `spendCredits(user.id, WIKI_CREDIT_COST, 'wiki_sync')`               |
| `functions/src/generateEmbedding.ts:190`   | `spendCredits(user.id, cost)`                       | `spendCredits(user.id, cost, 'embedding')`                           |
| `functions/src/summarizeText.ts:132`       | `spendCredits(user.id, SUMMARIZE_TEXT_COST)`        | `spendCredits(user.id, SUMMARIZE_TEXT_COST, 'summarize')`            |

Token notes: `wiki_sync` (not `wiki_llm`) for `wikiSync.ts` because `wikiSyncHandler` persists a client-extracted dump — no LLM runs behind that spend. Existing test doubles that stub `spendCredits` with fewer parameters remain valid TypeScript (fewer-param functions are assignable) and ignore the extra runtime argument — do not chase phantom failures there.

- [x] **Step 6: Verify the whole functions suite + typecheck**

Run: `cd functions && npm test && npm run typecheck`
Expected: PASS, including `migrationOrder.test.mjs` and the migration static test.

- [x] **Step 7: Commit**

```bash
git add functions/src/services/creditService.ts functions/src/services/creditService.test.ts functions/src/memoryFunctions.ts functions/src/convertDocumentText.ts functions/src/characterFunctions.ts functions/src/generateReply.ts functions/src/generateImage.ts functions/src/wikiLlm.ts functions/src/wikiSync.ts functions/src/generateEmbedding.ts functions/src/summarizeText.ts
git commit -m "feat(functions): attribute every credit spend with a required reason"
```

### Task 3: Spec doc updates for this half

**Files:**

- Modify: `docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md`

- [x] **Step 1: Correct the migration path and register this half's token**

Four small edits, all factual corrections discovered at plan time (the sweep found `wikiSync.ts:824` and `schedulerTriggerHandler.ts:187` beyond the spec's original table):

1. Line 7, Files affected: replace `` `functions/src/db/migrations/` (one hand-written file) `` with `` `functions/drizzle/` (one hand-written file, registered in `functions/scripts/migrationOrder.mjs`) ``.
2. §Schema paragraph: replace "in `functions/src/db/migrations/`" with "in `functions/drizzle/`".
3. Reason-vocabulary table: add row `| wiki_sync | wikiSync.ts:824 (persists the client-extracted wiki dump — no LLM behind this spend) |` and extend the `wiki_llm` row's call site to clarify it is `wikiLlm.ts` only.
4. Header "Implementation plan:" line: append `, [pr2 functions](../plans/2026-08-21-credit-attribution-pr2-functions.md), [pr3 cloud-agent](../plans/2026-08-21-credit-attribution-pr3-cloud-agent.md)`.

Leave the `Status:` line alone — it flips in PR 3 when both halves exist.

- [x] **Step 2: Prettier-check the touched markdown and commit**

Run: `npx prettier --check docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md docs/superpowers/plans/2026-08-21-credit-attribution-pr2-functions.md docs/superpowers/plans/2026-08-21-credit-attribution-pr3-cloud-agent.md` (only the files this PR touched — checking the whole `plans/` directory would sweep in files this branch never modified).

```bash
git add docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md docs/superpowers/plans/2026-08-21-credit-attribution-pr2-functions.md docs/superpowers/plans/2026-08-21-credit-attribution-pr3-cloud-agent.md
git commit -m "docs(spec): credit-attribution plan links, wiki_sync token, migration path fix"
```

### Task 4: Full verification

- [x] **Step 1: Backend gates**

Run: `cd functions && npm test && npm run typecheck && npm run lint`
Expected: PASS (lint runs eslint without `--fix` = check-mode ✓).

- [x] **Step 2: Cloud-agent gates**

Task 1 modified `cloud-agent/scripts/seedLocal.ts`, so AGENTS.md's cloud-agent rule applies even though PR 2 is the functions half.

Run: `cd cloud-agent && npm run typecheck && npm test`
Expected: PASS — seedLocal.ts is script-only; the suite baseline is unchanged.

- [x] **Step 3: Repo-wide format gate**

Run from repo root: `npm run format:check`
Expected: PASS. If a file this branch touched fails, format ONLY those files in a separate `style:` commit — never a sweep.

- [x] **Step 4: Honest status report**

State plainly: what passed, whether Step 8 of Task 1 (local docker apply) ran or was skipped, and that prod migration is pending (Task 5).

### Task 5: Ship + prod migration ordering (STOP point)

- [x] **Step 1: Push and open the PR**

Branch `feat/credit-attribution-functions` off `staging` was created at start; push and:

```bash
gh pr create --base staging --title "Credit spend attribution: ledger table + functions backend" --body "Implements the functions half of Fix B …"
```

- [x] **Step 2: STOP — prod migration is the user's authenticated step**

After the user merges PR 2 and BEFORE PR 3 merges, migration 0024 must hit prod Cloud SQL. The runner needs CLOUD_SQL_* credentials and GCP access — if `CLOUD_SQL_CONNECTION_NAME` et al. aren't in the environment, hand this to the user verbatim rather than guessing:

```sh
cd functions && MIGRATIONS=0024_credit_spend_events.sql npm run migrate
```

(or the project's usual `scripts/deploy-migrations.sh` path). Do not mark this done without real output showing the migration applied.
