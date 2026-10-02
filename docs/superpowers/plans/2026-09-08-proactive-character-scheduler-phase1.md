# Proactive Character Scheduler — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a character schedule its own future wake-up and have a real agent turn run at that time, server-side and silent, with a per-character daily power ceiling.

**Architecture:** `set_reminder` inserts a row into a new `scheduled_wakeups` table. A five-minute `onSchedule` sweeper in `functions` selects due rows, applies balance/cap/cooldown guardrails, claims each row with a conditional update, and POSTs it to a new `cloud-agent` endpoint authenticated with `SCHEDULER_SECRET`. That endpoint runs a normal ADK turn through the existing `runAgentReal` path and writes the spend back onto the row. Phase 1 delivers nothing to the user — the chosen delivery mode is recorded only.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (Cloud SQL), Firebase Functions v2 (`onSchedule`), Express, `@google/adk`, Zod, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md`

## Global Constraints

- **Both packages test with `node:test`, not Jest.** `functions/package.json:11` and `cloud-agent/package.json:13` both run `node --test` over built output (`lib/**/*.test.js` and `dist/**/*.test.js` respectively). Jest belongs to the root app package only. Tests must be written with `import test from 'node:test'` and `import assert from 'node:assert/strict'`.
- **Tests run against built output.** `npm test` in either package builds first. A test cannot be run without compiling; there is no ts-node path.
- **Migrations are hand-written at the next index.** Do NOT run `drizzle-kit generate` — the journal is out of sync with the SQL files. The next index is `0026`.
- **The budget day is UTC.** No timezone is stored anywhere in the schema. Never write "local midnight" logic.
- **Phase 1 delivers nothing to the user.** No push, no `messages` row, no client change. `deliver_wakeup` records the mode the model chose and returns.
- **No semicolons; single quotes.** Match surrounding style; Prettier is enforced in CI as `:check`.
- **Formatting and logic never share a commit.**
- **Spend reason string is exactly `proactive_wakeup`.**

### Constants pinned by this plan

Chosen here so the executor does not have to decide. Defined in `cloud-agent/src/constants/credits.ts` and mirrored where noted.

| Constant                        | Value        | Meaning                                                                     |
| ------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `DAILY_PROACTIVE_POWER_CEILING` | `500`        | Per character per UTC day. Five wake-ups at `AGENT_TURN_CREDIT_COST` (100). |
| `PROACTIVE_NOTIFY_COOLDOWN_MS`  | `43_200_000` | 12 hours since the user's last message before a `notify` is permitted.      |
| `MAX_PROACTIVE_PUSHES_PER_DAY`  | `2`          | Counted ceiling on `notify` outcomes per character per UTC day.             |
| `SWEEP_BATCH_LIMIT`             | `50`         | Max rows one sweep processes.                                               |
| `WAKEUP_RETENTION_DAYS`         | `30`         | Resolved rows older than this are hard-deleted.                             |

---

### Task 1: `scheduled_wakeups` table and schema definitions

**Files:**

- Create: `functions/drizzle/0026_scheduled_wakeups.sql`
- Create: `functions/src/db/scheduledWakeupsMigration.test.ts`
- Modify: `functions/src/db/schema.ts` (append after `agentTasks`, around line 282)
- Modify: `cloud-agent/src/db/schema.ts` (append at end)

**Interfaces:**

- Consumes: nothing.
- Produces: table `scheduled_wakeups`; Drizzle export `scheduledWakeups` in both packages with columns `id, characterId, userId, reason, dueAt, priority, status, runKey, claimedAt, resolvedAt, spentAmount, outcome, createdAt`.

- [ ] **Step 1: Write the failing migration test**

Create `functions/src/db/scheduledWakeupsMigration.test.ts`, mirroring `creditSpendEventsMigration.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sqlText = readFileSync(join(process.cwd(), 'drizzle', '0026_scheduled_wakeups.sql'), 'utf8')

