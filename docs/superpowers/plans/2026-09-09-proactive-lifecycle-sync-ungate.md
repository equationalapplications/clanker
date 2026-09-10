# Proactive Lifecycle-Sync Wiring (un-gate deferred) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the built-but-unwired proactive client half (sync triggers, deeplink routing, optimistic mark-read, badge) and move the wakeup producer onto the edge hot path (`scheduleWakeup` callable + edge executor), with `PROACTIVE_PUSH_ENABLED` staying `false` (un-gate deferred per Decision 6).

**Architecture:** Three layers land together, behavior-neutral for push: (1) `functions` gains a `scheduleWakeup` callable mirroring cloud-agent's `set_reminder` semantics, plus migration `0030` adding `users.proactive_push_ready`; (2) cloud-agent selects that flag and gates `sendCharacterProactive` on it (unreachable until the eventual un-gate because the global gate stays closed); (3) the Expo client executes `set_reminder` locally against the new callable and mounts the sync/routing hooks, the durable read queue, and the restored unread dot.

**Tech Stack:** Firebase Functions v2 (node:test, run from built `lib/`), cloud-agent (Express + Drizzle, node:test from built `dist/`), Expo 57 / React Native / expo-router / React Query at the root (Jest).

**Spec:** `docs/superpowers/specs/2026-09-09-proactive-lifecycle-sync-ungate-design.md`

## Global Constraints

- **`PROACTIVE_PUSH_ENABLED` stays `false`.** It is a module-local `const` in `cloud-agent/src/handlers/proactiveWakeupHandler.ts:87`, NOT an env var. Do not flip it, do not remove the `'gate'` clamp branch, do not change the two flip tests (`'gates notify off while the client sync is unwired'`, `'does not push while the gate is closed, even on the happy path'`).
  - **Spec inconsistency, resolved:** the spec's Testing section says "the flip test now expects `notify`", but Decision 6 and the Non-goals both say the flag stays `false` in this branch. Decision 6 wins (it is the amended, later intent per commit `9078342b`). The flip tests stay as-is.
- **Guardrail constants unchanged:** `DAILY_PROACTIVE_POWER_CEILING = 500`, `PROACTIVE_NOTIFY_COOLDOWN_MS`, `MAX_PROACTIVE_PUSHES_PER_DAY` ship as-is.
- **`functions` and `cloud-agent` cannot share code** (neither depends on the other). Duplicated logic/constants get the established "Mirrors … keep the values/shape equal" comment (see `cloud-agent/src/tools/reminders.ts:11-12`).
- **Migrations are hand-written** SQL files in `functions/drizzle/` (next index: `0030`), registered by appending to `MIGRATION_ORDER` in `functions/scripts/migrationOrder.mjs`. Never run `drizzle-kit generate`. cloud-agent has NO migration directory — the SQL lives only in `functions/drizzle/`; the Drizzle column is declared in BOTH `functions/src/db/schema.ts` and `cloud-agent/src/db/schema.ts`.
- **Platform pins:** Expo 57 + Node 24 + TS 6. Never `npm audit fix`, never regenerate `package-lock.json` wholesale.
- **Per-package test runners:** `functions` and `cloud-agent` use `node:test` run from built output (`npm test` = build + `node --test`); root uses Jest, filtered with `npx jest <path>` (`npm test -- <path>` does NOT filter). Root react-query tests MUST use `gcTime: 0`.
- **Baselines to hold or beat** (measure fresh before the PR): functions 522, cloud-agent 348 + 1 skip, root 158 suites / 1441 tests.
- **CI hygiene:** check steps are `:check`, never `--write`/`--fix`. Formatting fixes never share a commit with logic changes.
- **Branch/PR:** work happens on `feat/proactive-lifecycle-sync`; the PR targets `staging`. The user merges — never assume a merge.
- **Every commit ends with:** `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- **Deploys go straight to production** and happen after merge, not in this branch's tasks. Both deploys are behavior-neutral for push (gate closed, flag defaults `false`). After deploying, verify the new revision actually took traffic per the 0%-traffic-anomaly playbook.

## File Structure (what lands where)

| Layer       | Create                                                                                                                                                                                                                                  | Modify                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| functions   | `src/scheduleWakeup.ts` + `.test.ts`, `drizzle/0030_users_proactive_push_ready.sql`                                                                                                                                                     | `src/db/schema.ts`, `src/registerExpoPushToken.ts` + `.test.ts`, `src/index.ts`, `scripts/migrationOrder.mjs`                                                                                                                                                                                                                                                                                    |
| cloud-agent | —                                                                                                                                                                                                                                       | `src/db/schema.ts`, `src/index.ts` (loadCharacter), `src/handlers/proactiveWakeupHandler.ts` + `.test.ts`                                                                                                                                                                                                                                                                                        |
| shared      | —                                                                                                                                                                                                                                       | `shared/agent-tools-spec.ts`                                                                                                                                                                                                                                                                                                                                                                     |
| client root | `src/services/proactiveWakeupService.ts`, `src/services/proactiveMarkReadService.ts`, `src/hooks/useProactiveSync.ts`, `src/hooks/useProactiveNotificationRouting.ts`, `src/hooks/useMarkProactiveReadOnOpen.ts` + `__tests__` for each | `src/services/edgeToolExecutors.ts` + test, `src/hooks/useEdgeAgent.ts` + test, `src/hooks/useAIChat.ts`, `src/hooks/useRegisterExpoPushToken.ts`, `src/database/messageDatabase.ts` + proactive test, `src/services/proactiveReadQueue.ts` + test, `src/components/ChatView.tsx` + test, `src/components/CharacterCard.tsx`, `__tests__/characterCardAccessibility.test.tsx`, `app/_layout.tsx` |

---

### Task 1: Migration `0030_users_proactive_push_ready` + both schema declarations

**Files:**

- Create: `functions/drizzle/0030_users_proactive_push_ready.sql`
- Modify: `functions/scripts/migrationOrder.mjs` (append to `MIGRATION_ORDER`)
- Modify: `functions/src/db/schema.ts` (users table, after `expoPushToken`, ~line 31)
- Modify: `cloud-agent/src/db/schema.ts` (users table, after `expoPushToken`, ~line 28)

**Interfaces:**

- Consumes: nothing.
- Produces: `users.proactivePushReady: boolean('proactive_push_ready').notNull().default(false)` present in both Drizzle schemas; DB column `users.proactive_push_ready boolean NOT NULL DEFAULT false`. Later tasks read/write it via Drizzle only — no raw SQL elsewhere.

- [ ] **Step 1: Write the migration SQL**

`functions/drizzle/0030_users_proactive_push_ready.sql`:

```sql
-- Proactive lifecycle-sync: per-user push-readiness capability (Decision 1).
--
-- The global PROACTIVE_PUSH_ENABLED gate is a blunt instrument: flipping it
-- fires pushes at every client that ever registered a token, including clients
-- that cannot sync, badge, or deeplink. This column records whether the device
-- that owns the CURRENT token (single-token per user, last device wins) is a
-- new client: registerExpoPushToken writes it explicitly in both directions
-- (true when capabilities.proactivePush === true, false otherwise), so readiness
-- arrives exactly when a capable client registers and a downgrade undoes it.
-- It gates only the notification — quiet messages persist and sync regardless.
--
-- Additive with a default; forward-only runner, rollback is a new migration.
-- Fleet-wide kill switch without a deploy: UPDATE users SET
-- proactive_push_ready = false.
--
-- Spec: docs/superpowers/specs/2026-09-09-proactive-lifecycle-sync-ungate-design.md

ALTER TABLE users ADD COLUMN IF NOT EXISTS proactive_push_ready boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Register it in `MIGRATION_ORDER`**

Append `'0030_users_proactive_push_ready.sql',` after `'0029_messages_read_at.sql',` in the `MIGRATION_ORDER` array in `functions/scripts/migrationOrder.mjs`.

- [ ] **Step 3: Declare the column in both Drizzle schemas**

In BOTH `functions/src/db/schema.ts` and `cloud-agent/src/db/schema.ts`, inside `export const users = pgTable('users', {...})`, immediately after the `expoPushToken` line:

```ts
  proactivePushReady: boolean('proactive_push_ready').notNull().default(false),
```

(`boolean` is already imported in both files — `isProfilePublic` uses it in functions; cloud-agent imports it for other tables. If not, add it to the drizzle-orm import.)

- [ ] **Step 4: Typecheck both packages**

Run: `cd functions && npx tsc --noEmit && cd ../cloud-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Apply locally and verify the column** (requires the local docker Postgres running — see `docker-compose.local.yml`; if it is not running, start it first)

Run: `cd functions && MIGRATIONS=0030_users_proactive_push_ready.sql npm run migrate-dev`
Then verify against the local DB (psql or a script):

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'proactive_push_ready';
```

Expected row: `proactive_push_ready | boolean | NO | false`. Existing rows read `false`.

- [ ] **Step 6: Commit**

