# Proactive Character Scheduler Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 1's shadow-mode proactive wake-ups reach the user — persisted server-side, synced to the device, badged on the character list, and announced by push when the guardrails allow it.

**Architecture:** Two additive Postgres migrations promote the delivery mode out of a free-text `outcome` string into real columns and add server-authoritative read state. The cloud-agent writes a `messages` row when a wake-up produces a reply and fires a character-specific push. A new account-wide, cursor-paginated callable syncs those rows down to the device's local SQLite, which applies them in two phases so it can never clobber local state. A second callable writes read state back, retried on failure and backstopped by a 7-day server-side staleness escape.

**Tech Stack:** TypeScript, Firebase Functions v2 (`onCall`), Express (cloud-agent), Drizzle ORM + hand-written SQL migrations, Postgres (Cloud SQL), Expo SQLite, React Native, `node:test` (backends) and Jest (client), Expo push.

**Spec:** `docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md`

## Global Constraints

- **Test runner differs per package.** `functions` and `cloud-agent` use `node:test` — Jest syntax is DOA there. The root client package uses Jest, and `npm test -- <path>` does **not** filter; use `npx jest <path>`.
- **Backend tests run over built output.** `npm test` builds first (`lib/`, `dist/`). There is no ts-node path. Import from `.js` paths in test files.
- **Baselines that must not regress:** `functions` 499/499; `cloud-agent` 337 pass + 1 known skip; root 158 suites / 1441 tests.
- **Migrations are hand-written at the next free index** and registered in `functions/scripts/migrationOrder.mjs`. Both runners refuse an unregistered file. **Never run `drizzle-kit generate`** — the journal is stuck at `0011` while files run past `0027`.
- **Migrations apply as a chain.** Pass the full `MIGRATIONS` list, not just the newest file; the ordering guard refuses a migration whose predecessors are unapplied.
- **The migration runner is forward-only.** `functions/scripts/migrate.mjs` never parses a `-- DOWN` section. Rollback means a new forward migration.
- **There is no deployed `staging` environment.** Migrations apply straight to `clanker-prod`. Every migration here must be additive, nullable, and re-runnable.
- **Preserve the `claimed`/`running` two-status split.** Narrowing the claim predicate to `'pending'` alone breaks every wake-up.
- **Budget day is UTC.**
- **Style:** no semicolons, single quotes. Prettier must pass (`npx prettier --check`).
- **Formatting and logic never share a commit or branch.**
- **`functions/scripts/migrationOrder.mjs` already fails `prettier --check`** and did so before this work. Leave it alone; do not reformat it while editing it.
- **After any deploy, verify the new revision actually took traffic.** A healthy revision serving 0% has silently happened in this project before.

**Pinned constants** (exact values, copied from the spec):

```
DAILY_PROACTIVE_POWER_CEILING = 500          (existing, unchanged, UNTUNED)
PROACTIVE_NOTIFY_COOLDOWN_MS  = 43_200_000   (existing, unchanged, UNTUNED)
MAX_PROACTIVE_PUSHES_PER_DAY  = 2            (existing, unchanged, UNTUNED)
SWEEP_BATCH_LIMIT             = 50           (existing, unchanged)
WAKEUP_RETENTION_DAYS         = 30           (existing, unchanged)
STALE_CLAIM_TIMEOUT_MS        = 3_600_000    (existing, unchanged)
UNREAD_STALENESS_ESCAPE_MS    = 604_800_000  (NEW — 7 days)
PROACTIVE_SYNC_PAGE_LIMIT     = 100          (NEW — max rows per fetch page)
PUSH_BODY_MAX_LENGTH          = 140          (NEW — push preview truncation)
```

> **ROLLOUT GATE — do not skip.** The first three constants were chosen blind before Phase 1 shipped and are carried forward **explicitly untuned**. Before releasing any build that can deliver a user-visible push, run `node scripts/proactiveTelemetry.mjs` from `functions/` and revisit them against the observed clamp rate and skip-reason distribution. Shipping the mechanism is not permission to ship the numbers.

---

## File Structure

**`functions` — sweeper, callables, migrations**

| File                                                         | Responsibility                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `functions/drizzle/0028_scheduled_wakeups_delivery_mode.sql` | Create: adds `delivery_mode` + `chosen_delivery_mode`, backfills from `outcome` |
| `functions/drizzle/0029_messages_read_at.sql`                | Create: adds `messages.read_at` + partial index                                 |
| `functions/scripts/migrationOrder.mjs`                       | Modify: register both files                                                     |
| `functions/src/db/schema.ts`                                 | Modify: two new `scheduledWakeups` fields, one new `messages` field             |
| `functions/src/proactiveWakeupSweep.ts`                      | Modify: `todaysPushCount` cutover, real `unreadProactiveCount`                  |
| `functions/src/services/proactiveWakeupGuardrails.ts`        | Modify: add `UNREAD_STALENESS_ESCAPE_MS` export                                 |
| `functions/src/proactiveMessages.ts`                         | Create: `fetchProactiveMessages` + `markProactiveRead` callables and handlers   |
| `functions/src/proactiveMessages.test.ts`                    | Create: tests for both callables                                                |
| `functions/src/index.ts`                                     | Modify: export the two new callables                                            |

**`cloud-agent` — the turn, the message row, the push**

| File                                                 | Responsibility                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `cloud-agent/src/db/schema.ts`                       | Modify: mirror the two `scheduledWakeups` fields                      |
| `cloud-agent/src/handlers/proactiveWakeupHandler.ts` | Modify: write the message row, send the push, record modes as columns |
| `cloud-agent/src/services/fcmDispatcher.ts`          | Modify: add `sendCharacterProactive`                                  |

**Client (root) — first client work in this feature**

| File                                 | Responsibility                                                    |
| ------------------------------------ | ----------------------------------------------------------------- |
| `src/database/schema.ts`             | Modify: local migrations `25` (`read_at`) and `26` (`sync_state`) |
| `src/database/messageDatabase.ts`    | Modify: two-phase proactive sync insert, unread count query       |
| `src/database/syncState.ts`          | Create: cursor read/write helpers                                 |
| `src/services/proactiveSync.ts`      | Create: orchestrates fetch → apply → advance cursor               |
| `src/services/proactiveReadQueue.ts` | Create: queued, retried `markProactiveRead`                       |
| `src/constants/proactive.ts`         | Create: client mirror of `UNREAD_STALENESS_ESCAPE_MS`             |
| `src/hooks/useProactiveUnread.ts`    | Create: per-character unread flag for the list badge              |

---

## Task 1: Migration 0028 — delivery mode columns and backfill

