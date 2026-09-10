# Proactive Sweep Per-Statement DB Deadlines — Design

**Date:** 2026-09-09
**Status:** Implemented
**Resolves:** issue #706
**Related:** [2026-09-08-proactive-character-scheduler-design.md](2026-09-08-proactive-character-scheduler-design.md) · PR #705 (`b99f3685`, added `SWEEP_RESERVE_MS`) · `6cc3bda7` (added the pool-wide `statement_timeout`)

## Problem

A claimed wake-up row is stranded whenever the sweep dies between `claim`
(successful UPDATE) and `resolveWakeup`: `selectDue` reads only `pending`, so
the row is invisible until `reapStaleClaims` marks it terminally `skipped` an
hour later. The wake-up is lost.

PR #705's `SWEEP_RESERVE_MS` keeps the sweep from _claiming_ near the wall-clock
budget boundary, and commit `6cc3bda7` bounded every statement on the shared
Cloud SQL pool with a pool-wide `statement_timeout: 10_000` — satisfying
acceptance criteria 1, 2, and 4 of issue #706 (pool timeout configured, no
connector swap, guardrails caveat removed).

What `6cc3bda7` does **not** do is bound a pathological hang to the sweep's own
budget. `statement_timeout` is per _statement_, and `loadContext` runs five of
them after the claim has succeeded. Worst case each takes 10s: up to ~50s spent
on one already-claimed row inside a 60s `timeoutSeconds` / 45s loop budget. The
platform kill or the loop's budget stop then lands with the row `claimed` and
`resolved_at` NULL — stranded until the reaper. There is also no test anywhere
asserting deadline behavior (AC3); `db/cloudSql.ts` refuses to connect under
`NODE_ENV=test`, so the pool config is verified only by reading it.

## Goals

- `claim` and `loadContext` — the two ops that run between the budget check and
  the POST — each get a deadline far tighter than the pool's 10s, so a hung
  statement aborts while the sweep still has room to log, continue, and finish
  its remaining rows and tail.
- Deadlines are scoped per operation and never leak onto other users of the
  shared `getDb()` pool (`generateReply`, `creditService`, `wikiSync`, …).
- A regression test proves a statement that exceeds its deadline is terminated
  loudly (surfaced error, sweep survives) rather than silently.

## Non-goals

- No change to `WAKEUP_POST_TIMEOUT_MS`, `SWEEP_RESERVE_MS`, or
  `SWEEP_TIME_BUDGET_MS` — those are wall-clock budgets; statement deadlines
  compose with them.
- No change to the pool-wide `statement_timeout: 10_000` in `db/cloudSql.ts`.
  It remains the backstop for ops whose per-op deadline is misconfigured and
  for every non-sweep consumer of the pool.
- No change to `reapStaleClaims` (still 1h) — the reaper is the recovery path
  when deadlines fail; deadlines only shrink how often it is needed.
- No connector swap. `@google-cloud/cloud-sql-connector`'s `getOptions()`
  returns `node-postgres` client options, and the deadline mechanism below
  speaks ordinary Postgres over the resulting pool.

## Design

### Mechanism: transaction-scoped deadlines

A helper in `proactiveWakeupSweep.ts` (next to `buildSweepDeps`):

```ts
async function withStatementTimeout<T>(
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

Why this shape:

- **`set_config(name, value, is_local => true)`**, not `SET LOCAL`: Postgres
  rejects bind parameters on bare `SET` (utility statements don't accept
  placeholders), so the drizzle-parameterized form must go through
  `set_config`. `is_local = true` scopes the setting to the current
  transaction — it reverts at COMMIT and ROLLBACK, so no other query on the
  pooled connection ever sees the deadline.
- **Server-side kill.** Postgres cancels the statement itself (SQLSTATE
  `57014`, `query_canceled`); the connection stays usable and returns to the
  pool. This is what a client-side `Promise.race` timer cannot do — a raced
  timeout throws into the per-row catch but leaves the server query running and
  the connection busy until the pool-wide 10s frees it, starving a `max: 5`
  pool.
- **Overhead:** BEGIN/COMMIT add ~2 same-region roundtrips per wrapped op —
  sub-millisecond against Cloud SQL, bounded by `SWEEP_BATCH_LIMIT` rows per
  sweep.

### Deadlines per operation

New constants in `proactiveWakeupGuardrails.ts`, documented as per-op
deadlines composing with the wall-clock budgets:

| Constant                     | Value | Applied to                                                                                                                    |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CLAIM_DEADLINE_MS`          | 500   | `claim` (one UPDATE on an indexed row; normal completion is tens of ms)                                                       |
| `LOAD_CONTEXT_DEADLINE_MS`   | 1500  | each of `loadContext`'s five SELECTs (one transaction; worst case 5 × 1.5s), matching the issue's "one on the wrapper" option |
| `SWEEP_STATEMENT_DEFAULT_MS` | 2_000 | `selectDue`, `resolveWakeup`, `reapStaleClaims`, `deleteExpired`                                                              |