```bash
git add functions/drizzle/0030_users_proactive_push_ready.sql functions/scripts/migrationOrder.mjs functions/src/db/schema.ts cloud-agent/src/db/schema.ts
git commit -m "feat(db): add users.proactive_push_ready capability column (0030)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `scheduleWakeup` callable in `functions`

**Files:**

- Create: `functions/src/scheduleWakeup.ts`
- Create: `functions/src/scheduleWakeup.test.ts`
- Modify: `functions/src/index.ts` (add export near line 57)

**Interfaces:**

- Consumes: `userRepository.findUserByFirebaseUid`, `getDb()` from `./db/cloudSql.js`, `characters` + `scheduledWakeups` from `./db/schema.js`, `DAILY_PROACTIVE_POWER_CEILING` from `./services/proactiveWakeupGuardrails.js`, `CLOUD_SQL_SECRETS` from `./cloudSqlSecrets.js`.
- Produces (used by Task 5 and Task 10): exported callable `scheduleWakeup`; request `{ characterId: string; reason: string; remindAt: string; priority?: number }`; response `{ ok: boolean; message: string; dueAt?: string }` — validation/ceiling refusals are `ok: false` DATA responses carrying the exact cloud-agent refusal strings (the model must read them); auth/ownership violations throw `HttpsError`. Also exports `buildWakeupInsert(args)` and `WAKEUP_LIMIT_REFUSAL` for tests.

- [ ] **Step 1: Write the failing test** — `functions/src/scheduleWakeup.test.ts`

Mirrors `functions/src/proactiveMessages.test.ts` (`buildDeps(overrides)` + `authedRequest(data)` cast pattern, node:test + `node:assert/strict`, imports `./scheduleWakeup.js`):

```ts
process.env.NODE_ENV = 'test'

import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { scheduleWakeupHandler, buildWakeupInsert, WAKEUP_LIMIT_REFUSAL } from './scheduleWakeup.js'
import type { ScheduleWakeupDeps } from './scheduleWakeup.js'

function buildDeps(overrides: Partial<ScheduleWakeupDeps> = {}): ScheduleWakeupDeps {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({ id: 'user-1' }),
    } as ScheduleWakeupDeps['userRepository'],
    characterOwnedBy: async (characterId) => characterId === 'char-owned',
    todaysProactiveSpend: async () => 0,
    insertWakeup: async () => {},
    ...overrides,
  }
}

function authedRequest(data: unknown) {
  return { auth: { uid: 'firebase-uid' }, data } as never
}

test('rejects unauthenticated calls', async () => {
  await assert.rejects(
    scheduleWakeupHandler({ auth: undefined, data: {} } as never, buildDeps()),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('rejects a characterId the caller does not own', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest({ characterId: 'char-other', reason: 'r', remindAt: futureIso() }),
      buildDeps(),
    ),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('rejects an unknown user', async () => {
  await assert.rejects(
    scheduleWakeupHandler(
      authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
      buildDeps({ userRepository: { findUserByFirebaseUid: async () => null } as never }),
    ),
    (e: unknown) => e instanceof HttpsError && e.code === 'not-found',
  )
})

test('rejects an empty reason', async () => {
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: '   ', remindAt: futureIso() }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: a reason is required.')
})

test('rejects remind_at in the past against the SERVER clock', async () => {
  // A client with a skewed clock must not be able to insert immediately-due rows.
  const skewedPast = new Date(Date.now() - 60_000).toISOString()
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: skewedPast }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be in the future.')
})

test('rejects an unparseable remind_at', async () => {
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: 'not-a-date' }),
    buildDeps(),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, 'Not scheduled: remind_at must be an ISO 8601 datetime.')
})

test('returns the vague-limit refusal at the ceiling and inserts nothing', async () => {
  const inserted: unknown[] = []
  const result = await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
    buildDeps({
      todaysProactiveSpend: async () => 500,
      insertWakeup: async (row) => {
        inserted.push(row)
      },
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.message, WAKEUP_LIMIT_REFUSAL)
  // Deliberately vague: no number the model could repeat to the user.
  assert.doesNotMatch(result.message, /\d+\s*(power|credits?)/i)
  assert.equal(inserted.length, 0)
})

test('success inserts a pending row with minted id/runKey and returns the due time', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  const due = futureIso()
  const result = await scheduleWakeupHandler(
    authedRequest({
      characterId: 'char-owned',
      reason: '  follow up  ',
      remindAt: due,
      priority: 3,
    }),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
      },
    }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.dueAt, new Date(due).toISOString())
  assert.ok(saved)
  assert.equal(saved!.characterId, 'char-owned')
  assert.equal(saved!.userId, 'user-1')
  assert.equal(saved!.reason, 'follow up') // trimmed
  assert.equal(saved!.priority, 3)
  assert.equal(saved!.status, 'pending')
  assert.notEqual(saved!.id, saved!.runKey)
  assert.notEqual(saved!.id, undefined)
})

test('priority defaults to 0 when omitted', async () => {
  let saved: ReturnType<typeof buildWakeupInsert> | undefined
  await scheduleWakeupHandler(
    authedRequest({ characterId: 'char-owned', reason: 'r', remindAt: futureIso() }),
    buildDeps({
      insertWakeup: async (row) => {
        saved = row
      },
    }),
  )
  assert.equal(saved!.priority, 0)
})

function futureIso(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString()
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && NODE_ENV=test npm run build 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './scheduleWakeup.js'` (the module does not exist yet).

- [ ] **Step 3: Write the implementation** — `functions/src/scheduleWakeup.ts`

```ts
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { and, eq, gte, sql } from 'drizzle-orm'
import { getDb } from './db/cloudSql.js'
import { characters, scheduledWakeups } from './db/schema.js'
import { userRepository } from './services/userRepository.js'
import { DAILY_PROACTIVE_POWER_CEILING } from './services/proactiveWakeupGuardrails.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'

// Mirrors formatReminderResult's refusal in cloud-agent/src/tools/reminders.ts.
// The two packages do not share a module; keep the strings equal. Deliberately
// vague: the model must not learn a number it would repeat to the user.
export const WAKEUP_LIMIT_REFUSAL =
  'Not scheduled: this character has reached its background activity limit for today. Do not promise the user a follow-up for today.'

// Mirrors buildWakeupInsert in cloud-agent/src/tools/reminders.ts (row shape,
// minted id/run_key, status 'pending'). The packages cannot share code.
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

export type ScheduleWakeupDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid'>
  // Resolves the identity seam: characterId arrives from the client executor,
  // never from the model — ownership is verified against characters.user_id
  // before any insert.
  characterOwnedBy: (characterId: string, userId: string) => Promise<boolean>
  // Mirrors todaysProactiveSpend in cloud-agent/src/tools/reminders.ts — UTC-day
  // SUM of spent_amount over resolved wakeups. Ceiling gates spend; pendings
  // carry 0 (no pending-row cap on either path — accepted parity gap).
  todaysProactiveSpend: (characterId: string, now: Date) => Promise<number>
  insertWakeup: (row: ReturnType<typeof buildWakeupInsert>) => Promise<void>
}

async function characterOwnedBy(characterId: string, userId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
  return row !== undefined
}

async function todaysProactiveSpend(characterId: string, now: Date): Promise<number> {
  const db = getDb()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const [row] = await db
    .select({ spent: sql<number>`COALESCE(SUM(${scheduledWakeups.spentAmount}), 0)::int` })
    .from(scheduledWakeups)
    .where(
      and(
        eq(scheduledWakeups.characterId, characterId),
        gte(scheduledWakeups.resolvedAt, dayStart),
      ),
    )
  return row?.spent ?? 0
}

async function insertWakeup(row: ReturnType<typeof buildWakeupInsert>): Promise<void> {
  await getDb().insert(scheduledWakeups).values(row)
}

const defaultDeps: ScheduleWakeupDeps = {
  userRepository,
  characterOwnedBy,
  todaysProactiveSpend,
  insertWakeup,
}

type ScheduleWakeupData = {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}

function parsePayload(data: unknown): ScheduleWakeupData {
  if (typeof data !== 'object' || data === null) {
    throw new HttpsError('invalid-argument', 'Request body must be an object.')
  }
  const d = data as Record<string, unknown>
  if (typeof d.characterId !== 'string' || d.characterId.length === 0) {
    throw new HttpsError('invalid-argument', 'characterId must be a non-empty string.')
  }
  if (typeof d.reason !== 'string') {
    throw new HttpsError('invalid-argument', 'reason must be a string.')
  }
  if (typeof d.remindAt !== 'string') {
    throw new HttpsError('invalid-argument', 'remindAt must be a string.')
  }
  if (
    d.priority !== undefined &&
    (typeof d.priority !== 'number' ||
      !Number.isInteger(d.priority) ||
      d.priority < 0 ||
      d.priority > 10)
  ) {
    throw new HttpsError('invalid-argument', 'priority must be an integer between 0 and 10.')
  }
  return {
    characterId: d.characterId,
    reason: d.reason,
    remindAt: d.remindAt,
    priority: d.priority,
  }
}