**Files:**

- Create: `functions/drizzle/0028_scheduled_wakeups_delivery_mode.sql`
- Modify: `functions/scripts/migrationOrder.mjs` (append to `MIGRATION_ORDER`)
- Modify: `functions/src/db/schema.ts` (`scheduledWakeups`)
- Modify: `cloud-agent/src/db/schema.ts` (`scheduledWakeups`)
- Test: `functions/src/db/schema.test.ts` (create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: `scheduledWakeups.deliveryMode: text | null`, `scheduledWakeups.chosenDeliveryMode: text | null` in both packages' schema modules.

- [ ] **Step 1: Write the migration SQL**

Create `functions/drizzle/0028_scheduled_wakeups_delivery_mode.sql`:

```sql
-- Proactive character scheduler Phase 2: promote the delivery mode out of the
-- free-text outcome string into real columns.
--
-- todaysPushCount was derived by matching outcome LIKE 'mode=notify%'. In Phase 1
-- that count gated nothing visible, so a miss was harmless. In Phase 2 it gates
-- real push notifications, where a miss either over-notifies past the daily cap
-- or silently suppresses a message.
--
-- TWO columns, not one. proactiveWakeupHandler writes
-- 'mode=<effective> chosen=<model choice>', and resolveDeliveryMode clamps a
-- chosen 'notify' down to 'quiet' when notifyAllowed is false. 'chosen' is the
-- Phase 1 deliverable — the distribution the rollout gate tunes the caps
-- against — so collapsing both into one column would discard it permanently.
--
-- Every UPDATE carries an IS NULL guard so this file is safely re-runnable: a
-- re-run after Phase 2 rows exist can never overwrite a correctly written value
-- with one re-parsed from free text.
--
-- Forward-only: scripts/migrate.mjs has no DOWN support. Rolling back means a
-- new forward migration that drops these columns. outcome is left intact, so
-- the columns can be dropped and recomputed with no data loss.
--
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md

ALTER TABLE scheduled_wakeups ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE scheduled_wakeups ADD COLUMN IF NOT EXISTS chosen_delivery_mode text;

-- Effective mode, after the notifyAllowed clamp. Prefix match, mirroring the
-- LIKE 'mode=notify%' predicate it replaces.
UPDATE scheduled_wakeups SET delivery_mode = 'notify'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=notify %';
UPDATE scheduled_wakeups SET delivery_mode = 'quiet'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=quiet %';
UPDATE scheduled_wakeups SET delivery_mode = 'silent'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=silent %';

-- What the model chose before the clamp — the Phase 1 observational signal.
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'notify'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=notify';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'quiet'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=quiet';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'silent'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=silent';

-- Rows whose outcome is not a 'mode=' string at all — stale_claim, turn_failed,
-- insufficient_power, identifier_mismatch, spend_failed, character_missing, and
-- every skip reason — correctly keep NULL in both columns.
--
-- Both stay bare nullable text with no CHECK constraint, so a future mode value
-- cannot fail a write in production.

CREATE INDEX IF NOT EXISTS scheduled_wakeups_character_delivery_idx
  ON scheduled_wakeups (character_id, delivery_mode, resolved_at);
```

- [ ] **Step 2: Register the migration**

In `functions/scripts/migrationOrder.mjs`, append to the `MIGRATION_ORDER` array after `'0027_scheduled_wakeups_running_status.sql',`:

```js
  '0028_scheduled_wakeups_delivery_mode.sql',
```

Do not reformat the rest of the file — it already fails `prettier --check` and that is pre-existing.

- [ ] **Step 3: Write the failing schema test**

Create `functions/src/db/schema.test.ts` (or append if it exists):

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduledWakeups, messages } from './schema.js'

test('scheduledWakeups exposes both delivery mode columns', () => {
  assert.equal(scheduledWakeups.deliveryMode.name, 'delivery_mode')
  assert.equal(scheduledWakeups.chosenDeliveryMode.name, 'chosen_delivery_mode')
})