test('creates scheduled_wakeups with the wake-up shape', () => {
  assert.match(sqlText, /CREATE TABLE IF NOT EXISTS scheduled_wakeups/)
  assert.match(sqlText, /id text PRIMARY KEY/)
  assert.match(sqlText, /character_id uuid NOT NULL REFERENCES characters\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /reason text NOT NULL/)
  assert.match(sqlText, /due_at timestamptz NOT NULL/)
  assert.match(sqlText, /priority integer NOT NULL DEFAULT 0/)
  assert.match(sqlText, /status text NOT NULL DEFAULT 'pending'/)
  assert.match(sqlText, /run_key text NOT NULL/)
  assert.match(sqlText, /spent_amount integer NOT NULL DEFAULT 0/)
  assert.match(sqlText, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
})

test('constrains status to the documented vocabulary', () => {
  assert.match(sqlText, /scheduled_wakeups_status_check/)
  for (const value of ['pending', 'claimed', 'done', 'skipped', 'cancelled']) {
    assert.match(sqlText, new RegExp(`'${value}'`))
  }
})

test('indexes the sweep, the cap check and the retention delete', () => {
  assert.match(sqlText, /scheduled_wakeups_status_due_idx/)
  assert.match(sqlText, /\(status, due_at\)/)
  assert.match(sqlText, /scheduled_wakeups_character_status_idx/)
  assert.match(sqlText, /\(character_id, status\)/)
  assert.match(sqlText, /scheduled_wakeups_resolved_at_idx/)
  assert.match(sqlText, /scheduled_wakeups_run_key_unique_idx/)
  assert.match(sqlText, /UNIQUE INDEX/)
})

test('is re-runnable', () => {
  assert.match(sqlText, /IF NOT EXISTS/)
  assert.doesNotMatch(sqlText, /DROP TABLE|DROP INDEX/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd functions && npm test 2>&1 | grep -A5 scheduledWakeups
```

Expected: FAIL — `ENOENT: no such file or directory ... 0026_scheduled_wakeups.sql`.

- [ ] **Step 3: Write the migration**

Create `functions/drizzle/0026_scheduled_wakeups.sql`:

```sql
-- Proactive character scheduler, Phase 1.
-- A character schedules its own future wake-up via the set_reminder tool; the
-- five-minute sweeper in functions/src/proactiveWakeupSweep.ts claims due rows
-- and hands them to cloud-agent. spent_amount is written back after the turn
-- and is the source for the per-character daily power ceiling — credit_spend_events
-- cannot serve that role because it has no character_id.
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md
CREATE TABLE IF NOT EXISTS scheduled_wakeups (
  id text PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  due_at timestamptz NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  run_key text NOT NULL,
  claimed_at timestamptz,
  resolved_at timestamptz,
  spent_amount integer NOT NULL DEFAULT 0,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_wakeups_status_check
    CHECK (status IN ('pending', 'claimed', 'done', 'skipped', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_status_due_idx
  ON scheduled_wakeups (status, due_at);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_character_status_idx
  ON scheduled_wakeups (character_id, status);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_resolved_at_idx
  ON scheduled_wakeups (resolved_at);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_wakeups_run_key_unique_idx
  ON scheduled_wakeups (run_key);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd functions && npm test 2>&1 | grep -A5 scheduledWakeups
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Add the Drizzle definition to `functions/src/db/schema.ts`**

Append immediately after the `agentTasks` block. `check`, `index`, `uniqueIndex`, `integer`, `text`, `timestamp`, `uuid` and `sql` are already imported in this file.

```ts
export const scheduledWakeups = pgTable(
  'scheduled_wakeups',
  {
    id: text('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull().default('pending'),
    runKey: text('run_key').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    spentAmount: integer('spent_amount').notNull().default(0),
    outcome: text('outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusDueIdx: index('scheduled_wakeups_status_due_idx').on(table.status, table.dueAt),
    characterStatusIdx: index('scheduled_wakeups_character_status_idx').on(
      table.characterId,
      table.status,
    ),
    resolvedAtIdx: index('scheduled_wakeups_resolved_at_idx').on(table.resolvedAt),
    runKeyUniqueIdx: uniqueIndex('scheduled_wakeups_run_key_unique_idx').on(table.runKey),
    statusCheck: check(
      'scheduled_wakeups_status_check',
      sql`${table.status} IN ('pending', 'claimed', 'done', 'skipped', 'cancelled')`,
    ),
  }),
)
```

- [ ] **Step 6: Mirror the same definition into `cloud-agent/src/db/schema.ts`**

Append the identical block. Check the import line at the top of that file first and add any of `check`, `index`, `uniqueIndex`, `integer` that are missing.

- [ ] **Step 7: Typecheck both packages**

```bash
cd functions && npx tsc --noEmit && cd ../cloud-agent && npx tsc --noEmit
```

Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add functions/drizzle/0026_scheduled_wakeups.sql functions/src/db/scheduledWakeupsMigration.test.ts functions/src/db/schema.ts cloud-agent/src/db/schema.ts
git commit -m "feat(db): add scheduled_wakeups table for proactive character scheduler

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 2: Guardrail pure functions

Pure decision logic, no database and no I/O, so it is exhaustively testable. This is the file a buyer reads to understand the spend ceiling.

**Files:**

- Create: `functions/src/services/proactiveWakeupGuardrails.ts`
- Create: `functions/src/services/proactiveWakeupGuardrails.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const DAILY_PROACTIVE_POWER_CEILING = 500`
  - `export const PROACTIVE_NOTIFY_COOLDOWN_MS = 43_200_000`
  - `export const MAX_PROACTIVE_PUSHES_PER_DAY = 2`
  - `export const WAKEUP_RETENTION_DAYS = 30`
  - `export const SWEEP_BATCH_LIMIT = 50`
  - `export type WakeupDecision = { run: true; notifyAllowed: boolean } | { run: false; skipReason: string }`
  - `export function decideWakeup(input: WakeupGuardrailInput): WakeupDecision`
  - `export function utcDayStart(now: Date): Date`

- [ ] **Step 1: Write the failing test**

Create `functions/src/services/proactiveWakeupGuardrails.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideWakeup,
  utcDayStart,
  DAILY_PROACTIVE_POWER_CEILING,
  PROACTIVE_NOTIFY_COOLDOWN_MS,
} from './proactiveWakeupGuardrails.js'

const NOW = new Date('2026-09-08T14:00:00.000Z')

function input(overrides: Partial<Parameters<typeof decideWakeup>[0]> = {}) {
  return {
    now: NOW,
    balance: 1000,
    turnCost: 100,
    todaysProactiveSpend: 0,
    todaysPushCount: 0,
    lastUserMessageAt: new Date('2026-09-06T14:00:00.000Z'),
    unreadProactiveCount: 0,
    ...overrides,
  }
}

test('runs and permits notify in the ordinary case', () => {
  assert.deepEqual(decideWakeup(input()), { run: true, notifyAllowed: true })
})

test('skips when the balance cannot cover one turn', () => {
  const decision = decideWakeup(input({ balance: 99, turnCost: 100 }))
  assert.deepEqual(decision, { run: false, skipReason: 'insufficient_power' })
})

test('runs when the balance exactly covers one turn', () => {
  assert.equal(decideWakeup(input({ balance: 100, turnCost: 100 })).run, true)
})

test('skips when the daily ceiling is already reached', () => {
  const decision = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING }))
  assert.deepEqual(decision, { run: false, skipReason: 'daily_ceiling' })
})

test('allows the turn that crosses the ceiling, refusing only the next', () => {
  // Overshoot is bounded by one turn: a turn's true cost is unknown until it runs.
  const justUnder = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING - 1 }))
  assert.equal(justUnder.run, true)
  const atCeiling = decideWakeup(input({ todaysProactiveSpend: DAILY_PROACTIVE_POWER_CEILING }))
  assert.equal(atCeiling.run, false)
})

test('runs but forbids notify inside the cooldown window', () => {
  const recent = new Date(NOW.getTime() - PROACTIVE_NOTIFY_COOLDOWN_MS + 1000)
  assert.deepEqual(decideWakeup(input({ lastUserMessageAt: recent })), {
    run: true,
    notifyAllowed: false,
  })
})

test('permits notify exactly at the cooldown boundary', () => {
  const boundary = new Date(NOW.getTime() - PROACTIVE_NOTIFY_COOLDOWN_MS)
  assert.equal(decideWakeup(input({ lastUserMessageAt: boundary })).notifyAllowed, true)
})

test('forbids notify while an earlier proactive message is unread', () => {
  const decision = decideWakeup(input({ unreadProactiveCount: 1 }))
  assert.deepEqual(decision, { run: true, notifyAllowed: false })
})

test('forbids notify once the daily push ceiling is reached', () => {
  assert.equal(decideWakeup(input({ todaysPushCount: 2 })).notifyAllowed, false)
})

test('permits notify when the user has never sent a message', () => {
  assert.equal(decideWakeup(input({ lastUserMessageAt: null })).notifyAllowed, true)
})

test('utcDayStart truncates to UTC midnight regardless of host timezone', () => {
  assert.equal(utcDayStart(NOW).toISOString(), '2026-09-08T00:00:00.000Z')
  assert.equal(
    utcDayStart(new Date('2026-09-08T00:00:00.000Z')).toISOString(),
    '2026-09-08T00:00:00.000Z',
  )
  assert.equal(
    utcDayStart(new Date('2026-09-08T23:59:59.999Z')).toISOString(),
    '2026-09-08T00:00:00.000Z',
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd functions && npm test 2>&1 | grep -A5 proactiveWakeupGuardrails
```

Expected: FAIL — cannot find module `./proactiveWakeupGuardrails.js`.

- [ ] **Step 3: Write the implementation**

Create `functions/src/services/proactiveWakeupGuardrails.ts`:

```ts
/**
 * Every decision about whether a background turn may run, and whether it may
 * interrupt the user, lives here. Pure functions over plain values: no database,
 * no clock, no I/O. This is deliberate — the spend ceiling should be readable
 * and provable in one file.
 *
 * Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md
 */

/** Per character, per UTC day. Five turns at AGENT_TURN_CREDIT_COST. */
export const DAILY_PROACTIVE_POWER_CEILING = 500

/** A notify is not permitted within 12h of the user's last message. */
export const PROACTIVE_NOTIFY_COOLDOWN_MS = 43_200_000

/** Counted ceiling on notify outcomes per character per UTC day. */
export const MAX_PROACTIVE_PUSHES_PER_DAY = 2

/** Resolved rows older than this are hard-deleted by the sweeper. */
export const WAKEUP_RETENTION_DAYS = 30

/** Max rows one sweep processes. */
export const SWEEP_BATCH_LIMIT = 50

export interface WakeupGuardrailInput {
  now: Date
  balance: number
  turnCost: number
  todaysProactiveSpend: number
  todaysPushCount: number
  lastUserMessageAt: Date | null
  unreadProactiveCount: number
}

export type WakeupDecision =
  { run: true; notifyAllowed: boolean } | { run: false; skipReason: string }

/**
 * UTC, not local. Nothing in the schema stores a user timezone — the only one
 * in the system is the per-request x-timezone header, which a sweeper running
 * with no user present cannot read.
 */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function decideWakeup(input: WakeupGuardrailInput): WakeupDecision {
  if (input.balance < input.turnCost) {
    return { run: false, skipReason: 'insufficient_power' }
  }

  // "Is there ceiling left", not "does this turn fit": a turn's true cost is
  // known only after it runs, so overshoot is bounded by one turn.
  if (input.todaysProactiveSpend >= DAILY_PROACTIVE_POWER_CEILING) {
    return { run: false, skipReason: 'daily_ceiling' }
  }

  const withinCooldown =
    input.lastUserMessageAt !== null &&
    input.now.getTime() - input.lastUserMessageAt.getTime() < PROACTIVE_NOTIFY_COOLDOWN_MS

  const notifyAllowed =
    !withinCooldown &&
    input.unreadProactiveCount === 0 &&
    input.todaysPushCount < MAX_PROACTIVE_PUSHES_PER_DAY

  return { run: true, notifyAllowed }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd functions && npm test 2>&1 | grep -A5 proactiveWakeupGuardrails
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/proactiveWakeupGuardrails.ts functions/src/services/proactiveWakeupGuardrails.test.ts
git commit -m "feat(scheduler): add proactive wake-up guardrail decision logic

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 3: Make `set_reminder` real

Replaces the stub at `cloud-agent/src/tools/reminders.ts:20`, which currently logs and returns a false confirmation.

**Files:**

- Modify: `cloud-agent/src/tools/reminders.ts` (whole file)
- Create: `cloud-agent/src/tools/reminders.test.ts`

**Interfaces:**

- Consumes: `scheduledWakeups` from Task 1; `DAILY_PROACTIVE_POWER_CEILING` value (redeclared locally in cloud-agent — the two packages do not share a module).
- Produces: `setReminderTool(db, userId, characterId)` returning a `FunctionTool` named `set_reminder` that inserts a `pending` row, or refuses at the ceiling.

- [ ] **Step 1: Write the failing test**

Create `cloud-agent/src/tools/reminders.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWakeupInsert, formatReminderResult } from './reminders.js'

test('builds a pending row with a unique run key', () => {
  const row = buildWakeupInsert({
    userId: 'user-1',
    characterId: 'char-1',
    reason: 'ask how the interview went',
    dueAt: new Date('2026-09-10T09:00:00.000Z'),
    priority: 3,
  })
  assert.equal(row.userId, 'user-1')
  assert.equal(row.characterId, 'char-1')
  assert.equal(row.reason, 'ask how the interview went')
  assert.equal(row.status, 'pending')
  assert.equal(row.priority, 3)
  assert.equal(row.dueAt.toISOString(), '2026-09-10T09:00:00.000Z')
  assert.ok(row.id.length > 0)
  assert.ok(row.runKey.length > 0)
  assert.notEqual(row.id, row.runKey)
})

test('mints a distinct run key per call', () => {
  const args = {
    userId: 'u',
    characterId: 'c',
    reason: 'r',
    dueAt: new Date('2026-09-10T09:00:00.000Z'),
    priority: 0,
  }
  assert.notEqual(buildWakeupInsert(args).runKey, buildWakeupInsert(args).runKey)
})

test('formats a confirmation when scheduled', () => {
  const text = formatReminderResult({ scheduled: true, dueAt: '2026-09-10T09:00:00.000Z' })
  assert.match(text, /2026-09-10T09:00:00.000Z/)
  assert.doesNotMatch(text, /power|credit|budget/i)
})

test('formats a refusal at the ceiling without naming the budget', () => {
  const text = formatReminderResult({ scheduled: false, reason: 'daily_ceiling' })
  assert.match(text, /not scheduled/i)
  // The model must not learn a number it could repeat to the user.
  assert.doesNotMatch(text, /\d+\s*(power|credits?)/i)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 reminders
```

Expected: FAIL — `buildWakeupInsert` is not exported.

- [ ] **Step 3: Rewrite `cloud-agent/src/tools/reminders.ts`**

```ts
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { and, eq, gte, sql } from 'drizzle-orm'
import { scheduledWakeups } from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

/**
 * Mirrors DAILY_PROACTIVE_POWER_CEILING in
 * functions/src/services/proactiveWakeupGuardrails.ts. The two packages do not
 * share a module; keep the values equal.
 */
export const DAILY_PROACTIVE_POWER_CEILING = 500

export interface WakeupInsertArgs {
  userId: string
  characterId: string
  reason: string
  dueAt: Date
  priority: number
}

export function buildWakeupInsert(args: WakeupInsertArgs) {
  return {
    id: crypto.randomUUID(),
    characterId: args.characterId,
    userId: args.userId,
    reason: args.reason,
    dueAt: args.dueAt,
    priority: args.priority,
    status: 'pending' as const,
    runKey: crypto.randomUUID(),
  }
}

export function formatReminderResult(
  result: { scheduled: true; dueAt: string } | { scheduled: false; reason: string },
): string {
  if (result.scheduled) {
    return `Scheduled. You will wake up at ${result.dueAt} to follow up on this.`
  }
  // Deliberately vague: the model must not learn a number it would repeat to
  // the user. Refusal arrives at the moment of scheduling, 429-style, rather
  // than as a live quota in the system prompt.
  return 'Not scheduled: this character has reached its background activity limit for today. Do not promise the user a follow-up for today.'
}

async function todaysProactiveSpend(
  db: DrizzleClient,
  characterId: string,
  now: Date,
): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${scheduledWakeups.spentAmount}), 0)::int` })
    .from(scheduledWakeups)
    .where(
      and(
        eq(scheduledWakeups.characterId, characterId),
        gte(scheduledWakeups.resolvedAt, dayStart),
      ),
    )
  return row?.total ?? 0
}

export function setReminderTool(
  db: DrizzleClient,
  userId: string,
  characterId: string,
): FunctionTool {
  return new FunctionTool({
    name: 'set_reminder',
    description:
      'Schedule your own future wake-up so you can follow up with the user later, even when they are not talking to you. Use this when you want to check back on something.',
    parameters: z.object({
      reason: z.string().describe('A note to your future self about what to follow up on and why.'),
      remind_at: z.string().describe('ISO 8601 datetime, in the future.'),
      priority: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe('Higher runs first when several are due at once. Default 0.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      const { reason, remind_at, priority } = args as {
        reason: string
        remind_at: string
        priority?: number
      }
      try {
        if (!reason?.trim()) return 'Not scheduled: a reason is required.'

        const dueAt = new Date(remind_at)
        if (Number.isNaN(dueAt.getTime())) {
          return 'Not scheduled: remind_at must be an ISO 8601 datetime.'
        }
        const now = new Date()
        if (dueAt.getTime() <= now.getTime()) {
          return 'Not scheduled: remind_at must be in the future.'
        }

        const spent = await todaysProactiveSpend(db, characterId, now)
        if (spent >= DAILY_PROACTIVE_POWER_CEILING) {
          return formatReminderResult({ scheduled: false, reason: 'daily_ceiling' })
        }

        await db.insert(scheduledWakeups).values(
          buildWakeupInsert({
            userId,
            characterId,
            reason: reason.trim(),
            dueAt,
            priority: priority ?? 0,
          }),
        )
        return formatReminderResult({ scheduled: true, dueAt: dueAt.toISOString() })
      } catch (error) {
        console.error('[CloudAgent] set_reminder failed:', error)
        return 'Not scheduled: an internal error occurred.'
      }
    },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 reminders
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Confirm the tool is still registered on the agent**

```bash
grep -rn "setReminderTool" cloud-agent/src --include="*.ts" | grep -v "\.test\."
```

Expected: a call site in `services/agentCore.ts` (or wherever `buildAgent` assembles tools). If the stub was never wired in, wire it alongside the other tools there and note it in the commit message.

- [ ] **Step 6: Typecheck and commit**

```bash
cd cloud-agent && npx tsc --noEmit
git add cloud-agent/src/tools/reminders.ts cloud-agent/src/tools/reminders.test.ts
git commit -m "feat(scheduler): make set_reminder persist real wake-ups

Replaces the stub that logged and returned a false confirmation. Refuses
at the daily ceiling so the model cannot promise a follow-up it will not make.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 4: The `/agent/proactive-wakeup` endpoint

Structural sibling of `schedulerTriggerHandler.ts`, reusing its auth and its spend/refund discipline, but running an ADK turn instead of driving a browser extension.

**Files:**

- Create: `cloud-agent/src/handlers/proactiveWakeupHandler.ts`
- Create: `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`
- Modify: `cloud-agent/src/index.ts` (add route after the `scheduler-trigger` route, ~line 599)

**Interfaces:**

- Consumes: `createRequireSchedulerSecret` from `./schedulerTriggerHandler.js`; `scheduledWakeups` (Task 1); `RunAgentParams`, `runAgentReal` from `../index.js`; `AGENT_TURN_CREDIT_COST` from `../constants/credits.js`; `CreditService`.
- Produces: `createProactiveWakeupHandler(deps)` returning an Express handler; request body `{ wakeupId, characterId, uid, runKey, reason, notifyAllowed }`; response `{ ok: true, mode, spentAmount }`.

- [ ] **Step 1: Write the failing test**

Create `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import request from 'supertest'
import { createProactiveWakeupHandler, resolveDeliveryMode } from './proactiveWakeupHandler.js'

const body = {
  wakeupId: 'w1',
  characterId: 'char-1',
  uid: 'firebase-uid-1',
  runKey: 'run-1',
  reason: 'ask how the interview went',
  notifyAllowed: true,
}

function buildApp(overrides: Partial<Parameters<typeof createProactiveWakeupHandler>[0]> = {}) {
  const calls = { spend: 0, refund: 0, resolved: [] as unknown[] }
  const deps = {
    resolveUserId: async () => 'user-db-id',
    loadCharacter: async () => ({
      id: 'char-1',
      name: 'Ada',
      appearance: null,
      traits: null,
      emotions: null,
      context: null,
    }),
    runAgent: async () => ({
      reply: 'Hi',
      toolCalls: ['deliver_wakeup'],
      deliveryMode: 'notify' as const,
    }),
    creditService: {
      spendCredit: async () => {
        calls.spend++
        return [{ transactionId: 'tx1', amount: 100 }]
      },
      refundCredit: async () => {
        calls.refund++
      },
      getBalance: async () => 1000,
    },
    resolveWakeup: async (id: string, patch: Record<string, unknown>) => {
      calls.resolved.push({ id, ...patch })
    },
    claimRunKey: async () => 'reserved' as const,
    ...overrides,
  }
  const app = express()
  app.use(express.json())
  app.post('/agent/proactive-wakeup', createProactiveWakeupHandler(deps as never))
  return { app, calls, deps }
}

test('rejects a malformed body', async () => {
  const { app } = buildApp()
  const res = await request(app).post('/agent/proactive-wakeup').send({ wakeupId: 'w1' })
  assert.equal(res.status, 400)
})

test('runs the turn, spends once and records the outcome', async () => {
  const { app, calls } = buildApp()
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(calls.spend, 1)
  assert.equal(calls.refund, 0)
  assert.equal(calls.resolved.length, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number; outcome: string }
  assert.equal(resolved.status, 'done')
  assert.equal(resolved.spentAmount, 100)
  assert.match(resolved.outcome, /notify/)
})

test('is idempotent on a duplicate run key: no second spend', async () => {
  const { app, calls } = buildApp({ claimRunKey: async () => 'duplicate' as const })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 200)
  assert.equal(calls.spend, 0)
})

test('returns 402 and does not run the turn when credits are exhausted', async () => {
  let ran = false
  const { app, calls } = buildApp({
    creditService: {
      spendCredit: async () => {
        throw new Error('INSUFFICIENT_CREDITS')
      },
      refundCredit: async () => {
        calls.refund++
      },
      getBalance: async () => 0,
    } as never,
    runAgent: (async () => {
      ran = true
      return { reply: '', toolCalls: [], deliveryMode: 'silent' as const }
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 402)
  assert.equal(ran, false)
})

test('refunds and records zero spend when the turn throws', async () => {
  const { app, calls } = buildApp({
    runAgent: (async () => {
      throw new Error('ADK exploded')
    }) as never,
  })
  const res = await request(app).post('/agent/proactive-wakeup').send(body)
  assert.equal(res.status, 500)
  assert.equal(calls.refund, 1)
  const resolved = calls.resolved[0] as { status: string; spentAmount: number }
  assert.equal(resolved.status, 'skipped')
  assert.equal(resolved.spentAmount, 0)
})

test('downgrades notify to quiet when the sweeper forbade notifying', () => {
  assert.equal(resolveDeliveryMode('notify', false), 'quiet')
  assert.equal(resolveDeliveryMode('notify', true), 'notify')
  assert.equal(resolveDeliveryMode('quiet', true), 'quiet')
  assert.equal(resolveDeliveryMode('silent', true), 'silent')
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 proactiveWakeup
```

Expected: FAIL — cannot find module `./proactiveWakeupHandler.js`.

- [ ] **Step 3: Write the handler**

Create `cloud-agent/src/handlers/proactiveWakeupHandler.ts`:

```ts
import { z } from 'zod'
import type { Request, Response } from 'express'
import { AGENT_TURN_CREDIT_COST } from '../constants/credits.js'
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'

export type DeliveryMode = 'notify' | 'quiet' | 'silent'

const bodySchema = z.object({
  wakeupId: z.string().min(1),
  characterId: z.string().uuid(),
  uid: z.string().min(1),
  runKey: z.string().min(1),
  reason: z.string().min(1),
  notifyAllowed: z.boolean(),
})

export interface ProactiveWakeupDeps {
  resolveUserId: (firebaseUid: string) => Promise<string | null>
  loadCharacter: (
    characterId: string,
    userId: string,
  ) => Promise<{
    id: string
    name: string
    appearance: string | null
    traits: string | null
    emotions: string | null
    context: string | null
  } | null>
  runAgent: (args: {
    userId: string
    firebaseUid: string
    characterId: string
    reason: string
  }) => Promise<{ reply: string; toolCalls: string[]; deliveryMode: DeliveryMode }>
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  resolveWakeup: (
    wakeupId: string,
    patch: { status: string; spentAmount: number; outcome: string },
  ) => Promise<void>
  claimRunKey: (runKey: string) => Promise<'reserved' | 'duplicate'>
}

/**
 * The model proposes, the code disposes. The agent picks a delivery mode via the
 * deliver_wakeup tool; the sweeper's cap and cooldown decide whether notifying
 * is permissible at all, and a forbidden notify degrades to quiet rather than
 * being dropped.
 */
export function resolveDeliveryMode(chosen: DeliveryMode, notifyAllowed: boolean): DeliveryMode {
  if (chosen === 'notify' && !notifyAllowed) return 'quiet'
  return chosen
}

export function createProactiveWakeupHandler(deps: ProactiveWakeupDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }
    const { wakeupId, characterId, uid, runKey, reason, notifyAllowed } = parsed.data

    let userId: string
    try {
      const resolved = await deps.resolveUserId(uid)
      if (!resolved) {
        res.status(422).json({ error: 'User not found' })
        return
      }
      userId = resolved
    } catch (err) {
      console.error('[proactive-wakeup] resolveUserId error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Idempotency: a retried sweep must not spend twice.
    let reservation: 'reserved' | 'duplicate'
    try {
      reservation = await deps.claimRunKey(runKey)
    } catch (err) {
      console.error('[proactive-wakeup] claimRunKey error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    if (reservation === 'duplicate') {
      res.json({ ok: true, mode: 'silent', spentAmount: 0, duplicate: true })
      return
    }

    let allocations: CreditSpendAllocation[]
    try {
      allocations = await deps.creditService.spendCredit(
        userId,
        AGENT_TURN_CREDIT_COST,
        'proactive_wakeup',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'INSUFFICIENT_CREDITS') {
        await deps
          .resolveWakeup(wakeupId, {
            status: 'skipped',
            spentAmount: 0,
            outcome: 'insufficient_power',
          })
          .catch(() => {})
        res.status(402).json({ error: 'Insufficient credits' })
        return
      }
      console.error('[proactive-wakeup] spendCredit error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    const spentAmount = allocations.reduce((sum, a) => sum + a.amount, 0)

    try {
      const character = await deps.loadCharacter(characterId, userId)
      if (!character) {
        await deps.creditService.refundCredit(userId, allocations)
        await deps
          .resolveWakeup(wakeupId, {
            status: 'skipped',
            spentAmount: 0,
            outcome: 'character_missing',
          })
          .catch(() => {})
        res.status(422).json({ error: 'Character not found' })
        return
      }

      const result = await deps.runAgent({ userId, firebaseUid: uid, characterId, reason })
      const mode = resolveDeliveryMode(result.deliveryMode, notifyAllowed)

      // Phase 1 delivers nothing. Recording the mode the model chose is the
      // point: it yields production data on how often characters WOULD have
      // interrupted, before any user can be interrupted.
      await deps.resolveWakeup(wakeupId, {
        status: 'done',
        spentAmount,
        outcome: `mode=${mode} chosen=${result.deliveryMode}`,
      })

      res.json({ ok: true, mode, spentAmount })
    } catch (err) {
      console.error('[proactive-wakeup] turn failed:', err)
      try {
        await deps.creditService.refundCredit(userId, allocations)
      } catch (refundErr) {
        console.warn('[proactive-wakeup] refundCredit failed:', refundErr)
      }
      // spentAmount 0: a refunded turn must not consume the day's allowance.
      await deps
        .resolveWakeup(wakeupId, { status: 'skipped', spentAmount: 0, outcome: 'turn_failed' })
        .catch(() => {})
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 proactiveWakeup
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the route in `cloud-agent/src/index.ts`**

Add after the existing `scheduler-trigger` route block, following its exact shape — rate limiter, then the secret gate built from `process.env.SCHEDULER_SECRET`, then the handler. Reuse `createRequireSchedulerSecret` and the existing `schedulerTriggerLimiter`. Build the deps from the already-constructed `db`, `services`, and credit service in that file: `resolveUserId` mirrors the `resolveUserId` lambda at `index.ts:685`; `loadCharacter` is a `select().from(characters).where(and(eq(characters.id, ...), eq(characters.userId, ...)))`; `claimRunKey` and `resolveWakeup` are Drizzle writes against `scheduledWakeups`; `runAgent` calls `runAgentReal` with `assembleSystemInstruction(character, wikiContext)` and the wake-up `reason` as `message`, `history: []`, `timezone: 'UTC'`.

- [ ] **Step 6: Typecheck, run the full package suite, commit**

```bash
cd cloud-agent && npx tsc --noEmit && npm test 2>&1 | tail -20
```

Expected: typecheck silent; suite at or above the known baseline of 288 tests (287 pass, 1 skipped) plus the new ones. Two known flakes exist — re-run once before investigating a failure.

```bash
git add cloud-agent/src/handlers/proactiveWakeupHandler.ts cloud-agent/src/handlers/proactiveWakeupHandler.test.ts cloud-agent/src/index.ts
git commit -m "feat(scheduler): add /agent/proactive-wakeup endpoint

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 5: The `deliver_wakeup` tool

**Files:**

- Create: `cloud-agent/src/tools/deliverWakeup.ts`
- Create: `cloud-agent/src/tools/deliverWakeup.test.ts`
- Modify: `cloud-agent/src/services/agentCore.ts` (register the tool in `buildAgent` alongside the existing tools)

**Interfaces:**

- Consumes: `DeliveryMode` from `../handlers/proactiveWakeupHandler.js`.
- Produces: `createDeliverWakeupTool(sink)` where `sink: { mode: DeliveryMode | null; message: string | null }` is mutated in place, so the handler reads the model's choice after the run.

- [ ] **Step 1: Write the failing test**

Create `cloud-agent/src/tools/deliverWakeup.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeliverWakeupTool, type WakeupSink } from './deliverWakeup.js'

async function call(tool: ReturnType<typeof createDeliverWakeupTool>, args: unknown) {
  return (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute(args)
}

test('records the mode and message the model chose', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  const out = await call(createDeliverWakeupTool(sink), {
    mode: 'notify',
    message: 'How did the interview go?',
  })
  assert.equal(sink.mode, 'notify')
  assert.equal(sink.message, 'How did the interview go?')
  assert.match(out, /recorded/i)
})

test('rejects an unknown mode without mutating the sink', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  const out = await call(createDeliverWakeupTool(sink), { mode: 'shout', message: 'hi' })
  assert.equal(sink.mode, null)
  assert.match(out, /mode must be/i)
})

test('accepts silent with no message', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  await call(createDeliverWakeupTool(sink), { mode: 'silent' })
  assert.equal(sink.mode, 'silent')
  assert.equal(sink.message, null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 deliverWakeup
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

Create `cloud-agent/src/tools/deliverWakeup.ts`:

```ts
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DeliveryMode } from '../handlers/proactiveWakeupHandler.js'

export interface WakeupSink {
  mode: DeliveryMode | null
  message: string | null
}

const MODES: DeliveryMode[] = ['notify', 'quiet', 'silent']

/**
 * How a wake-up ends. The model chooses how much of the user's attention this
 * is worth; the handler may downgrade notify to quiet. In Phase 1 nothing is
 * delivered — the choice is recorded so the notify rate can be observed before
 * any user can be interrupted.
 */
export function createDeliverWakeupTool(sink: WakeupSink): FunctionTool {
  return new FunctionTool({
    name: 'deliver_wakeup',
    description:
      'End your wake-up by saying how it should reach the user. Use notify only when it is genuinely worth interrupting them; quiet to leave a message they will see next time they open the app; silent when you only updated your own notes and there is nothing to say.',
    parameters: z.object({
      mode: z.enum(['notify', 'quiet', 'silent']),
      message: z.string().optional().describe('What to say. Omit for silent.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      const { mode, message } = args as { mode: string; message?: string }
      if (!MODES.includes(mode as DeliveryMode)) {
        return 'mode must be one of: notify, quiet, silent.'
      }
      sink.mode = mode as DeliveryMode
      sink.message = message ?? null
      return 'Recorded.'
    },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cloud-agent && npm test 2>&1 | grep -A5 deliverWakeup
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Register the tool in `buildAgent`**

In `cloud-agent/src/services/agentCore.ts`, add `createDeliverWakeupTool` to the tool list alongside `setReminderTool` and the others. It needs a sink, so thread an optional `wakeupSink` through `buildAgent`'s params and include the tool only when one is supplied — an ordinary chat turn must not see it.

- [ ] **Step 6: Typecheck and commit**

```bash
cd cloud-agent && npx tsc --noEmit
git add cloud-agent/src/tools/deliverWakeup.ts cloud-agent/src/tools/deliverWakeup.test.ts cloud-agent/src/services/agentCore.ts
git commit -m "feat(scheduler): add deliver_wakeup tool for proactive turn outcomes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 6: The sweeper

**Files:**

- Create: `functions/src/proactiveWakeupSweep.ts`
- Create: `functions/src/proactiveWakeupSweep.test.ts`
- Modify: `functions/src/index.ts` (export the scheduled function)
- Modify: `.env.example`
- Modify: `docker-compose.local.yml`

**Interfaces:**

- Consumes: `decideWakeup`, `utcDayStart`, `SWEEP_BATCH_LIMIT`, `WAKEUP_RETENTION_DAYS` (Task 2); the `/agent/proactive-wakeup` endpoint (Task 4).
- Produces: `proactiveWakeupSweepHandler(deps)` and the `proactiveWakeupSweep` scheduled export.

- [ ] **Step 1: Write the failing test**

Create `functions/src/proactiveWakeupSweep.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { proactiveWakeupSweepHandler } from './proactiveWakeupSweep.js'

const NOW = new Date('2026-09-08T14:00:00.000Z')

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    characterId: 'char-1',
    userId: 'user-1',
    firebaseUid: 'fb-1',
    reason: 'ask how the interview went',
    runKey: 'run-1',
    priority: 0,
    ...overrides,
  }
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const posted: unknown[] = []
  const resolved: unknown[] = []
  return {
    posted,
    resolved,
    deps: {
      now: () => NOW,
      selectDue: async () => [dueRow()],
      loadContext: async () => ({
        balance: 1000,
        todaysProactiveSpend: 0,
        todaysPushCount: 0,
        lastUserMessageAt: new Date('2026-09-06T00:00:00.000Z'),
        unreadProactiveCount: 0,
      }),
      claim: async () => true,
      postWakeup: async (payload: unknown) => {
        posted.push(payload)
      },
      resolveWakeup: async (id: string, patch: unknown) => {
        resolved.push({ id, patch })
      },
      deleteExpired: async () => 0,
      ...overrides,
    },
  }
}

test('posts a due row that passes every guardrail', async () => {
  const { posted, deps } = buildDeps()
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 1)
  const payload = posted[0] as { wakeupId: string; notifyAllowed: boolean }
  assert.equal(payload.wakeupId, 'w1')
  assert.equal(payload.notifyAllowed, true)
})

test('skips a row without posting when power is insufficient', async () => {
  const { posted, resolved, deps } = buildDeps({
    loadContext: async () => ({
      balance: 0,
      todaysProactiveSpend: 0,
      todaysPushCount: 0,
      lastUserMessageAt: null,
      unreadProactiveCount: 0,
    }),
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 0)
  assert.equal(resolved.length, 1)
  const { patch } = resolved[0] as { patch: { status: string; outcome: string } }
  assert.equal(patch.status, 'skipped')
  assert.equal(patch.outcome, 'insufficient_power')
})

test('does not post when the claim is lost to a concurrent sweep', async () => {
  const { posted, deps } = buildDeps({ claim: async () => false })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(posted.length, 0)
})

test('passes notifyAllowed false through when inside the cooldown', async () => {
  const { posted, deps } = buildDeps({
    loadContext: async () => ({
      balance: 1000,
      todaysProactiveSpend: 0,
      todaysPushCount: 0,
      lastUserMessageAt: new Date(NOW.getTime() - 60_000),
      unreadProactiveCount: 0,
    }),
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal((posted[0] as { notifyAllowed: boolean }).notifyAllowed, false)
})

test('one row failing does not abort the rest of the batch', async () => {
  let calls = 0
  const { posted, deps } = buildDeps({
    selectDue: async () => [dueRow(), dueRow({ id: 'w2', runKey: 'run-2' })],
    postWakeup: async (payload: { wakeupId: string }) => {
      calls++
      if (payload.wakeupId === 'w1') throw new Error('network')
      posted.push(payload)
    },
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(calls, 2)
  assert.equal(posted.length, 1)
})

test('runs the retention delete every sweep', async () => {
  let deleted = 0
  const { deps } = buildDeps({
    deleteExpired: async () => {
      deleted++
      return 3
    },
  })
  await proactiveWakeupSweepHandler(deps as never)
  assert.equal(deleted, 1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd functions && npm test 2>&1 | grep -A5 proactiveWakeupSweep
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the sweeper**

Create `functions/src/proactiveWakeupSweep.ts`:

```ts
import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import {
  decideWakeup,
  utcDayStart,
  SWEEP_BATCH_LIMIT,
  WAKEUP_RETENTION_DAYS,
} from './services/proactiveWakeupGuardrails.js'

export interface DueWakeup {
  id: string
  characterId: string
  userId: string
  firebaseUid: string
  reason: string
  runKey: string
  priority: number
}

export interface WakeupContext {
  balance: number
  todaysProactiveSpend: number
  todaysPushCount: number
  lastUserMessageAt: Date | null
  unreadProactiveCount: number
}

export interface SweepDeps {
  now: () => Date
  selectDue: (limit: number) => Promise<DueWakeup[]>
  loadContext: (row: DueWakeup, dayStart: Date) => Promise<WakeupContext>
  claim: (id: string, now: Date) => Promise<boolean>
  postWakeup: (payload: {
    wakeupId: string
    characterId: string
    uid: string
    runKey: string
    reason: string
    notifyAllowed: boolean
  }) => Promise<void>
  resolveWakeup: (id: string, patch: { status: string; outcome: string }) => Promise<void>
  deleteExpired: (olderThan: Date) => Promise<number>
}

/**
 * Every five minutes: find due wake-ups, decide whether each may run and
 * whether it may interrupt, claim it so a concurrent sweep cannot double-fire
 * it, and hand it to cloud-agent. All spend decisions happen here, before any
 * money is committed — this is the one function to read to understand the
 * feature's cost.
 *
 * Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md
 */
export async function proactiveWakeupSweepHandler(deps: SweepDeps): Promise<void> {
  const now = deps.now()
  const dayStart = utcDayStart(now)

  const due = await deps.selectDue(SWEEP_BATCH_LIMIT)
  let posted = 0
  let skipped = 0

  for (const row of due) {
    try {
      const context = await deps.loadContext(row, dayStart)
      const decision = decideWakeup({
        now,
        balance: context.balance,
        turnCost: 100,
        todaysProactiveSpend: context.todaysProactiveSpend,
        todaysPushCount: context.todaysPushCount,
        lastUserMessageAt: context.lastUserMessageAt,
        unreadProactiveCount: context.unreadProactiveCount,
      })

      if (!decision.run) {
        // Terminal, not retried: a wake-up worth doing at 09:00 is usually not
        // worth doing at 17:00, and retrying turns a low-balance user's queue
        // into a thundering herd the moment they top up.
        await deps.resolveWakeup(row.id, { status: 'skipped', outcome: decision.skipReason })
        skipped++
        continue
      }

      const won = await deps.claim(row.id, now)
      if (!won) continue

      await deps.postWakeup({
        wakeupId: row.id,
        characterId: row.characterId,
        uid: row.firebaseUid,
        runKey: row.runKey,
        reason: row.reason,
        notifyAllowed: decision.notifyAllowed,
      })
      posted++
    } catch (err) {
      // One bad row must not cost the rest of the batch its turn.
      logger.error('Proactive wake-up failed', { wakeupId: row.id, err })
    }
  }

  const cutoff = new Date(now.getTime() - WAKEUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deleted = await deps.deleteExpired(cutoff)

  logger.info('Proactive wake-up sweep complete', {
    due: due.length,
    posted,
    skipped,
    deleted,
  })
}

export const proactiveWakeupSweep = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-central1',
    secrets: [...CLOUD_SQL_SECRETS, 'SCHEDULER_SECRET'],
  },
  async (event: ScheduledEvent) => {
    void event
    await proactiveWakeupSweepHandler(buildSweepDeps())
  },
)
```

Then write `buildSweepDeps()` in the same file, wiring the real implementations:

- `selectDue(limit)`: join `scheduled_wakeups` to `users` for `firebase_uid`; `WHERE status = 'pending' AND due_at <= now()`; `ORDER BY priority DESC, due_at ASC`; `LIMIT limit`.
- `loadContext(row, dayStart)`: balance from `subscriptions.current_credits`; `todaysProactiveSpend` = `SUM(spent_amount)` over `scheduled_wakeups` for that `character_id` with `resolved_at >= dayStart`; `todaysPushCount` = count of rows for that character with `resolved_at >= dayStart AND outcome LIKE 'mode=notify%'`; `lastUserMessageAt` = `MAX(created_at)` from `messages` for that character; `unreadProactiveCount` = `0` in Phase 1, since nothing is delivered — leave a comment saying so.
- `claim(id, now)`: `UPDATE scheduled_wakeups SET status='claimed', claimed_at=$now WHERE id=$id AND status='pending'`, returning whether exactly one row changed. The `AND status='pending'` is what makes two overlapping sweeps safe; do not drop it.
- `postWakeup(payload)`: `fetch(`${process.env.CLOUD_AGENT_URL}/agent/proactive-wakeup`, ...)` with `Authorization: Bearer ${process.env.SCHEDULER_SECRET}`, throwing on a non-2xx so the catch above logs it.
- `resolveWakeup(id, patch)`: update `status`, `outcome`, `resolved_at = now()`.
- `deleteExpired(cutoff)`: `DELETE FROM scheduled_wakeups WHERE resolved_at < $cutoff`, returning the row count.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd functions && npm test 2>&1 | grep -A5 proactiveWakeupSweep
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Export the function from `functions/src/index.ts`**

Follow the existing export style used for `imageRetentionSweep`.

- [ ] **Step 6: Add the new environment variables**

In `.env.example`, below the existing `EXPO_PUBLIC_CLOUD_AGENT_URL` comment block at line 43, add — noting explicitly that this is a _different_ variable from the client's:

```bash
# Server-side address for cloud-agent, used by the proactive wake-up sweeper in
# functions. NOT the same as EXPO_PUBLIC_CLOUD_AGENT_URL above, which is the
# client's address for the same service.
CLOUD_AGENT_URL=http://localhost:8080
# Shared bearer secret for cloud-agent's scheduler routes.
SCHEDULER_SECRET=
```

Add both to the cloud-agent service's `environment:` block in `docker-compose.local.yml`.

- [ ] **Step 7: Full verification**

```bash
cd functions && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20
```

Expected: typecheck and lint silent; the whole `functions` suite green.

- [ ] **Step 8: Commit**

```bash
git add functions/src/proactiveWakeupSweep.ts functions/src/proactiveWakeupSweep.test.ts functions/src/index.ts .env.example docker-compose.local.yml
git commit -m "feat(scheduler): add five-minute proactive wake-up sweeper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

---

### Task 7: Documentation and deploy preflight

**Files:**

- Modify: `docs/billing-and-credits.md`
- Modify: `docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md` (status line)

- [ ] **Step 1: Add the spend reason to the billing table**

In `docs/billing-and-credits.md`, add a row alongside the existing "Scheduler trigger" row at line 42:

```markdown
| Proactive wake-up | cloud-agent /agent/proactive-wakeup | 100 (deduped by run_key) | Yes |
```

- [ ] **Step 2: Record the reason token in the attribution spec**

Add `| proactive_wakeup | proactiveWakeupHandler.ts (one spend per proactive turn) |` to the reason-vocabulary table in `docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md`.

- [ ] **Step 3: Mark the design spec implemented**

Change the spec's status line to `**Status:** Phase 1 implemented <date> — Phase 2 (client delivery) not started`.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: record proactive_wakeup spend reason and Phase 1 status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019GVjMm9nq1SvwZvS3fsDTS"
```

- [ ] **Step 5: Deploy preflight — STOP AND ASK before running any of this**

Do not deploy without explicit approval. When approved, in order:

1. **`SCHEDULER_SECRET` must have a Secret Manager _version_** before any deploy references it, or the deploy fails. Verify: `gcloud secrets versions list SCHEDULER_SECRET --project clanker-prod`.
2. **Apply migration 0026** to the prod database.
3. **Deploy cloud-agent, then verify the new revision actually took traffic** — `gcloud run services describe clanker-cloud-agent --region us-central1 --format='value(status.traffic)'`. A healthy revision serving 0% has happened here before and went unnoticed for eleven days.
4. **Deploy functions**, which creates the Cloud Scheduler job.
5. **Watch the first hour**: `credit_spend_events WHERE reason = 'proactive_wakeup'` should be empty until a character actually schedules something, and `scheduled_wakeups` outcomes should show the `mode=` distribution. That distribution is the data Phase 2 needs.

---

## Self-Review

**Spec coverage.** §1 → Task 1. §2 → Tasks 2 and 6. §3 → Tasks 3, 4 and 5. Retention → Task 6. UTC day → Tasks 2 and 6. Local dev config → Task 6 Step 6. Billing docs → Task 7. §4 is Phase 2 and deliberately absent. No gaps.

**Known soft spots**, called out rather than hidden:

- Task 4 Step 5 and Task 6 Step 3's `buildSweepDeps` describe wiring in prose with exact SQL semantics rather than complete code, because both depend on local variable names in files the executor will have open. Every query's shape, filter and ordering is specified; nothing is left to taste.
- `todaysPushCount` is derived by matching `outcome LIKE 'mode=notify%'`. That is a string match on a free-text column — acceptable in Phase 1, where the count has no user-visible effect, but Phase 2 should promote the mode to its own column before the count starts gating real pushes. Worth revisiting there.
- `turnCost` is hardcoded to `100` in the sweeper rather than imported from cloud-agent's `AGENT_TURN_CREDIT_COST`, because the two packages share no module. It is pinned in the constants table above; if that constant ever changes, both places change.