export async function scheduleWakeupHandler(
  request: CallableRequest,
  deps: ScheduleWakeupDeps = defaultDeps,
): Promise<{ ok: boolean; message: string; dueAt?: string }> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }
  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }
  const data = parsePayload(request.data)

  const owned = await deps.characterOwnedBy(data.characterId, user.id)
  if (!owned) {
    throw new HttpsError('permission-denied', 'Character not found.')
  }

  // Semantic refusals are DATA responses (not throws) so the edge executor can
  // surface the exact string back to the model — the same 429-style answer its
  // escalated sibling gets from cloud-agent's set_reminder.
  const reason = data.reason.trim()
  if (!reason) {
    return { ok: false, message: 'Not scheduled: a reason is required.' }
  }
  const dueAt = new Date(data.remindAt)
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: 'Not scheduled: remind_at must be an ISO 8601 datetime.' }
  }
  // Server clock, always — a client with a skewed clock must not be able to
  // insert immediately-due rows.
  const now = new Date()
  if (dueAt.getTime() <= now.getTime()) {
    return { ok: false, message: 'Not scheduled: remind_at must be in the future.' }
  }
  const spent = await deps.todaysProactiveSpend(data.characterId, now)
  if (spent >= DAILY_PROACTIVE_POWER_CEILING) {
    return { ok: false, message: WAKEUP_LIMIT_REFUSAL }
  }

  const row = buildWakeupInsert({
    userId: user.id,
    characterId: data.characterId,
    reason,
    dueAt,
    priority: data.priority ?? 0,
  })
  await deps.insertWakeup(row)
  return {
    ok: true,
    message: `Scheduled. You will wake up at ${dueAt.toISOString()} to follow up on this.`,
    dueAt: dueAt.toISOString(),
  }
}

export const scheduleWakeup = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => scheduleWakeupHandler(request),
)
```

- [ ] **Step 4: Export it from the index**

In `functions/src/index.ts`, next to line 57, add:

```ts
export { scheduleWakeup } from './scheduleWakeup.js'
```

- [ ] **Step 5: Run the new tests to green**

Run: `cd functions && NODE_ENV=test npm run build && NODE_ENV=test node --test lib/src/scheduleWakeup.test.js`
Expected: all tests PASS.

- [ ] **Step 6: Run the full functions suite (hold the baseline)**

Run: `cd functions && npm test 2>&1 | tail -8`
Expected: ≥ 522 passing (522 + 10 new), 0 failures.

- [ ] **Step 7: Commit**

```bash
git add functions/src/scheduleWakeup.ts functions/src/scheduleWakeup.test.ts functions/src/index.ts
git commit -m "feat(functions): scheduleWakeup callable — edge-path wakeup producer

Mirrors cloud-agent set_reminder semantics (server-clock validation, daily
ceiling, buildWakeupInsert row shape) as an authenticated, ownership-checked
callable so ordinary edge chat turns can schedule wake-ups.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `registerExpoPushToken` capability write (Decision 1, functions half)

**Files:**

- Modify: `functions/src/registerExpoPushToken.ts` (payload validation ~lines 35-96, write at line ~133)
- Modify: `functions/src/registerExpoPushToken.test.ts`

**Interfaces:**

- Consumes: `userRepository.updateUser(userId, updates)` (already accepts arbitrary `users.$inferInsert` fields — no signature change).
- Produces: callable body gains optional `capabilities?: { proactivePush?: boolean }`; the write becomes `{ expoPushToken, proactivePushReady }` with the flag written explicitly in both directions. Task 10's client change depends on this wire shape.

- [ ] **Step 1: Write the failing tests**

In `functions/src/registerExpoPushToken.test.ts`, extend the saved-capture pattern (the file already captures `savedToken` from the `updateUser` mock). Add:

```ts
test('capabilities.proactivePush true sets the flag alongside the token', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  // (reuse the file's existing deps/request harness; capture updateUser's 2nd arg)
  await runRegister(
    { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: true } },
    {
      updateUser: async (_id, updates) => {
        savedUpdates = updates as Record<string, unknown>
        return mockUserRow
      },
    },
  )
  assert.equal(savedUpdates!.expoPushToken, 'ExponentPushToken[abc]')
  assert.equal(savedUpdates!.proactivePushReady, true)
})

test('omitted capabilities actively sets the flag false (the downgrade path)', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  await runRegister(
    { expoPushToken: 'ExponentPushToken[abc]' },
    {
      updateUser: async (_id, updates) => {
        savedUpdates = updates as Record<string, unknown>
        return mockUserRow
      },
    },
  )
  assert.equal(savedUpdates!.proactivePushReady, false)
})

test('capabilities.proactivePush false sets the flag false', async () => {
  let savedUpdates: Record<string, unknown> | undefined
  await runRegister(
    { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: false } },
    {
      updateUser: async (_id, updates) => {
        savedUpdates = updates as Record<string, unknown>
        return mockUserRow
      },
    },
  )
  assert.equal(savedUpdates!.proactivePushReady, false)
})

test('the token and the flag are written in ONE updateUser call (atomic)', async () => {
  const calls: number[] = []
  await runRegister(
    { expoPushToken: 'ExponentPushToken[abc]', capabilities: { proactivePush: true } },
    {
      updateUser: async (_id, updates) => {
        calls.push(1)
        return mockUserRow
      },
    },
  )
  assert.equal(calls.length, 1)
})
```

Adapt `runRegister`/`mockUserRow` to the file's existing harness names — the file already has a mock-deps harness with `savedToken` captures and a full user-row literal; follow it exactly. The unauthenticated case is already covered (`rejects unauthenticated requests`) and must keep passing.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd functions && NODE_ENV=test npm run build && NODE_ENV=test node --test lib/src/registerExpoPushToken.test.js`
Expected: the four new tests FAIL (`proactivePushReady` is `undefined` — not written today).

- [ ] **Step 3: Implement**

In `functions/src/registerExpoPushToken.ts`:

1. In `parsePayload`, accept and validate the optional field on BOTH union branches (native token and web-device bundle). Reuse the file's existing `isRecord`-style helpers:

```ts
function parseCapabilities(value: unknown): { proactivePush: boolean } {
  // Absent → false. The flag is only ever written alongside a token, and the
  // write is explicit in both directions so an old replacement device actively
  // clears a new device's readiness (Decision 1).
  if (value === undefined) return { proactivePush: false }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'capabilities must be an object.')
  }
  const proactivePush = (value as { proactivePush?: unknown }).proactivePush
  if (proactivePush !== undefined && typeof proactivePush !== 'boolean') {
    throw new HttpsError('invalid-argument', 'capabilities.proactivePush must be a boolean.')
  }
  return { proactivePush: proactivePush === true }
}
```

Attach `capabilities` to the parsed payload type for both branches (e.g. the parse functions return `{ ..., capabilities: parseCapabilities(raw.capabilities) }`).

2. Replace the write at line ~133:

```ts
const updated = await deps.userRepository.updateUser(user.id, {
  expoPushToken,
  proactivePushReady: payload.capabilities.proactivePush,
})
```

(one call — token and flag are atomic; `=== true` folded into `parseCapabilities`).

- [ ] **Step 4: Run the tests to green, then the full suite**

Run: `cd functions && NODE_ENV=test npm run build && NODE_ENV=test node --test lib/src/registerExpoPushToken.test.js && npm test 2>&1 | tail -4`
Expected: file green; suite ≥ 526 passing, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/src/registerExpoPushToken.ts functions/src/registerExpoPushToken.test.ts
git commit -m "feat(functions): registerExpoPushToken writes proactive_push_ready both ways

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: cloud-agent — flag-aware `loadCharacter` + handler push gate (Decision 1)

**Files:**

- Modify: `cloud-agent/src/db/schema.ts` (done in Task 1 — no further change)
- Modify: `cloud-agent/src/index.ts` (`loadCharacter` at ~lines 681-703)
- Modify: `cloud-agent/src/handlers/proactiveWakeupHandler.ts` (`ProactiveCharacter` ~lines 20-28; notify branch ~lines 294-308; deps interface if `resolveDeliveryMode` is not already injectable)
- Modify: `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts`

**Interfaces:**

- Consumes: `users.proactivePushReady` (Task 1).
- Produces: `ProactiveCharacter.proactivePushReady: boolean`; handler sends push only when `mode === 'notify' && character.proactivePushReady && character.expoPushToken && messageId`. No other package consumes these.
- **Constraint:** the two flip tests and the `PROACTIVE_PUSH_ENABLED = false` const are UNTOUCHED (see Global Constraints).

- [ ] **Step 1: Write the failing tests**

In `cloud-agent/src/handlers/proactiveWakeupHandler.test.ts` (supertest + `buildApp(deps)` harness, node:test):