`loadContext`'s five SELECTs share one transaction, which scopes the deadline
and keeps the op on a single connection; it does **not** confer snapshot
isolation — under READ COMMITTED each SELECT still sees its own snapshot, so
the spend/count rows can still shift between reads exactly as before.

### Error handling — stranding semantics unchanged

A `57014` abort propagates into the existing per-row `try/catch` in
`proactiveWakeupSweepHandler`, which logs and continues:

- Deadline fires during `claim`: the row may or may not have taken the UPDATE —
  if it did, it is stranded exactly as today; the reaper recovers it.
- Deadline fires during `loadContext`: the claim already succeeded, so the row
  is stranded as today; the reaper recovers it.

The deadlines do not eliminate stranding — they shrink the window in which the
wall-clock budget can be exhausted mid-loop, so one hung row no longer costs
the rest of the batch its turn.

### Wiring

`buildSweepDeps` wraps each op's queries with `withStatementTimeout(db, <const>, …)`.
The `DbLike` type stays as-is; `db.transaction` is part of `NodePgDatabase`.

## Testing

**Unit** (`functions/src/proactiveWakeupSweep.test.ts`, node:test):

1. The fake `dbFactory` gets a stub whose `transaction` captures the
   `set_config` value and runs the callback on a pass-through tx — asserts
   `claim` receives `CLAIM_DEADLINE_MS` and `loadContext` receives
   `LOAD_CONTEXT_DEADLINE_MS` (the AC3 "budget boundary" check at the wiring
   level).
2. A `loadContext` stub whose delay exceeds the deadline it was handed rejects
   with a `57014`-style error — asserts the handler logs the row, leaves it
   claimed (not skipped), and continues to the next row and the reap/delete
   tail ("terminated loudly, not silently").

**Integration** (`functions/src/integration/proactiveWakeupSweep.int.test.ts`,
existing local `clanker_test` harness):

3. Seed a due row, run the real `buildSweepDeps` against Postgres, and inject
   slowness with `pg_sleep` via a test-only dbFactory wrapper:
   - `claim`: prepend `SELECT pg_sleep(0.6)` inside the claim transaction —
     0.6s exceeds the 500ms `CLAIM_DEADLINE_MS` but stays far below the pool's
     10s backstop, so the per-op deadline (not the pool timeout) is what fires.
   - `loadContext`: prepend `SELECT pg_sleep(2.0)` — 2s exceeds the 1500ms
     `LOAD_CONTEXT_DEADLINE_MS`.
     Both cases assert the sweep surfaces the cancellation (SQLSTATE `57014`),
     the row is **not** resolved as `skipped` by this sweep, and later rows in
     the batch still process.

## Acceptance criteria (updated for current state)

1. ~~Pool statement timeout~~ — **done** (`6cc3bda7`, `db/cloudSql.ts:86`).
2. ~~Connector sufficiency~~ — **done**: `getOptions()` feeds a `pg.Pool`;
   deadlines use ordinary SQL, no connector change.
3. Regression test exercising a delayed `claim`/`loadContext` against the
   budget boundary — **this spec** (unit items 1–2, integration item 3).
4. ~~Guardrails caveat removal~~ — **done** (`6cc3bda7`); this spec's landing
   adds the per-op constants' documentation.

## Risks

- **Drizzle tx type friction.** `db.transaction`'s callback hands a
  `PgTransaction`, not `DbLike`; the helper casts. If the cast rots under a
  drizzle upgrade, the failure is a compile error, not a runtime drift.
- **Tighter deadlines are new failure modes.** A future query in these ops that
  legitimately needs >2s (e.g. `messages` growing unindexed under
  `messageData->>'proactive'`) starts aborting where it previously crawled.
  Mitigation: the abort is loud (logged, counted in the row catch), and the
  constant sits next to the queries it bounds.
- **set_config spelling.** If `set_config`'s third argument is ever dropped,
  the deadline would leak past COMMIT onto the shared pool — the unit test's
  `set_config` assertion pins the `is_local = true` argument.
