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

/**
 * Per-row POST budget when claiming a wake-up. The schedule has 60s total and
 * rows are processed sequentially inside the loop; one hung cloud-agent
 * connection would otherwise consume the whole sweep budget and abandon every
 * other claimed row until reapStaleClaims marked them skipped (and skipped
 * rows are terminal — selectDue only reads 'pending'). 10s is well below the
 * 60s schedule timeout but generous enough for normal turn latency.
 */
export const WAKEUP_POST_TIMEOUT_MS = 10_000

/**
 * Wall-clock budget for the sweep's row loop, leaving the rest of the 60s
 * timeoutSeconds for the reap/delete tail that runs after it.
 *
 * SWEEP_BATCH_LIMIT rows at WAKEUP_POST_TIMEOUT_MS each is a 500s worst case
 * against a 60s function timeout, so without a budget the platform can kill the
 * loop mid-row. A row killed after its claim stays 'claimed' with a NULL
 * resolved_at: selectDue reads only 'pending', so it is never retried, and it
 * sits invisible until reapStaleClaims marks it terminally skipped. The
 * wake-up is lost and any spend the turn already committed is still charged.
 *
 * The loop therefore stops claiming once it cannot fit another worst-case row,
 * leaving the remainder 'pending' for the next tick — untouched, not skipped.
 * This is the "give the loop a time budget" the onSchedule comment prescribes
 * as the correct response to needing more time, instead of raising
 * timeoutSeconds (which would authorise overlapping sweeps and un-cap spend).
 *
 * The tail is best-effort, not guaranteed: the loop can exit as late as
 * ~45s, and a tail statement that stalls up to the pool's statement_timeout
 * can still push the sweep past 60s. Both tail statements are idempotent and
 * retried by the next tick, so a lost tail costs one tick of reaping/retention
 * latency, not data — but anything alerting on the reaped/deleted counters
 * must tolerate a silently missing tick.
 */
export const SWEEP_TIME_BUDGET_MS = 45_000

/**
 * Reserve added to the pre-claim budget check on top of WAKEUP_POST_TIMEOUT_MS,
 * covering the DB roundtrips in `claim` (one UPDATE) and `loadContext` (five
 * SELECTs against indexed columns) before the POST runs. claim + loadContext
 * complete in well under a second in normal conditions; this reserve exists
 * so that a slow loadContext cannot push the sweep into its last ten seconds
 * of budget and then be killed during POST — which would strand a freshly
 * claimed row. Pathological hangs in claim/loadContext are bounded by the
 * pool-wide statement_timeout in db/cloudSql.ts, not by this reserve: a hung
 * statement aborts, the row throws into the per-row catch, and the sweep
 * survives instead of being killed mid-POST.
 */
export const SWEEP_RESERVE_MS = 2_000

/**
 * A row claimed longer ago than this is presumed abandoned — its POST died
 * before cloud-agent could resolve it. Generously above the sweep's 60s
 * timeoutSeconds (pinned in proactiveWakeupSweep.ts) so a slow-but-live turn is
 * never reaped out from under itself.
 */
export const STALE_CLAIM_TIMEOUT_MS = 3_600_000

// A dropped markProactiveRead would otherwise leave the server believing the
// user is ignoring this character and suppress every future push from it —
// permanently, silently, with no user-visible symptom. After this long an
// unread message stops blocking. Mirrored in src/constants/proactive.ts.
export const UNREAD_STALENESS_ESCAPE_MS = 604_800_000

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