1. Update every `loadCharacter` mock fixture to return `proactivePushReady` (the new required `ProactiveCharacter` field). Default existing fixtures to `proactivePushReady: true` so current assertions are unaffected.

2. Add (inject a stub `resolveDeliveryMode: () => ({ mode: 'notify' as const, clampReason: null })` into handler deps if the real one is not already a dep — check the deps interface first; the global gate must stay closed in the real export):

```ts
test('suppresses push for a notify on a flag-false user while still persisting mode=notify', async () => {
  // loadCharacter fixture: proactivePushReady: false, expoPushToken: 'ExponentPushToken[abc]'
  // deps.resolveDeliveryMode stubbed to pass notify through (simulates the eventual un-gate).
  const res = await request(app).post('/agent/proactive-wakeup').set(...auth...).send(payload)
  assert.equal(res.status, 200)
  assert.equal(persistedMessage.deliveryMode, 'notify') // message still lands
  assert.equal(pushes.length, 0)                        // push suppressed
})

test('fires the push for a notify on a flag-true user (un-gate shape)', async () => {
  // Same stub, proactivePushReady: true.
  assert.equal(pushes.length, 1)
  assert.equal(pushes[0].token, 'ExponentPushToken[abc]')
})

test('a guardrail-clamped notify stays quiet regardless of flag', async () => {
  // deps.resolveDeliveryMode stubbed to ({ mode: 'quiet', clampReason: 'guardrail' }), flag true.
  assert.equal(pushes.length, 0)
})
```

Mirror the existing push-capture harness (the file already captures pushed token/charId/name/body — see the `'does not push while the gate is closed'` test) and the existing auth header helper.

- [ ] **Step 2: Run to verify failure**

Run: `cd cloud-agent && NODE_ENV=test npm run build && NODE_ENV=test node --test "$(find dist -name 'proactiveWakeupHandler.test.js')"`
Expected: FAIL — fixtures missing `proactivePushReady` (type error at build) and the new tests fail.

- [ ] **Step 3: Implement**

1. `ProactiveCharacter` interface gains `proactivePushReady: boolean`.
2. `loadCharacter` select (cloud-agent/src/index.ts) gains:

```ts
      proactivePushReady: users.proactivePushReady,
```

3. Notify branch becomes:

```ts
    if (
      mode === 'notify' &&
      character.proactivePushReady &&
      character.expoPushToken &&
      messageId
    ) {
```

(keep the existing `.catch` — a push failure never fails the wake-up.)

4. If not already injectable, add `resolveDeliveryMode` to the handler deps with the real exported function as default (this is what makes the flag-gate testable while the global const stays `false`).

- [ ] **Step 4: Run to green, then full suite**

Run: `cd cloud-agent && NODE_ENV=test node --test "$(find dist -name 'proactiveWakeupHandler.test.js')" && npm test 2>&1 | tail -4`
Expected: file green (including both untouched flip tests); suite ≥ 348 passing + 1 skip, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/handlers/proactiveWakeupHandler.ts cloud-agent/src/handlers/proactiveWakeupHandler.test.ts
git commit -m "feat(cloud-agent): gate proactive push on users.proactive_push_ready

The flag (per-device capability, Decision 1) bounds the eventual un-gate to
clients that can sync/badge/deeplink. Global gate stays closed in this branch.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Edge executor for `set_reminder` (Decision 0, client half)

**Files:**

- Create: `src/services/proactiveWakeupService.ts`
- Create: `src/services/__tests__/proactiveWakeupService.test.ts` (only if a mockable unit is worth it — see Step 1 note; otherwise cover via executor tests)
- Modify: `shared/agent-tools-spec.ts` (`set_reminder` block ~lines 171-183, `LOCALLY_EXECUTABLE_CLOUD_TOOLS` comment ~lines 205-212)
- Modify: `src/services/edgeToolExecutors.ts` (factory signature + new executor)
- Modify: `src/services/__tests__/edgeToolExecutors.test.ts`
- Modify: `src/hooks/useEdgeAgent.ts` (options, escalation predicate ~line 150-161, executor construction ~lines 98-110)
- Modify: `src/hooks/useEdgeAgent.test.ts`
- Modify: `src/hooks/useAIChat.ts` (~line 92 call site)

**Interfaces:**

- Consumes: `scheduleWakeup` callable (Task 2) — request `{ characterId, reason, remindAt, priority? }`, response `{ ok, message, dueAt? }`.
- Produces:
  - `src/services/proactiveWakeupService.ts`: `scheduleWakeupViaCallable(request: { characterId: string; reason: string; remindAt: string; priority?: number }): Promise<{ ok: boolean; message: string; dueAt?: string }>`
  - `edgeToolExecutors.ts`: `createEdgeToolExecutors(characterId, wiki, image?, reminder?: EdgeReminderToolDeps)` where `EdgeReminderToolDeps = { characterId: string; scheduleWakeup: typeof scheduleWakeupViaCallable }`; executor name `'set_reminder'`.
  - `UseEdgeAgentOptions.cloudAgentCharacterId?: string | null`.