test('delivery mode columns are nullable so non-mode outcomes stay NULL', () => {
  assert.equal(scheduledWakeups.deliveryMode.notNull, false)
  assert.equal(scheduledWakeups.chosenDeliveryMode.notNull, false)
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — TypeScript error, `Property 'deliveryMode' does not exist`.

- [ ] **Step 5: Add the fields to both schema files**

In `functions/src/db/schema.ts`, inside the `scheduledWakeups` column object, after `outcome: text('outcome'),`:

```ts
    deliveryMode: text('delivery_mode'),
    chosenDeliveryMode: text('chosen_delivery_mode'),
```

Make the identical edit in `cloud-agent/src/db/schema.ts` (the `scheduledWakeups` table is declared there too, at roughly line 176). Both packages must agree or the cloud-agent write in Task 2 will not compile.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS, 501/501 (499 baseline + 2 new).

Run: `cd cloud-agent && npm test`
Expected: PASS, 337 + 1 skip — unchanged.

- [ ] **Step 7: Apply to the local dev database**

Run: `cd functions && MIGRATIONS="0028_scheduled_wakeups_delivery_mode.sql" npm run migrate:dev`
Expected: applies cleanly. Requires the docker `postgres_db` container running.

- [ ] **Step 8: Verify re-running is a no-op**

Run the same command a second time.
Expected: succeeds with no error and no rows changed — the `IS NULL` guards and `IF NOT EXISTS` make it idempotent. This is the property that makes a direct-to-prod apply safe.

- [ ] **Step 9: Commit**

```bash
git add functions/drizzle/0028_scheduled_wakeups_delivery_mode.sql functions/scripts/migrationOrder.mjs functions/src/db/schema.ts functions/src/db/schema.test.ts cloud-agent/src/db/schema.ts
git commit -m "feat(scheduler): add delivery_mode and chosen_delivery_mode columns"
```

---

## Task 2: cloud-agent writes the mode columns

**Files:**

- Modify: `cloud-agent/src/handlers/proactiveWakeupHandler.ts:196-204`
- Test: `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`

**Interfaces:**

- Consumes: `scheduledWakeups.deliveryMode`, `scheduledWakeups.chosenDeliveryMode` (Task 1).
- Produces: `resolveWakeup` patch shape gains `deliveryMode: string` and `chosenDeliveryMode: string`.

- [ ] **Step 1: Write the failing test**

Append to `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`:

```ts
test('resolve records effective and chosen delivery modes as columns', async () => {
  const { deps, calls } = buildDeps({
    runAgent: async () => ({ reply: 'hi', toolCalls: [], deliveryMode: 'notify' }),
  })
  const handler = createProactiveWakeupHandler(deps)
  await handler(requestWith({ notifyAllowed: false }), fakeResponse())

  const resolved = calls.resolved[0] as {
    deliveryMode: string
    chosenDeliveryMode: string
    outcome: string
  }
  // notifyAllowed false clamps the effective mode down, but what the character
  // wanted must survive — it is the signal the rollout gate tunes against.
  assert.equal(resolved.deliveryMode, 'quiet')
  assert.equal(resolved.chosenDeliveryMode, 'notify')
  assert.equal(resolved.outcome, 'mode=quiet chosen=notify')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud-agent && npm test`
Expected: FAIL — `resolved.deliveryMode` is `undefined`.

- [ ] **Step 3: Widen the dep signature and write the columns**

In `cloud-agent/src/handlers/proactiveWakeupHandler.ts`, change the `resolveWakeup` dep type (around line 51) to:

```ts
    patch: {
      status: string
      spentAmount: number
      outcome: string
      deliveryMode?: string
      chosenDeliveryMode?: string
    },
```

Then change the success-path resolve (around line 200):

```ts
await deps.resolveWakeup(wakeupId, {
  status: 'done',
  spentAmount,
  // outcome is kept as-is: it is the human-readable audit trail and the
  // source the 0028 backfill parses. The columns are what code reads.
  outcome: `mode=${mode} chosen=${result.deliveryMode}`,
  deliveryMode: mode,
  chosenDeliveryMode: result.deliveryMode,
})
```

Leave every failure-path `resolveWakeup` call unchanged — those rows correctly have no delivery mode.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloud-agent && npm test`
Expected: PASS, 338 + 1 skip.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/proactiveWakeupHandler.ts cloud-agent/src/handlers/proactiveWakeupHandler.test.ts
git commit -m "feat(scheduler): record delivery modes as columns on resolve"
```

---

## Task 3: Cut todaysPushCount over to the column

**Files:**

- Modify: `functions/src/proactiveWakeupSweep.ts:188-197`
- Test: `functions/src/proactiveWakeupSweep.test.ts`

**Interfaces:**

- Consumes: `scheduledWakeups.deliveryMode` (Task 1).
- Produces: no signature change — `loadContext` still returns `todaysPushCount: number`.

- [ ] **Step 1: Write the failing test**

Append to `functions/src/proactiveWakeupSweep.test.ts`:

```ts
test('todaysPushCount follows the column, not the outcome text', async () => {
  // A row whose outcome text says notify but whose column disagrees must be
  // counted by the column. The column is the contract; outcome is prose.
  const rows = [
    { outcome: 'mode=notify chosen=notify', deliveryMode: 'quiet' },
    { outcome: 'mode=quiet chosen=notify', deliveryMode: 'notify' },
  ]
  const counted = rows.filter((r) => r.deliveryMode === 'notify')
  assert.equal(counted.length, 1)
  assert.equal(counted[0].outcome, 'mode=quiet chosen=notify')
})
```

> Note: `loadContext` builds its query against a live Drizzle handle, so the unit suite asserts the predicate choice rather than executing SQL. Query execution is covered by the local-database verification in Step 5.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — the assertion documents the intended behavior before the query changes.

- [ ] **Step 3: Replace the LIKE predicate**

In `functions/src/proactiveWakeupSweep.ts`, in the `pushRow` query, replace:

```ts
            like(scheduledWakeups.outcome, 'mode=notify%'),
```

with:

```ts
            eq(scheduledWakeups.deliveryMode, 'notify'),
```

Remove `like` from the `drizzle-orm` import if it is now unused; leave it if other queries still use it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS, 502/502.

- [ ] **Step 5: Verify against the local database**

Run: `cd functions && MIGRATIONS="0028_scheduled_wakeups_delivery_mode.sql" npm run migrate:dev` (idempotent), then `node scripts/proactiveTelemetry.mjs` against the local `CLOUD_SQL_*` env.
Expected: the clamp-rate query returns without error.

- [ ] **Step 6: Commit**

```bash
git add functions/src/proactiveWakeupSweep.ts functions/src/proactiveWakeupSweep.test.ts
git commit -m "feat(scheduler): count today's pushes from delivery_mode column"
```

---

## Task 4: Migration 0029 — messages.read_at and a real unread count

**Files:**

- Create: `functions/drizzle/0029_messages_read_at.sql`
- Modify: `functions/scripts/migrationOrder.mjs`
- Modify: `functions/src/db/schema.ts` (`messages`)
- Modify: `functions/src/services/proactiveWakeupGuardrails.ts` (new constant)
- Modify: `functions/src/proactiveWakeupSweep.ts` (`unreadProactiveCount`)
- Test: `functions/src/services/proactiveWakeupGuardrails.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `messages.readAt: timestamp | null`; `UNREAD_STALENESS_ESCAPE_MS: number` exported from `proactiveWakeupGuardrails.ts`.

- [ ] **Step 1: Write the migration SQL**

Create `functions/drizzle/0029_messages_read_at.sql`:

```sql
-- Proactive character scheduler Phase 2: server-authoritative read state.
--
-- proactiveWakeupGuardrails gates pushes on unreadProactiveCount === 0 — a
-- "don't nag someone who hasn't read the last one" rule. The sweeper evaluates
-- that with no device in the loop, so read state must be visible to the server.
-- Client-only read state could render a badge but could never feed the guardrail.
--
-- Nullable and additive; existing rows are correctly NULL (unread). Forward-only
-- runner: rollback is a new migration dropping the column.
--
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md

ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Partial index: the only query is "unread proactive messages for this
-- character", so indexing the read rows would be dead weight.
CREATE INDEX IF NOT EXISTS messages_character_unread_idx
  ON messages (character_id, created_at)
  WHERE read_at IS NULL;
```

- [ ] **Step 2: Register it**

Append to `MIGRATION_ORDER` in `functions/scripts/migrationOrder.mjs`:

```js
  '0029_messages_read_at.sql',
```

- [ ] **Step 3: Write the failing guardrail test**

Append to `functions/src/services/proactiveWakeupGuardrails.test.ts`:

```ts
import { UNREAD_STALENESS_ESCAPE_MS } from './proactiveWakeupGuardrails.js'

test('UNREAD_STALENESS_ESCAPE_MS is pinned to 7 days', () => {
  // Mirrored on the client in src/constants/proactive.ts. Both sides assert the
  // literal so drift fails a suite instead of silently disagreeing about who is
  // badged. Change one, change the other.
  assert.equal(UNREAD_STALENESS_ESCAPE_MS, 604_800_000)
})

test('an unread proactive message blocks notify', () => {
  const decision = decideWakeup({
    balance: 1000,
    todaysProactiveSpend: 0,
    todaysPushCount: 0,
    lastUserMessageAt: null,
    unreadProactiveCount: 1,
  })
  assert.equal(decision.run, true)
  assert.equal(decision.run && decision.notifyAllowed, false)
})

test('notify is allowed again once nothing is unread', () => {
  const decision = decideWakeup({
    balance: 1000,
    todaysProactiveSpend: 0,
    todaysPushCount: 0,
    lastUserMessageAt: null,
    unreadProactiveCount: 0,
  })
  assert.equal(decision.run && decision.notifyAllowed, true)
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — `UNREAD_STALENESS_ESCAPE_MS` is not exported.

- [ ] **Step 5: Add the constant and the schema field**

In `functions/src/services/proactiveWakeupGuardrails.ts`, alongside the other constants:

```ts
// A dropped markProactiveRead would otherwise leave the server believing the
// user is ignoring this character and suppress every future push from it —
// permanently, silently, with no user-visible symptom. After this long an
// unread message stops blocking. Mirrored in src/constants/proactive.ts.
export const UNREAD_STALENESS_ESCAPE_MS = 604_800_000
```

In `functions/src/db/schema.ts`, inside the `messages` column object after `messageData`:

```ts
    readAt: timestamp('read_at', { withTimezone: true }),
```

- [ ] **Step 6: Replace the hardcoded unread count**

In `functions/src/proactiveWakeupSweep.ts`, replace the `unreadProactiveCount: 0,` line and the comment above it. Add this query beside the `pushRow` query:

```ts
const staleCutoff = new Date(deps.now().getTime() - UNREAD_STALENESS_ESCAPE_MS)
const [unreadRow] = await db
  .select({ count: sql<number>`COUNT(*)::int` })
  .from(messages)
  .where(
    and(
      eq(messages.characterId, row.characterId),
      isNull(messages.readAt),
      // The staleness escape. Without it one lost mark-read mutes this
      // character forever.
      gte(messages.createdAt, staleCutoff),
      sql`${messages.messageData}->>'proactive' = 'true'`,
    ),
  )
```

and return `unreadProactiveCount: Number(unreadRow?.count ?? 0),`.

Add `isNull` to the `drizzle-orm` import and `UNREAD_STALENESS_ESCAPE_MS` to the guardrails import.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS, 505/505.

- [ ] **Step 8: Apply to the local database and verify idempotency**

Run: `cd functions && MIGRATIONS="0028_scheduled_wakeups_delivery_mode.sql,0029_messages_read_at.sql" npm run migrate:dev`
Run it a second time.
Expected: both runs succeed. Note the chained `MIGRATIONS` list — the ordering guard refuses a migration whose predecessors are unapplied.

- [ ] **Step 9: Commit**

```bash
git add functions/drizzle/0029_messages_read_at.sql functions/scripts/migrationOrder.mjs functions/src/db/schema.ts functions/src/services/proactiveWakeupGuardrails.ts functions/src/services/proactiveWakeupGuardrails.test.ts functions/src/proactiveWakeupSweep.ts
git commit -m "feat(scheduler): add messages.read_at and a real unread proactive count"
```

---

## Task 5: cloud-agent persists the proactive message

**Files:**

- Modify: `cloud-agent/src/handlers/proactiveWakeupHandler.ts`
- Test: `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`

**Interfaces:**

- Consumes: `messages.readAt` (Task 4).
- Produces: `deps.insertProactiveMessage(input: { messageId: string; characterId: string; senderUserId: string; text: string; createdAt: Date }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
test('a non-silent wake-up persists a proactive message row', async () => {
  const { deps, calls } = buildDeps({
    runAgent: async () => ({
      reply: 'How did the interview go?',
      toolCalls: [],
      deliveryMode: 'notify',
    }),
  })
  const handler = createProactiveWakeupHandler(deps)
  await handler(requestWith({ notifyAllowed: true }), fakeResponse())

  assert.equal(calls.insertedMessages.length, 1)
  const row = calls.insertedMessages[0]
  assert.equal(row.text, 'How did the interview go?')
  // sender_user_id means "whose conversation", not "who authored" — matching
  // generateReply. Account deletion sweeps by this column.
  assert.equal(row.senderUserId, 'user-1')
  assert.ok(row.messageId.length > 0)
})

test('a silent wake-up persists nothing', async () => {
  const { deps, calls } = buildDeps({
    runAgent: async () => ({ reply: '', toolCalls: [], deliveryMode: 'silent' }),
  })
  const handler = createProactiveWakeupHandler(deps)
  await handler(requestWith({ notifyAllowed: true }), fakeResponse())

  assert.equal(calls.insertedMessages.length, 0)
})
```

Add `insertedMessages` to `buildDeps`, collecting from an `insertProactiveMessage` stub.

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm test`
Expected: FAIL — `calls.insertedMessages` is undefined.

- [ ] **Step 3: Implement**

Add to `ProactiveWakeupDeps`:

```ts
insertProactiveMessage: (input: {
  messageId: string
  characterId: string
  senderUserId: string
  text: string
  createdAt: Date
}) => Promise<void>
```

In the handler, after `const mode = resolveDeliveryMode(...)` and before the resolve:

```ts
// 'silent' means the character decided there was nothing worth saying.
// Persisting an empty row would badge the user for nothing.
if (mode !== 'silent' && result.reply.trim().length > 0) {
  await deps.insertProactiveMessage({
    messageId: randomUUID(),
    characterId,
    senderUserId: userId,
    text: result.reply,
    createdAt: new Date(),
  })
}
```

Import `randomUUID` from `node:crypto`.

Wire the real implementation where the other deps are constructed, inserting into `messages` with `messageData` set to `{ proactive: true }` — the marker the Task 4 unread query reads — and `readAt` left NULL.

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud-agent && npm test`
Expected: PASS, 340 + 1 skip.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/proactiveWakeupHandler.ts cloud-agent/src/handlers/proactiveWakeupHandler.test.ts
git commit -m "feat(scheduler): persist proactive messages server-side"
```

---

## Task 6: sendCharacterProactive

**Files:**

- Modify: `cloud-agent/src/services/fcmDispatcher.ts:87-101`
- Modify: `cloud-agent/src/handlers/proactiveWakeupHandler.ts`
- Test: `cloud-agent/src/services/fcmDispatcher.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `sendCharacterProactive(expoPushToken: string, characterId: string, messageId: string, characterName: string, body: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
test('sendCharacterProactive deeplinks to the character, not /talk', async () => {
  const sent: Array<Record<string, unknown>> = []
  const dispatcher = createFcmDispatcher(fakeMessaging(sent))
  await dispatcher.sendCharacterProactive('tok', 'char-1', 'msg-1', 'Ada', 'How did it go?')

  const push = sent[0]
  assert.equal(push.title, 'Ada')
  assert.equal(push.body, 'How did it go?')
  assert.equal((push.data as Record<string, string>).type, 'PROACTIVE_CHARACTER_MESSAGE')
  assert.equal((push.data as Record<string, string>).deepLink, '/chat/char-1')
  // BROWSER_ACTION_APPROVAL belongs to the browser agent. Offering an approval
  // affordance for an action that does not exist would be a live bug.
  assert.equal(push.categoryIdentifier, undefined)
})

test('sendCharacterProactive truncates a long body', async () => {
  const sent: Array<Record<string, unknown>> = []
  const dispatcher = createFcmDispatcher(fakeMessaging(sent))
  await dispatcher.sendCharacterProactive('tok', 'c', 'm', 'Ada', 'x'.repeat(400))

  assert.equal((sent[0].body as string).length, 140)
  assert.ok((sent[0].body as string).endsWith('…'))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm test`
Expected: FAIL — `dispatcher.sendCharacterProactive is not a function`.

- [ ] **Step 3: Implement**

Add `PUSH_BODY_MAX_LENGTH` and the method to `createFcmDispatcher`, beside `sendProactive`:

```ts
    async sendCharacterProactive(
      expoPushToken: string,
      characterId: string,
      messageId: string,
      characterName: string,
      body: string,
    ): Promise<void> {
      // The model writes this body and its length is unbounded.
      const preview =
        body.length > PUSH_BODY_MAX_LENGTH ? `${body.slice(0, PUSH_BODY_MAX_LENGTH - 1)}…` : body

      await expoPush({
        to: expoPushToken,
        // The character's own name — a generic system title would read as a nag
        // and defeat the point of a proactive character.
        title: characterName,
        body: preview,
        // Push is a hint to sync, never the carrier: messageId lets the client
        // confirm it has the row, but a dropped push costs only timeliness.
        data: {
          type: 'PROACTIVE_CHARACTER_MESSAGE',
          characterId,
          messageId,
          deepLink: `/chat/${characterId}`,
        },
        priority: 'high',
      })
    },
```

Define `const PUSH_BODY_MAX_LENGTH = 140` at module scope.

- [ ] **Step 4: Call it from the handler**

In `proactiveWakeupHandler.ts`, after the message insert:

```ts
if (mode === 'notify' && character.expoPushToken) {
  // Never let a push failure fail the wake-up: the message is already
  // persisted and will arrive on next sync regardless.
  await deps.fcmDispatcher
    .sendCharacterProactive(
      character.expoPushToken,
      characterId,
      messageId,
      character.name,
      result.reply,
    )
    .catch((err: unknown) => {
      console.warn('[proactive-wakeup] push failed:', err)
    })
}
```

Hoist `messageId` out of the insert block so it is in scope here.

- [ ] **Step 5: Run to verify it passes**

Run: `cd cloud-agent && npm test`
Expected: PASS, 342 + 1 skip.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/services/fcmDispatcher.ts cloud-agent/src/services/fcmDispatcher.test.ts cloud-agent/src/handlers/proactiveWakeupHandler.ts
git commit -m "feat(scheduler): add character-specific proactive push"
```

---

## Task 7: fetchProactiveMessages callable

**Files:**

- Create: `functions/src/proactiveMessages.ts`
- Create: `functions/src/proactiveMessages.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**

- Consumes: `messages.readAt` (Task 4).
- Produces: `fetchProactiveMessagesHandler(request, deps)` returning `{ messages: ProactiveMessagePayload[]; nextCursor: { createdAt: string; messageId: string } | null }` where `ProactiveMessagePayload = { messageId: string; characterId: string; text: string; createdAt: string; readAt: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchProactiveMessagesHandler } from './proactiveMessages.js'

test('rejects unauthenticated calls', async () => {
  await assert.rejects(
    () => fetchProactiveMessagesHandler({ data: {} } as never, buildDeps()),
    /unauthenticated/,
  )
})

test('returns only the caller own messages', async () => {
  const deps = buildDeps({
    selectProactiveMessages: async ({ userId }: { userId: string }) => {
      assert.equal(userId, 'user-1')
      return [msgRow({ messageId: 'm1' })]
    },
  })
  const result = await fetchProactiveMessagesHandler(authedRequest({}), deps)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].messageId, 'm1')
})

test('pagination does not skip rows sharing a created_at', async () => {
  // SWEEP_BATCH_LIMIT is 50, so the sweeper resolves batches together and
  // identical millisecond timestamps are expected, not hypothetical. A bare
  // timestamp cursor would drop the second row at a page boundary.
  const same = new Date('2026-09-08T12:00:00.000Z')
  const deps = buildDeps({
    selectProactiveMessages: async ({ cursor }: { cursor: unknown }) => {
      if (!cursor) return [msgRow({ messageId: 'a', createdAt: same })]
      assert.deepEqual(cursor, { createdAt: same, messageId: 'a' })
      return [msgRow({ messageId: 'b', createdAt: same })]
    },
  })

  const first = await fetchProactiveMessagesHandler(authedRequest({}), deps)
  assert.equal(first.nextCursor?.messageId, 'a')

  const second = await fetchProactiveMessagesHandler(
    authedRequest({
      sinceCreatedAt: first.nextCursor!.createdAt,
      sinceMessageId: first.nextCursor!.messageId,
    }),
    deps,
  )
  assert.equal(second.messages[0].messageId, 'b')
})

test('caps the page size', async () => {
  const deps = buildDeps({
    selectProactiveMessages: async ({ limit }: { limit: number }) => {
      assert.equal(limit, 100)
      return []
    },
  })
  await fetchProactiveMessagesHandler(authedRequest({ limit: 5000 }), deps)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — module `./proactiveMessages.js` not found.

- [ ] **Step 3: Implement**

Create `functions/src/proactiveMessages.ts`, following the `syncCharacterImages` pattern (`onCall` wrapper plus an exported handler taking injectable deps):

```ts
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

export const PROACTIVE_SYNC_PAGE_LIMIT = 100

export const fetchProactiveMessages = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => fetchProactiveMessagesHandler(request),
)

export const fetchProactiveMessagesHandler = async (
  request: CallableRequest,
  deps: ProactiveMessageDeps = defaultDeps,
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }
  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  const data = isRecord(request.data) ? request.data : {}
  const { sinceCreatedAt, sinceMessageId, limit } = data as {
    sinceCreatedAt?: unknown
    sinceMessageId?: unknown
    limit?: unknown
  }

  // The cursor is only honoured when BOTH halves are present. A lone timestamp
  // has no total order, which is the defect the tiebreak exists to prevent.
  const cursor =
    typeof sinceCreatedAt === 'string' && typeof sinceMessageId === 'string'
      ? { createdAt: new Date(sinceCreatedAt), messageId: sinceMessageId }
      : null

  if (cursor && Number.isNaN(cursor.createdAt.getTime())) {
    throw new HttpsError('invalid-argument', 'sinceCreatedAt must be an ISO timestamp.')
  }

  const pageSize =
    typeof limit === 'number' && limit > 0
      ? Math.min(limit, PROACTIVE_SYNC_PAGE_LIMIT)
      : PROACTIVE_SYNC_PAGE_LIMIT

  // The character set is derived server-side. The client never names a
  // character it then gets trusted about.
  const rows = await deps.selectProactiveMessages({ userId: user.id, cursor, limit: pageSize })

  const last = rows[rows.length - 1]
  return {
    messages: rows.map((row) => ({
      messageId: row.messageId,
      characterId: row.characterId,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    })),
    nextCursor: last
      ? { createdAt: last.createdAt.toISOString(), messageId: last.messageId }
      : null,
  }
}
```

The `selectProactiveMessages` implementation queries `messages` joined to `characters` on the owning user, filtered to `message_data->>'proactive' = 'true'`, with:

```sql
WHERE (created_at > $cursorCreatedAt
   OR (created_at = $cursorCreatedAt AND message_id > $cursorMessageId))
ORDER BY created_at ASC, message_id ASC
LIMIT $limit
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test`
Expected: PASS, 509/509.

- [ ] **Step 5: Export the callable**

In `functions/src/index.ts`:

```ts
export { fetchProactiveMessages } from './proactiveMessages.js'
```

- [ ] **Step 6: Commit**

```bash
git add functions/src/proactiveMessages.ts functions/src/proactiveMessages.test.ts functions/src/index.ts
git commit -m "feat(scheduler): add account-wide fetchProactiveMessages callable"
```

---

## Task 8: markProactiveRead callable

**Files:**

- Modify: `functions/src/proactiveMessages.ts`
- Modify: `functions/src/proactiveMessages.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**

- Consumes: `ProactiveMessageDeps` (Task 7).
- Produces: `markProactiveReadHandler(request, deps)` returning `{ updated: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('markProactiveRead sets read_at only for the caller messages', async () => {
  const deps = buildDeps({
    markRead: async ({ userId, messageIds }: { userId: string; messageIds: string[] }) => {
      assert.equal(userId, 'user-1')
      assert.deepEqual(messageIds, ['m1', 'm2'])
      return 2
    },
  })
  const result = await markProactiveReadHandler(authedRequest({ messageIds: ['m1', 'm2'] }), deps)
  assert.equal(result.updated, 2)
})

test('markProactiveRead is idempotent', async () => {
  // Only ever NULL -> timestamp. A second call updates nothing and must not
  // error: the client retries, so a repeat is the expected case.
  const deps = buildDeps({ markRead: async () => 0 })
  const result = await markProactiveReadHandler(authedRequest({ messageIds: ['m1'] }), deps)
  assert.equal(result.updated, 0)
})

test('markProactiveRead rejects unauthenticated calls', async () => {
  await assert.rejects(
    () => markProactiveReadHandler({ data: { messageIds: ['m1'] } } as never, buildDeps()),
    /unauthenticated/,
  )
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — `markProactiveReadHandler` is not exported.

- [ ] **Step 3: Implement**

```ts
export const markProactiveRead = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => markProactiveReadHandler(request),
)

export const markProactiveReadHandler = async (
  request: CallableRequest,
  deps: ProactiveMessageDeps = defaultDeps,
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }
  const data = isRecord(request.data) ? request.data : {}
  const { messageIds } = data as { messageIds?: unknown }

  if (!Array.isArray(messageIds) || messageIds.some((id) => typeof id !== 'string')) {
    throw new HttpsError('invalid-argument', 'messageIds must be an array of strings.')
  }
  if (messageIds.length === 0) {
    return { updated: 0 }
  }
  if (messageIds.length > PROACTIVE_SYNC_PAGE_LIMIT) {
    throw new HttpsError(
      'invalid-argument',
      `messageIds may contain at most ${PROACTIVE_SYNC_PAGE_LIMIT} entries.`,
    )
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  const updated = await deps.markRead({ userId: user.id, messageIds: messageIds as string[] })
  return { updated }
}
```

`markRead` runs `UPDATE messages SET read_at = now() WHERE message_id = ANY($ids) AND read_at IS NULL` scoped to characters owned by `userId`, returning the row count. The `read_at IS NULL` guard keeps the write one-directional.

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test`
Expected: PASS, 512/512.

- [ ] **Step 5: Export it**

```ts
export { fetchProactiveMessages, markProactiveRead } from './proactiveMessages.js'
```

- [ ] **Step 6: Commit**

```bash
git add functions/src/proactiveMessages.ts functions/src/proactiveMessages.test.ts functions/src/index.ts
git commit -m "feat(scheduler): add markProactiveRead callable"
```

---

## Task 9: Client local schema — read_at and sync_state

**Files:**

- Modify: `src/database/schema.ts`
- Create: `src/database/syncState.ts`
- Create: `src/constants/proactive.ts`
- Test: `src/database/__tests__/syncState.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `getSyncCursor(key: string): Promise<{ createdAt: string; messageId: string } | null>`; `setSyncCursor(key, cursor, db?): Promise<void>`; `UNREAD_STALENESS_ESCAPE_MS: number`.

- [ ] **Step 1: Write the failing test**

Create `src/database/__tests__/syncState.test.ts`:

```ts
import { UNREAD_STALENESS_ESCAPE_MS } from '../../constants/proactive'

describe('proactive constants', () => {
  it('mirrors the server staleness escape exactly', () => {
    // Mirrored from functions/src/services/proactiveWakeupGuardrails.ts. The
    // server stops counting a stale unread message; the client must stop
    // badging it at the same moment or the dot outlives the guardrail.
    expect(UNREAD_STALENESS_ESCAPE_MS).toBe(604_800_000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/database/__tests__/syncState.test.ts`
Expected: FAIL — cannot resolve `../../constants/proactive`.

- [ ] **Step 3: Add the local migrations**

In `src/database/schema.ts`, append to the numbered migration map after entry `24`:

```ts
  25: `ALTER TABLE messages ADD COLUMN read_at INTEGER;`,
  26: `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY NOT NULL,
    cursor_created_at TEXT,
    cursor_message_id TEXT,
    updated_at INTEGER NOT NULL
  );`,
```

Also add `read_at INTEGER` to the `CREATE TABLE IF NOT EXISTS messages` block (around line 113) so a fresh install and a migrated install converge, and add the `sync_state` create to the base schema for the same reason.

- [ ] **Step 4: Create the constant and the cursor helpers**

`src/constants/proactive.ts`:

```ts
// Mirrored from functions/src/services/proactiveWakeupGuardrails.ts.
// Both sides assert the literal in a test so drift fails a suite rather than
// silently disagreeing about which messages are badged.
export const UNREAD_STALENESS_ESCAPE_MS = 604_800_000

export const PROACTIVE_SYNC_CURSOR_KEY = 'proactive_messages'
```

`src/database/syncState.ts` implements `getSyncCursor` and `setSyncCursor` against `sync_state`. `setSyncCursor` accepts an optional database handle so it can join a caller's transaction — Task 10 depends on this.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/database/__tests__/syncState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/database/schema.ts src/database/syncState.ts src/constants/proactive.ts src/database/__tests__/syncState.test.ts
git commit -m "feat(scheduler): add local read_at column and sync cursor storage"
```

---

## Task 10: Two-phase local apply, inside one transaction

**Files:**

- Modify: `src/database/messageDatabase.ts`
- Create: `src/services/proactiveSync.ts`
- Test: `src/database/__tests__/messageDatabase.proactive.test.ts`

**Interfaces:**

- Consumes: `setSyncCursor` (Task 9), the `fetchProactiveMessages` payload (Task 7).
- Produces: `applyProactiveMessages(payload: ProactiveMessagePayload[]): Promise<void>`; `countUnreadProactive(characterId: string, nowMs: number): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('applyProactiveMessages', () => {
  it('does not clobber an existing local row', async () => {
    await insertLocal({ id: 'm1', text: 'local text', pending: 1 })
    await applyProactiveMessages([payload({ messageId: 'm1', text: 'server text' })])

    const row = await getLocal('m1')
    // INSERT OR IGNORE, not OR REPLACE: OR REPLACE would silently reset
    // pending/sent/error on every re-sync.
    expect(row.text).toBe('local text')
    expect(row.pending).toBe(1)
  })

  it('applies read_at to a row it already has', async () => {
    await insertLocal({ id: 'm1', read_at: null })
    await applyProactiveMessages([payload({ messageId: 'm1', readAt: '2026-09-08T12:00:00.000Z' })])

    expect((await getLocal('m1')).read_at).toBe(Date.parse('2026-09-08T12:00:00.000Z'))
  })

  it('never clears a read_at that is already set', async () => {
    await insertLocal({ id: 'm1', read_at: 1_700_000_000_000 })
    await applyProactiveMessages([payload({ messageId: 'm1', readAt: null })])

    // The update is one-directional (AND read_at IS NULL) so an out-of-order
    // page cannot resurrect a cleared badge.
    expect((await getLocal('m1')).read_at).toBe(1_700_000_000_000)
  })

  it('inserts a row it does not have', async () => {
    await applyProactiveMessages([payload({ messageId: 'new', text: 'hello' })])
    expect((await getLocal('new')).text).toBe('hello')
  })
})

describe('countUnreadProactive', () => {
  it('ignores messages past the staleness escape', async () => {
    const now = Date.parse('2026-09-08T00:00:00.000Z')
    await insertLocal({
      id: 'old',
      read_at: null,
      created_at: now - UNREAD_STALENESS_ESCAPE_MS - 1,
    })
    await insertLocal({ id: 'new', read_at: null, created_at: now - 1000 })

    expect(await countUnreadProactive('char-1', now)).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/database/__tests__/messageDatabase.proactive.test.ts`
Expected: FAIL — `applyProactiveMessages` is not exported.

- [ ] **Step 3: Implement the two-phase apply**

In `src/database/messageDatabase.ts`:

```ts
export async function applyProactiveMessages(payload: ProactiveMessagePayload[]): Promise<void> {
  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const msg of payload) {
      // Phase 1: the server's message_id is the local primary key, so dedupe is
      // structural. IGNORE guarantees the sync can never overwrite local state.
      await db.runAsync(
        `INSERT OR IGNORE INTO messages
         (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited, synced_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, ?, ?)`,
        [
          msg.messageId,
          msg.characterId,
          msg.characterId,
          null,
          msg.text,
          Date.parse(msg.createdAt),
          JSON.stringify({ proactive: true }),
          Date.parse(msg.createdAt),
          msg.readAt ? Date.parse(msg.readAt) : null,
        ],
      )

      // Phase 2: IGNORE skipped rows this device already had, so read state
      // from another device would never arrive without this. One column only,
      // and only NULL -> timestamp.
      if (msg.readAt) {
        await db.runAsync(`UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL`, [
          Date.parse(msg.readAt),
          msg.messageId,
        ])
      }
    }
  })
}

export async function countUnreadProactive(characterId: string, nowMs: number): Promise<number> {
  const db = await getDatabase()
  // Mirrors the server's staleness escape so the badge and the push guardrail
  // agree about which messages still count.
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM messages
      WHERE character_id = ? AND read_at IS NULL AND created_at > ?
        AND json_extract(message_data, '$.proactive') = 1`,
    [characterId, nowMs - UNREAD_STALENESS_ESCAPE_MS],
  )
  return row?.count ?? 0
}
```

- [ ] **Step 4: Create the sync orchestrator**

`src/services/proactiveSync.ts` calls `fetchProactiveMessages` with the stored cursor, calls `applyProactiveMessages`, and advances the cursor **inside the same transaction as the inserts** — so a crash mid-page rolls the cursor back alongside the messages and no message is skipped. It loops while `nextCursor` is non-null.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/database/__tests__/messageDatabase.proactive.test.ts`
Expected: PASS, all 5.

- [ ] **Step 6: Commit**

```bash
git add src/database/messageDatabase.ts src/services/proactiveSync.ts src/database/__tests__/messageDatabase.proactive.test.ts
git commit -m "feat(scheduler): apply proactive messages to local SQLite in two phases"
```

---

## Task 11: Retried mark-read

**Files:**

- Create: `src/services/proactiveReadQueue.ts`
- Test: `src/services/__tests__/proactiveReadQueue.test.ts`

**Interfaces:**

- Consumes: `markProactiveRead` callable (Task 8).
- Produces: `enqueueMarkRead(messageIds: string[]): Promise<void>`; `flushMarkReadQueue(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('proactive read queue', () => {
  it('retries a failed mark-read instead of dropping it', async () => {
    let attempts = 0
    const call = jest.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('network')
      return { updated: 1 }
    })

    await enqueueMarkRead(['m1'], call)
    await flushMarkReadQueue(call)

    // A dropped mark-read leaves the server believing the user is ignoring this
    // character and suppresses every future push from it, silently.
    expect(attempts).toBe(2)
  })

  it('clears the queue once the call succeeds', async () => {
    const call = jest.fn(async () => ({ updated: 1 }))
    await enqueueMarkRead(['m1'], call)
    await flushMarkReadQueue(call)
    await flushMarkReadQueue(call)

    expect(call).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/services/__tests__/proactiveReadQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Persist pending ids in the `sync_state` table from Task 9 (a `mark_read_pending` key) so the queue survives an app restart, drain on success, and retry on the next flush. Flush on app foreground and after each successful sync.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/services/__tests__/proactiveReadQueue.test.ts`
Expected: PASS, both.

- [ ] **Step 5: Commit**

```bash
git add src/services/proactiveReadQueue.ts src/services/__tests__/proactiveReadQueue.test.ts
git commit -m "feat(scheduler): retry markProactiveRead instead of dropping it"
```

---

## Task 12: The badge

**Files:**

- Create: `src/hooks/useProactiveUnread.ts`
- Test: `src/hooks/__tests__/useProactiveUnread.test.tsx`

**Interfaces:**

- Consumes: `countUnreadProactive` (Task 10), `UNREAD_STALENESS_ESCAPE_MS` (Task 9).
- Produces: `useProactiveUnread(characterId: string): { hasUnread: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
describe('useProactiveUnread', () => {
  it('reports a dot, not a count', async () => {
    mockCountUnreadProactive.mockResolvedValue(7)
    const { result } = renderHook(() => useProactiveUnread('char-1'), { wrapper })
    await waitFor(() => expect(result.current.hasUnread).toBe(true))
    // Deliberately boolean: AI chats are not an inbox, and a numeric count
    // reads as a backlog to clear.
    expect(result.current).not.toHaveProperty('count')
  })

  it('drops the dot once everything is read', async () => {
    mockCountUnreadProactive.mockResolvedValue(0)
    const { result } = renderHook(() => useProactiveUnread('char-1'), { wrapper })
    await waitFor(() => expect(result.current.hasUnread).toBe(false))
  })
})
```

React Query tests in this repo need `gcTime: 0` in the test client.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/hooks/__tests__/useProactiveUnread.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A `useQuery` over `countUnreadProactive(characterId, Date.now())`, returning `{ hasUnread: count > 0 }`. Wire it into the character list row.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/hooks/__tests__/useProactiveUnread.test.tsx`
Expected: PASS, both.

- [ ] **Step 5: Run the full root suite**

Run: `npm test`
Expected: PASS, no regression against the 158 suites / 1441 tests baseline.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProactiveUnread.ts src/hooks/__tests__/useProactiveUnread.test.tsx
git commit -m "feat(scheduler): badge characters with unread proactive messages"
```

---

## Task 13: Verification and rollout

**Files:** none — this task produces evidence, not code.

- [ ] **Step 1: Run every suite**

```bash
cd functions && npm test
cd ../cloud-agent && npm test
cd .. && npm test
```

Expected: `functions` 512/512; `cloud-agent` 342 + 1 skip; root 158 suites / 1441 tests plus the new ones. Record the real numbers — do not assume.

- [ ] **Step 2: Typecheck and format**

```bash
npx tsc --noEmit
npx prettier --check .
```

`functions/scripts/migrationOrder.mjs` is a known pre-existing prettier failure. Any _other_ failure is yours.

- [ ] **Step 3: Verify the constant mirror**

```bash
grep -rn "604_800_000" functions/src/services/proactiveWakeupGuardrails.ts src/constants/proactive.ts
```

Expected: both hits present and equal.

- [ ] **Step 4: THE ROLLOUT GATE**

```bash
cd functions && node scripts/proactiveTelemetry.mjs
```

Review the clamp rate and skip-reason distribution. **Stop and report to the user** with a recommendation on `DAILY_PROACTIVE_POWER_CEILING`, `PROACTIVE_NOTIFY_COOLDOWN_MS` and `MAX_PROACTIVE_PUSHES_PER_DAY`. Do not ship a user-visible push build before this conversation happens.

- [ ] **Step 5: Apply migrations to production**

Back up first, then apply the chain:

```bash
cd functions && MIGRATIONS="0028_scheduled_wakeups_delivery_mode.sql,0029_messages_read_at.sql" npm run deploy:migrations
```

Confirm both rows land in `schema_migrations`. Do not use `LIKE '002[89]%'` to check — `LIKE` has no character classes and will return empty, which looks like failure.

- [ ] **Step 6: Deploy and confirm traffic**

Deploy `functions` and `cloud-agent`, then confirm the new cloud-agent revision is serving **100%** of traffic. A healthy revision serving 0% has gone unnoticed here for eleven days before.

- [ ] **Step 7: Open the PR**

Target `staging`, never `main`.

---

## Self-Review

**Spec coverage.** Every spec deliverable maps to a task: migration `0028` → Task 1; the two-writer cutover → Tasks 2–3; migration `0029` + real `unreadProactiveCount` → Task 4; server-side message persistence → Task 5; `sendCharacterProactive` → Task 6; `fetchProactiveMessages` → Task 7; `markProactiveRead` → Task 8; local schema + cursor → Task 9; two-phase apply → Task 10; retry → Task 11; badge → Task 12; rollout gate → Task 13.

**Resolved open questions**, now decided and built in: badge is a boolean dot (Task 12); push previews the message text, truncated at 140 (Task 6); the cursor lives in local SQLite and advances in the same transaction as the inserts (Tasks 9–10); the 7-day escape clears the badge via a client-side mirror of the constant rather than a falsified `read_at` (Tasks 4, 9, 10).

**Type consistency.** `ProactiveMessagePayload` is produced in Task 7 and consumed unchanged in Task 10. `deliveryMode`/`chosenDeliveryMode` are named identically in both packages' schemas (Task 1), the handler patch (Task 2), and the sweep query (Task 3). `UNREAD_STALENESS_ESCAPE_MS` is the same identifier and literal on both sides (Tasks 4, 9).

**Known deliberate duplication.** `UNREAD_STALENESS_ESCAPE_MS` exists in two packages with no shared module between them. Both assert the literal in a test so drift fails a suite.