- **Schema discrepancy, resolved per spec:** the spec locks the model-facing schema as `{reason, remind_at, priority?}`; the shipped edge schema is `{message, remind_at}`. Task updates the shared spec to the locked shape (matches cloud-agent's zod naming exactly).

- [ ] **Step 1: Write the failing tests**

`src/services/__tests__/edgeToolExecutors.test.ts` — the file already mocks `~/services/imageGenerationService` (`generateImageViaCallable: jest.fn()`); add the twin seam `~/services/proactiveWakeupService` with `scheduleWakeupViaCallable: jest.fn()`. Add:

```ts
describe('set_reminder executor', () => {
  it('is absent when no reminder deps are provided (non-synced character keeps existing behavior)', () => {
    const executors = createEdgeToolExecutors('char-1', null)
    expect(executors.set_reminder).toBeUndefined()
  })

  it('calls the callable with the session-bound cloud character id and returns its message', async () => {
    mockScheduleWakeupViaCallable.mockResolvedValue({
      ok: true,
      message: 'Scheduled. You will wake up at 2026-09-10T10:00:00.000Z to follow up on this.',
      dueAt: '2026-09-10T10:00:00.000Z',
    })
    const executors = createEdgeToolExecutors('local-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'follow up on the recipe',
      remind_at: '2026-09-10T10:00:00.000Z',
      priority: 2,
    })
    expect(mockScheduleWakeupViaCallable).toHaveBeenCalledWith({
      characterId: 'cloud-9',
      reason: 'follow up on the recipe',
      remindAt: '2026-09-10T10:00:00.000Z',
      priority: 2,
    })
    expect(out).toBe(
      'Scheduled. You will wake up at 2026-09-10T10:00:00.000Z to follow up on this.',
    )
  })

  it('surfaces a callable refusal (ceiling) to the model as the tool result', async () => {
    mockScheduleWakeupViaCallable.mockResolvedValue({
      ok: false,
      message:
        'Not scheduled: this character has reached its background activity limit for today. Do not promise the user a follow-up for today.',
    })
    const executors = createEdgeToolExecutors('local-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'r',
      remind_at: '2026-09-10T10:00:00.000Z',
    })
    expect(out).toMatch(/background activity limit/)
  })

  it('surfaces a callable failure as a tool-error string, not a thrown crash of the turn', async () => {
    mockScheduleWakeupViaCallable.mockRejectedValue(new Error('network down'))
    const executors = createEdgeToolExecutors('local-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'r',
      remind_at: '2026-09-10T10:00:00.000Z',
    })
    expect(out).toBe('Not scheduled: an internal error occurred.')
  })
})
```

`src/hooks/__tests__/useEdgeAgent.test.ts` (or the escalation-focused suite in it): add a test asserting a `set_reminder` function call does NOT set `escalated: true` when `cloudAgentCharacterId` is provided — mirror the file's existing mock of `~/services/edgeToolExecutors`/`chatReplyService` (the mocked executor factory must return a `set_reminder` entry for the assertion to be meaningful), and one asserting behavior is unchanged when it is not provided.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/edgeToolExecutors.test.ts`
Expected: FAIL — `executors.set_reminder` is undefined / factory arity mismatch.

- [ ] **Step 3: Implement**

1. `src/services/proactiveWakeupService.ts` (mirrors `imageGenerationService`'s normalization; module-scope callable like `proactiveSync.ts` deliberately does):

```ts
import { getApp } from '@react-native-firebase/app'
import { getFunctions, httpsCallable } from '@react-native-firebase/functions'
import { appCheckReady } from '~/config/firebaseConfig'

export interface ScheduleWakeupRequest {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}

export interface ScheduleWakeupResponse {
  ok: boolean
  message: string
  dueAt?: string
}

const scheduleWakeupFn = httpsCallable<ScheduleWakeupRequest, ScheduleWakeupResponse>(
  getFunctions(getApp(), 'us-central1'),
  'scheduleWakeup',
)

export async function scheduleWakeupViaCallable(
  request: ScheduleWakeupRequest,
): Promise<ScheduleWakeupResponse> {
  await appCheckReady
  const result = await scheduleWakeupFn(request)
  const wrapped = result as { data?: ScheduleWakeupResponse }
  return wrapped.data ?? (result as unknown as ScheduleWakeupResponse)
}
```

2. `shared/agent-tools-spec.ts` — replace the `set_reminder` parameters with the locked shape:

```ts
  {
    name: 'set_reminder',
    tier: 'cloud-only',
    description: 'Schedule a follow-up on the current conversation at a specific future time.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'What to follow up on when the wakeup fires.' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime, in the future.' },
        priority: { type: 'integer', description: 'Optional urgency, 0 (default) to 10.' },
      },
      required: ['reason', 'remind_at'],
    },
  },
```

3. Update the `LOCALLY_EXECUTABLE_CLOUD_TOOLS` doc-comment (its "set_reminder does NOT qualify" sentence is now half-true): `set_reminder` still stays OUT of this set (a non-synced character has no cloud row to schedule against, so it must not be exposed there), but it is no longer escalation-intercepted for synced characters — `useEdgeAgent` executes it locally via the `scheduleWakeup` callable.

4. `src/services/edgeToolExecutors.ts`:

```ts
import { scheduleWakeupViaCallable } from '~/services/proactiveWakeupService'

export interface EdgeReminderToolDeps {
  characterId: string
  scheduleWakeup: typeof scheduleWakeupViaCallable
}

export function createEdgeToolExecutors(
  characterId: string,
  wiki: Wiki | null,
  image?: EdgeImageToolDeps,
  reminder?: EdgeReminderToolDeps,
) {
  // ...existing body...
  const executors = {
    // ...existing entries...
    ...(reminder
      ? {
          set_reminder: async (args: Record<string, unknown>) => {
            const reason = typeof args.reason === 'string' ? args.reason : ''
            const remindAt = typeof args.remind_at === 'string' ? args.remind_at : ''
            const priority =
              typeof args.priority === 'number' && Number.isInteger(args.priority) && args.priority >= 0 && args.priority <= 10
                ? args.priority
                : undefined
            try {
              const result = await reminder.scheduleWakeup({
                characterId: reminder.characterId,
                reason,
                remindAt,
                ...(priority !== undefined ? { priority } : {}),
              })
              return result.message
            } catch (error) {
              console.error('[EdgeAgent] set_reminder failed:', error)
              // Same catch-all string cloud-agent's set_reminder returns.
              return 'Not scheduled: an internal error occurred.'
            }
          },
        }
      : {}),
  }
```

(fit the spread into whatever object-literal shape the factory already returns — follow the existing `generate_image` entry's placement and comment density.)

5. `src/hooks/useEdgeAgent.ts`:

- `UseEdgeAgentOptions` gains `cloudAgentCharacterId?: string | null`; destructure it.
- Executor construction (~line 98):

```ts
      const toolExecutors = createEdgeToolExecutors(
        character.id,
        wiki,
        canGenerateLocally ? { ...existing image deps... } : undefined,
        cloudAgentCharacterId
          ? { characterId: cloudAgentCharacterId, scheduleWakeup: scheduleWakeupViaCallable }
          : undefined,
      )
```

(import `scheduleWakeupViaCallable` from `~/services/proactiveWakeupService`.)

- Escalation predicate (~line 150):

```ts
// Cloud-only tools (generate_image, set_reminder) are offered to the edge
// model as stubs it can call... [keep existing comment, extend it:]
// set_reminder no longer escalates at all: for a cloud-synced character
// the executor above schedules the wakeup via the scheduleWakeup
// callable directly (Decision 0 — production chat is edge-first and
// escalation almost never happens, which left the producer cold).
const escalates = functionCalls.some(
  (fc) =>
    fc.name === 'escalate_to_cloud_agent' ||
    (isCloudOnlyToolName(fc.name ?? '') &&
      fc.name !== 'set_reminder' &&
      !(canGenerateLocally && isLocallyExecutableCloudTool(fc.name ?? ''))),
)
```

6. `src/hooks/useAIChat.ts` call site (~line 92):

```ts
  const edgeAgent = useEdgeAgent({
    ...existing args...,
    cloudAgentCharacterId,
  })
```

- [ ] **Step 4: Run to green, then the affected suites**

Run: `npx jest src/services/__tests__/edgeToolExecutors.test.ts src/hooks/__tests__/useEdgeAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npx tsc --noEmit`

```bash
git add shared/agent-tools-spec.ts src/services/proactiveWakeupService.ts src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts src/hooks/useEdgeAgent.ts src/hooks/useAIChat.ts
git commit -m "feat(edge): execute set_reminder locally via scheduleWakeup callable

Decision 0: the wakeup producer lived behind escalation that production chat
almost never takes (3 /agent/run requests in 27h). Ordinary edge turns can now
schedule wake-ups; cloud-agent set_reminder stays for escalated turns.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `markProactiveReadViaCallable` + queue kick-flush + `useProactiveSync` hook (Decision 3)

**Files:**

- Create: `src/services/proactiveMarkReadService.ts`
- Create: `src/hooks/useProactiveSync.ts`
- Create: `src/hooks/__tests__/useProactiveSync.test.tsx`
- Modify: `src/services/proactiveReadQueue.ts` (`enqueueMarkRead` kick)
- Modify: the queue's test file (find it: `grep -rl "enqueueMarkRead" src --include="*.test.ts*"`)

**Interfaces:**

- Consumes: `syncProactiveMessages(userId)` (`src/services/proactiveSync.ts`), `flushMarkReadQueue(call)` / `MarkReadCall` (`src/services/proactiveReadQueue.ts`), `proactiveUnreadKeys` (`src/hooks/useProactiveUnread.ts`), `messageKeys` (`src/hooks/useMessages.ts`).
- Produces:
  - `markProactiveReadViaCallable(request: { messageIds: string[] }): Promise<{ updated: number }>` — the real `MarkReadCall` binding (shared by this hook and Task 8).
  - `useProactiveSync(userId: string | null | undefined): { triggerSync: () => void }` — in-flight-guarded; Task 7's routing hook consumes `triggerSync`; Task 7 mounts both in `app/_layout.tsx`.

- [ ] **Step 1: Write the failing tests**

`src/hooks/__tests__/useProactiveSync.test.tsx` — mirror `useProactiveUnread.test.tsx`'s wrapper (`QueryClient` with `retry: false, gcTime: 0`) plus RN AppState mocking (`AppState.addEventListener` → `jest.fn()` returning `{ remove: jest.fn() }`):

```tsx
const mockSync = jest.fn()
const mockFlush = jest.fn()
const mockMarkReadCall = jest.fn()
jest.mock('~/services/proactiveSync', () => ({
  syncProactiveMessages: (...a: unknown[]) => mockSync(...a),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  flushMarkReadQueue: (...a: unknown[]) => mockFlush(...a),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: (...a: unknown[]) => mockMarkReadCall(...a),
}))

const listeners: Record<string, (notification: unknown) => void> = {}
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    listeners.received = cb
    return { remove: jest.fn() }
  },
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialNotificationAsync: jest.fn(async () => null),
}))
```

Tests:

```tsx
it('fires sync on app foreground (active)', ...)
// render hook; grab the AppState listener from the RN mock; call it with 'active';
// await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))

it('fires sync on foreground receipt of a PROACTIVE_CHARACTER_MESSAGE notification', ...)
// listeners.received({ request: { content: { data: { type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/x' } } } })

it('ignores foreground receipts of other notification types', ...)
// received with data.type: 'OTHER' → mockSync not called

it('overlapping triggers share one in-flight run', ...)
// make mockSync return a pending promise; triggerSync() twice; expect(mockSync).toHaveBeenCalledTimes(1)

it('invalidates the unread + message caches after a successful sync', ...)
// spy on queryClient.invalidateQueries (the wrapper exposes it); assert queryKey proactiveUnreadKeys.all and messageKeys.all were passed

it('does NOT invalidate on sync failure', ...)
// mockSync.mockRejectedValueOnce(new Error('x')) → invalidateQueries not called; no unhandled rejection

it('flushes the read queue with the real callable after a successful sync', ...)
// expect(mockFlush).toHaveBeenCalledWith(mockMarkReadCall)
```

Queue test additions (in the queue's existing test file): `enqueueMarkRead(ids, call)` fires `flushMarkReadQueue(call)` (fire-and-forget) with the provided call, and does nothing extra when `call` is omitted. Mock `flushMarkReadQueue` at module level — careful: the queue module imports it internally, so use `jest.spyOn` on the module or restructure the test to let the real flush run against a mock `MarkReadCall` and assert the call was invoked.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/hooks/__tests__/useProactiveSync.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/services/proactiveMarkReadService.ts`:

```ts
import { getApp } from '@react-native-firebase/app'
import { getFunctions, httpsCallable } from '@react-native-firebase/functions'
import type { MarkReadCall } from '~/services/proactiveReadQueue'

// Module-scope callable, same deliberate pattern as proactiveSync.ts. This is
// the single real binding of httpsCallable('markProactiveRead') — the sync hook
// (flush) and the chat-open enqueue (Task 8) both share it.
const markProactiveReadFn = httpsCallable<{ messageIds: string[] }, { updated: number }>(
  getFunctions(getApp(), 'us-central1'),
  'markProactiveRead',
)

export const markProactiveReadViaCallable: MarkReadCall = async (request) => {
  const result = await markProactiveReadFn(request)
  const wrapped = result as { data?: { updated: number } }
  return wrapped.data ?? (result as unknown as { updated: number })
}
```

`src/hooks/useProactiveSync.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useQueryClient } from '@tanstack/react-query'
import { syncProactiveMessages } from '~/services/proactiveSync'
import { flushMarkReadQueue } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'
import { messageKeys } from '~/hooks/useMessages'

export const PROACTIVE_PUSH_TYPE = 'PROACTIVE_CHARACTER_MESSAGE'

export function isProactivePushData(data: unknown): data is { deepLink?: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === PROACTIVE_PUSH_TYPE
  )
}

/**
 * Decision 3: sync on foreground and on foreground receipt, one in-flight run,
 * invalidate the badge + thread caches on completion. Task 7's routing hook
 * reuses triggerSync for notification taps.
 */
export function useProactiveSync(userId: string | null | undefined): { triggerSync: () => void } {
  const queryClient = useQueryClient()
  const inFlightRef = useRef<Promise<void> | null>(null)

  const triggerSync = useCallback(() => {
    if (!userId || inFlightRef.current) return
    const run = (async () => {
      try {
        await syncProactiveMessages(userId)
        await flushMarkReadQueue(markProactiveReadViaCallable)
        await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
        await queryClient.invalidateQueries({ queryKey: messageKeys.all })
      } catch (error) {
        // A stale badge beats a lying one: failure skips invalidation. The
        // transactional cursor makes the next trigger's run safe.
        console.warn('[proactiveSync] sync failed:', error)
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
  }, [userId, queryClient])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') triggerSync()
    })
    return () => subscription.remove()
  }, [triggerSync])

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      if (isProactivePushData(notification.request.content.data)) triggerSync()
    })
    return () => subscription.remove()
  }, [triggerSync])

  return { triggerSync }
}
```

`enqueueMarkRead` kick (in `src/services/proactiveReadQueue.ts`) — rename `_call` to `call`, keep the dedupe/append logic identical, and after the locked append:

```ts
// The wiring this docstring anticipated: an enqueue with a call both persists
// the intent AND kicks a flush, so a chat open reaches the server promptly.
// Fire-and-forget — flush failures stay queued (retry budget + foreground
// flushes cover them).
if (call && messageIds.length > 0) {
  void flushMarkReadQueue(call).catch(() => {})
}
```

Update the file's top docstring (the "intentionally left to a future task" note) to describe the shipped wiring.

- [ ] **Step 4: Run to green**

Run: `npx jest src/hooks/__tests__/useProactiveSync.test.tsx src/services/__tests__/proactiveReadQueue.test.ts`
(expected queue test path — adjust to the actual filename found in Step 1)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/proactiveMarkReadService.ts src/services/proactiveReadQueue.ts src/hooks/useProactiveSync.ts "src/hooks/__tests__/useProactiveSync.test.tsx" <queue-test-file>
git commit -m "feat(proactive): useProactiveSync hook + real markProactiveRead binding

Foreground/receipt sync triggers with an in-flight guard; completion
invalidates the unread + thread caches; enqueue kicks a flush.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `useProactiveNotificationRouting` + mount both hooks (Decision 2)

**Files:**

- Create: `src/hooks/useProactiveNotificationRouting.ts`
- Create: `src/hooks/__tests__/useProactiveNotificationRouting.test.tsx`
- Modify: `app/_layout.tsx` (`AppOrchestrator`, ~lines 151-157)

**Interfaces:**

- Consumes: `useProactiveSync(userId).triggerSync` (Task 6); `isProactivePushData`, `PROACTIVE_PUSH_TYPE` from `useProactiveSync.ts`; `router` from `expo-router`.
- Produces: `useProactiveNotificationRouting({ triggerSync }: { triggerSync: () => void }): void`. Push payload contract (from `cloud-agent/src/services/fcmDispatcher.ts:125-130`): `data: { type: 'PROACTIVE_CHARACTER_MESSAGE', characterId, messageId, deepLink: '/chat/<id>' }`.

- [ ] **Step 1: Write the failing tests**

`src/hooks/__tests__/useProactiveNotificationRouting.test.tsx`:

```tsx
const mockRouterPush = jest.fn()
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockRouterPush(...a) } }))

let responseListener: ((response: unknown) => void) | undefined
const mockGetInitial = jest.fn(async () => null)
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (cb: (r: unknown) => void) => {
    responseListener = cb
    return { remove: jest.fn() }
  },
  getInitialNotificationAsync: (...a: unknown[]) => mockGetInitial(...a),
}))

const triggerSync = jest.fn()
function response(data: unknown) {
  return { notification: { request: { content: { data } } } }
}

beforeEach(() => {
  jest.clearAllMocks()
  responseListener = undefined
})

it('routes a tap with valid type + /chat/ deepLink and fires the sync trigger non-blocking', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc')
})

it('ignores a wrong type', () => {
  /* data.type: 'OTHER' → neither fn called */
})
it('ignores a malformed deepLink', () => {
  /* deepLink: 'https://evil.example/chat/x' → neither called */
})
it('ignores a missing deepLink', () => {
  /* type ok, no deepLink → neither called */
})
it('ignores missing data', () => {
  /* data: undefined → neither called */
})

it('routes cold start after mount', async () => {
  mockGetInitial.mockResolvedValueOnce(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }),
  )
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc'))
  expect(triggerSync).toHaveBeenCalledTimes(1)
})

it('ignores a cold-start notification of the wrong shape', async () => {
  mockGetInitial.mockResolvedValueOnce(response({ type: 'OTHER' }))
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  await waitFor(() => expect(mockGetInitial).toHaveBeenCalled())
  expect(mockRouterPush).not.toHaveBeenCalled()
  expect(triggerSync).not.toHaveBeenCalled()
})
```

Fill the three "ignores" bodies following the first test's shape — the assertion trio is `expect(triggerSync).not.toHaveBeenCalled()` + `expect(mockRouterPush).not.toHaveBeenCalled()`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/hooks/__tests__/useProactiveNotificationRouting.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/hooks/useProactiveNotificationRouting.ts`:

```ts
import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { isProactivePushData } from '~/hooks/useProactiveSync'

// The hook routes, it does not interpret: anything without a proactive type
// AND a /chat/ deepLink is ignored, so a malformed or foreign payload cannot
// send the user anywhere unexpected.
const CHAT_DEEPLINK_PATTERN = /^\/chat\//

export function useProactiveNotificationRouting({
  triggerSync,
}: {
  triggerSync: () => void
}): void {
  useEffect(() => {
    const routeIfProactive = (data: unknown) => {
      if (!isProactivePushData(data)) return
      const deepLink = typeof data.deepLink === 'string' ? data.deepLink : ''
      if (!CHAT_DEEPLINK_PATTERN.test(deepLink)) return
      // Push is a hint (Phase 2 Decision 5): sync fires non-blocking and
      // navigation never waits on the network — the 5s poll plus the sync's
      // cache invalidation populate the thread as the data lands.
      triggerSync()
      router.push(deepLink as never)
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((res) => {
      routeIfProactive(res.notification.request.content.data)
    })
    return () => subscription.remove()
  }, [triggerSync])

  // Cold start: post-mount effect, so the router exists before navigation.
  useEffect(() => {
    let cancelled = false
    void Notifications.getInitialNotificationAsync()
      .then((res) => {
        if (res && !cancelled) {
          routeIfProactive(res.notification.request.content.data)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [triggerSync])
}
```

(`routeIfProactive` must be shared by both effects — either define it inside a `useCallback` both effects depend on, or inline it in each; if inlined, keep the validation identical. The `useCallback` form is preferred.)

Mount in `app/_layout.tsx` `AppOrchestrator` (after the existing `useRegisterExpoPushToken`/`useBrowserActionApproval` calls):

```tsx
const currentUserId = useSelector(authService, (state) => state.context.user?.uid ?? null)
// Proactive lifecycle-sync wiring (spec Decisions 2+3): foreground/receipt
// sync with in-flight guard; notification taps reuse the same guarded run.
const { triggerSync } = useProactiveSync(currentUserId)
useProactiveNotificationRouting({ triggerSync })
```

(import both hooks; `useSelector` is already imported in the file.)

- [ ] **Step 4: Run to green + typecheck**

Run: `npx jest src/hooks/__tests__/useProactiveNotificationRouting.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProactiveNotificationRouting.ts src/hooks/__tests__/useProactiveNotificationRouting.test.tsx app/_layout.tsx
git commit -m "feat(proactive): notification-tap + cold-start deeplink routing

Decision 2: validated PROACTIVE_CHARACTER_MESSAGE taps route into the chat and
fire the guarded sync; anything else in the payload is ignored.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Local mark-read on chat open (Decision 4)

**Files:**

- Modify: `src/database/messageDatabase.ts` (new function near `countUnreadProactive`, ~line 620)
- Modify: `src/database/__tests__/messageDatabase.proactive.test.ts`
- Create: `src/hooks/useMarkProactiveReadOnOpen.ts`
- Create: `src/hooks/__tests__/useMarkProactiveReadOnOpen.test.tsx`
- Modify: `src/components/ChatView.tsx` (`ChatViewContent`, ~lines 92-398)

**Interfaces:**

- Consumes: `countUnreadProactive(characterId, nowMs)` (messageDatabase.ts:611), `enqueueMarkRead(ids, call)` (Task 6 wiring), `markProactiveReadViaCallable` (Task 6), `proactiveUnreadKeys`.
- Produces: `markProactiveReadLocally(characterId: string): Promise<string[]>` — returns the ids it marked (empty array = no-op), so the caller can enqueue exactly those ids. `useMarkProactiveReadOnOpen(characterId: string | null | undefined): void`.

- [ ] **Step 1: Write the failing DB tests**

In `src/database/__tests__/messageDatabase.proactive.test.ts` (real in-memory SQLite via `createExpoSqliteBetterSqlite3Mock().openDatabaseSync(':memory:')` + `CREATE_TABLES`; `beforeEach` clears `messages`):

```ts
describe('markProactiveReadLocally', () => {
  it("writes read_at for ALL of the character's unread proactive rows and returns their ids", async () => {
    await seedProactiveMessage({ id: 'p1', characterId: 'c1' })
    await seedProactiveMessage({ id: 'p2', characterId: 'c1' })
    await seedProactiveMessage({ id: 'regular', characterId: 'c1', proactive: false }) // not proactive
    await seedProactiveMessage({ id: 'p3', characterId: 'c2' }) // other character
    const ids = await markProactiveReadLocally('c1')
    expect(ids.sort()).toEqual(['p1', 'p2'])
    const row = await getRow('p1')
    expect(row.read_at).not.toBeNull()
  })

  it('is a no-op when there is nothing unread (second open)', async () => {
    await seedProactiveMessage({ id: 'p1', characterId: 'c1' })
    await markProactiveReadLocally('c1')
    const ids = await markProactiveReadLocally('c1')
    expect(ids).toEqual([])
  })

  it('leaves already-read rows out of the returned ids', async () => {
    await seedProactiveMessage({ id: 'p1', characterId: 'c1' })
    await markProactiveReadLocally('c1')
    await markProactiveReadLocally('c1') // both calls
    expect(await countUnreadProactive('c1', Date.now())).toBe(0)
  })
})
```

(`seedProactiveMessage` — the file already seeds proactive rows for `countUnreadProactive`/`applyProactiveMessages` tests; reuse or extend its helper with a `proactive: true` flag and optional pre-set `read_at`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/database/__tests__/messageDatabase.proactive.test.ts`
Expected: FAIL — `markProactiveReadLocally is not a function`.

- [ ] **Step 3: Implement the DB function**

In `src/database/messageDatabase.ts`, next to `countUnreadProactive`:

```ts
/**
 * Decision 4 step 1: optimistic local read receipt. Marks ALL of the
 * character's unread proactive rows — reading the chat means reading the
 * thread; the server guardrail's 7-day escape makes the distinction invisible
 * to the push decision. Returns the ids marked so the caller can enqueue them
 * for the durable server retry.
 */
export async function markProactiveReadLocally(characterId: string): Promise<string[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM messages
      WHERE character_id = ? AND read_at IS NULL
        AND json_extract(message_data, '$.proactive') = 1`,
    [characterId],
  )
  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return []
  const now = Date.now()
  const placeholders = ids.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE messages SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`,
    [now, ...ids],
  )
  return ids
}
```

(`read_at` is epoch ms everywhere locally — `applyProactiveMessages` writes `Date.parse(...)`, `countUnreadProactive` compares to `nowMs`.)

- [ ] **Step 4: Write the failing hook tests**

`src/hooks/__tests__/useMarkProactiveReadOnOpen.test.tsx` — same wrapper recipe as `useProactiveUnread.test.tsx` (`gcTime: 0`):

```tsx
const mockCount = jest.fn()
const mockMarkLocally = jest.fn()
const mockEnqueue = jest.fn()
jest.mock('~/database/messageDatabase', () => ({
  countUnreadProactive: (...a: unknown[]) => mockCount(...a),
  markProactiveReadLocally: (...a: unknown[]) => mockMarkLocally(...a),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  enqueueMarkRead: (...a: unknown[]) => mockEnqueue(...a),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: jest.fn(),
}))
```

Tests:

```tsx
it('marks locally, invalidates the unread cache, and enqueues ids when unread > 0', async () => {
  mockCount.mockResolvedValue(2)
  mockMarkLocally.mockResolvedValue(['p1', 'p2'])
  renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper })
  await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith(['p1', 'p2'], expect.any(Function)))
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: proactiveUnreadKeys.all })
})

it('does nothing when unread is 0 (second open is a no-op)', async () => {
  mockCount.mockResolvedValue(0)
  renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper })
  await waitFor(() => expect(mockCount).toHaveBeenCalled())
  expect(mockMarkLocally).not.toHaveBeenCalled()
  expect(mockEnqueue).not.toHaveBeenCalled()
})

it('does not enqueue when the local write returned no ids', async () => {
  mockCount.mockResolvedValue(2)
  mockMarkLocally.mockResolvedValue([])
  renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper })
  await waitFor(() => expect(mockMarkLocally).toHaveBeenCalled())
  expect(mockEnqueue).not.toHaveBeenCalled()
})
```

(`invalidateSpy` — spy on the wrapper's `queryClient.invalidateQueries`, exactly as in the Task 6 suite.)

- [ ] **Step 5: Implement the hook**

`src/hooks/useMarkProactiveReadOnOpen.ts`:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { countUnreadProactive, markProactiveReadLocally } from '~/database/messageDatabase'
import { enqueueMarkRead } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'

/**
 * Decision 4: on chat open, clear the dot optimistically (local read_at write +
 * cache invalidation) and hand the ids to the durable mark-read queue. The dot
 * clears the moment the chat opens, not after a server round-trip.
 */
export function useMarkProactiveReadOnOpen(characterId: string | null | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!characterId) return
    let cancelled = false
    void (async () => {
      const unread = await countUnreadProactive(characterId, Date.now())
      if (unread === 0 || cancelled) return
      const ids = await markProactiveReadLocally(characterId)
      if (cancelled || ids.length === 0) return
      await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
      await enqueueMarkRead(ids, markProactiveReadViaCallable)
    })().catch((error: unknown) => {
      console.warn('[proactiveRead] mark-read on open failed:', error)
    })
    return () => {
      cancelled = true
    }
  }, [characterId, queryClient])
}
```

- [ ] **Step 6: Wire into ChatView**

In `src/components/ChatView.tsx` `ChatViewContent` (it has `characterId`), add near the top of the component body:

```tsx
// Decision 4: reading the chat reads the thread — clear the badge now,
// enqueue the durable server receipt.
useMarkProactiveReadOnOpen(characterId)
```

(import the hook.)

- [ ] **Step 7: Run to green (DB tests + hook tests + ChatView suite)**

Run: `npx jest src/database/__tests__/messageDatabase.proactive.test.ts src/hooks/__tests__/useMarkProactiveReadOnOpen.test.tsx src/components/__tests__/ChatView.test.tsx`
Expected: PASS (ChatView suite may need the new hook mocked or a QueryClientProvider added to its wrapper — if it renders `ChatViewContent` without one, add `useMarkProactiveReadOnOpen: jest.fn()` to the existing `jest.mock('~/hooks/...')` block instead; keep the rerender wrapper comment at lines 104-107 intact).

- [ ] **Step 8: Commit**

```bash
git add src/database/messageDatabase.ts src/database/__tests__/messageDatabase.proactive.test.ts src/hooks/useMarkProactiveReadOnOpen.ts src/hooks/__tests__/useMarkProactiveReadOnOpen.test.tsx src/components/ChatView.tsx src/components/__tests__/ChatView.test.tsx
git commit -m "feat(proactive): optimistic local mark-read on chat open

Decision 4: local read_at write clears the dot instantly; ids go through the
durable queue to markProactiveRead; flush rides the sync hook.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Restore the unread dot on `CharacterCard` (Decision 5)

**Files:**

- Modify: `src/components/CharacterCard.tsx` (severed comment at lines 28-34; avatar JSX at line ~64; styles ~line 117)
- Modify: `__tests__/characterCardAccessibility.test.tsx`

**Interfaces:**

- Consumes: `useProactiveUnread(id): { hasUnread: boolean }` (already exists; the accessibility test file already mocks it to `{ hasUnread: false }`).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

In `__tests__/characterCardAccessibility.test.tsx`, the `useProactiveUnread` mock is controlled by a `jest.fn`-backed variable — flip it and assert on the rendered dot (follow the file's existing render + query idiom):

```tsx
it('renders the unread dot when the character has unread proactive messages', () => {
  mockUseProactiveUnread.mockReturnValue({ hasUnread: true })
  // render <CharacterCard .../> the way the file already does
  expect(screen.queryByTestId('proactive-unread-dot')).toBeTruthy()
})

it('renders no dot when there is nothing unread', () => {
  mockUseProactiveUnread.mockReturnValue({ hasUnread: false })
  // render
  expect(screen.queryByTestId('proactive-unread-dot')).toBeNull()
})
```

(If the file's wholesale RN/Paper mocks make `testID` queries fail, assert the way neighboring tests in that file do — adapt, don't fight the harness.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/characterCardAccessibility.test.tsx`
Expected: FAIL — no `proactive-unread-dot` in the tree.

- [ ] **Step 3: Restore the severed code** (exact content per `git show 86de54b5 -- src/components/CharacterCard.tsx`)

1. Import: `import { useProactiveUnread } from '~/hooks/useProactiveUnread'`
2. Replace the severed comment block (lines 28-34) with the hook + comment:

```tsx
// Boolean badge — `countUnreadProactive` already enforces the staleness
// escape, so the dot matches the server's push-decision contract. Deliberately
// a boolean, not a count: AI chats are not an inbox.
const { hasUnread: hasUnreadProactive } = useProactiveUnread(id)
```

3. Inside `styles.avatarContainer` (after `<CharacterAvatar size={48} … />`, line ~64):

```tsx
{
  hasUnreadProactive ? (
    <View
      testID="proactive-unread-dot"
      style={[
        styles.unreadDot,
        { backgroundColor: theme.colors.error, borderColor: theme.colors.surface },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  ) : null
}
```

(the `testID` is the one addition over the severed original — it exists for the test in Step 1.)

4. Restore the style:

```ts
    unreadDot: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
    },
```

- [ ] **Step 4: Run to green**

Run: `npx jest __tests__/characterCardAccessibility.test.tsx`
Expected: PASS (existing tests keep passing — the default mock is `hasUnread: false`).

- [ ] **Step 5: Commit**

```bash
git add src/components/CharacterCard.tsx __tests__/characterCardAccessibility.test.tsx
git commit -m "feat(proactive): restore the character-list unread dot

Severed in 86de54b5 with an explicit un-sever condition (Decisions 2-4 are that
condition): boolean dot driven by useProactiveUnread.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Client registers `capabilities.proactivePush: true` (Decision 1, client half)

**Files:**

- Modify: `src/hooks/useRegisterExpoPushToken.ts` (native write at ~line 121; web path `registerWebPushToken` at ~line 63)
- Modify: `src/config/firebaseConfig.ts` (widen `registerExpoPushTokenFn`'s request type if it constrains the body)
- Create or Modify: `src/hooks/__tests__/useRegisterExpoPushToken.test.ts` (check for an existing suite first — none was found for this hook; create it)

**Interfaces:**

- Consumes: Task 3's wire shape (`capabilities?: { proactivePush?: boolean }`).
- Produces: both registration paths send `capabilities: { proactivePush: true }`.

- [ ] **Step 1: Write the failing test**

`src/hooks/__tests__/useRegisterExpoPushToken.test.ts` — mock `expo-notifications` (permissions granted, `getExpoPushTokenAsync` → `{ data: 'ExponentPushToken[abc]' }`, `getDevicePushTokenAsync` → `{ type: 'expo' }`), `expo-constants`, `~/config/firebaseConfig` (`registerExpoPushTokenFn: jest.fn()`, `appCheckReady: Promise.resolve()`, `getCurrentUser: () => ({})`), `~/auth/devSandboxFlag` (`isDevSandboxEnabled: () => false`), and `Platform` (`OS: 'ios'`). Then:

```ts
it('sends capabilities.proactivePush: true with the native token', async () => {
  renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'proj' }))
  await waitFor(() => expect(mockRegisterFn).toHaveBeenCalled())
  expect(mockRegisterFn).toHaveBeenCalledWith({
    expoPushToken: 'ExponentPushToken[abc]',
    capabilities: { proactivePush: true },
  })
})
```

(A web-path test is optional; if cheap — Platform `OS: 'web'` + mocked `getDevicePushTokenAsync` type `'web'` — add the mirrored assertion for the `registerWebPushToken` payload.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/hooks/__tests__/useRegisterExpoPushToken.test.ts`
Expected: FAIL — payload lacks `capabilities`.

- [ ] **Step 3: Implement**

Native path (~line 121):

```ts
await registerExpoPushTokenFn({
  expoPushToken,
  capabilities: { proactivePush: true },
})
```

Web path (`registerWebPushToken`): add the same field to the `registerExpoPushTokenFn({...})` call. If `registerExpoPushTokenFn` in `src/config/firebaseConfig.ts` is typed, widen its request type to include `capabilities?: { proactivePush?: boolean }`.

- [ ] **Step 4: Run to green + typecheck**

Run: `npx jest src/hooks/__tests__/useRegisterExpoPushToken.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRegisterExpoPushToken.ts src/config/firebaseConfig.ts src/hooks/__tests__/useRegisterExpoPushToken.test.ts
git commit -m "feat(push): declare proactivePush capability at token registration

Decision 1: readiness arrives exactly when a capable client registers; old
clients keep actively writing false via the omitted field.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Full-suite verification + spec status update

**Files:**

- Modify: `docs/superpowers/specs/2026-09-09-proactive-lifecycle-sync-ungate-design.md` (Status: Draft → Implemented; note the resolved flip-test discrepancy)

- [ ] **Step 1: Per-package suites (scoped, then full)**

```bash
cd functions && npm test 2>&1 | tail -4          # expect ≥ 536 passing (522 + 10 + 4), 0 fail
cd ../cloud-agent && npm test 2>&1 | tail -4     # expect ≥ 351 passing + 1 skip, 0 fail
cd .. && npx jest                                # full root run: expect ≥ 158 suites / ≥ 1451 tests, 0 fail
```

If any root suite hangs, re-run scoped (the 122-file unrigged-tree lesson does not apply to the full root run, but react-query suites need `gcTime: 0` — all new tests follow the existing wrapper recipe).

- [ ] **Step 2: Typecheck + lint + format checks (read-only, CI parity)**

```bash
npx tsc --noEmit && cd functions && npx tsc --noEmit && cd ../cloud-agent && npx tsc --noEmit
npm run lint:check 2>&1 | tail -3   # adjust to the repo's actual script names (CI gates are :check variants)
npm run format:check 2>&1 | tail -3 # if this fails on files NOT in `git ls-files`, it is the known untracked-file noise — do not chase it
```

- [ ] **Step 3: Update the spec status + record what shipped**

In the spec: set **Status: Implemented**, and append a short note recording (a) the flip-test discrepancy resolution (flip tests unchanged; Decision 6 wins), (b) the accepted `{reason, remind_at, priority?}` schema fix to `shared/agent-tools-spec.ts`, (c) that Rollout gate stages 2-3 remain open (telemetry re-run after a few days of live edge producer traffic; then the one-line un-gate deploy).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-proactive-lifecycle-sync-ungate-design.md
git commit -m "docs: mark proactive lifecycle-sync spec Implemented

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 5: Open the PR to `staging`**

Include in the PR description: the stage-1 rollout-gate record (the 2026-09-09 all-zeros telemetry run that motivated Decision 0 — three `/agent/run` requests in ~27h), the spec link, this plan link, and a note that stages 2-3 of the rollout gate (telemetry re-run → one-line un-gate deploy) remain open by design. The user merges.

---

## Post-merge (out of scope for tasks; do not skip)

1. Deploy `functions` and `cloud-agent` straight to prod (no staging env exists). Both are behavior-neutral: the push gate stays closed and `proactive_push_ready` defaults `false` for everyone.
2. **Verify traffic landed on the new revisions** (0%-traffic-anomaly playbook — check the revision serving traffic; canary with `--to-revisions` if not).
3. After a few days of real edge-producer traffic, run `functions/scripts/proactiveTelemetry.mjs` — the first true CLAMP RATE + CLAMP REASONS reading — and record it (Rollout gate stage 2).
4. Stage 3 is the follow-up deploy: flip `PROACTIVE_PUSH_ENABLED` to `true` (and update the two flip tests + remove the `'gate'` clamp branch), gated on stage 2's numbers. Decision 1's capability flag bounds the blast radius.
