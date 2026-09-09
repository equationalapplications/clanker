import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import { and, desc, eq, gte, isNull, lt, ne, sql, sum } from 'drizzle-orm'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getDb } from './db/cloudSql.js'
import * as schema from './db/schema.js'
import { messages, scheduledWakeups, subscriptions, users } from './db/schema.js'
import {
  decideWakeup,
  utcDayStart,
  SWEEP_BATCH_LIMIT,
  STALE_CLAIM_TIMEOUT_MS,
  SWEEP_RESERVE_MS,
  SWEEP_TIME_BUDGET_MS,
  UNREAD_STALENESS_ESCAPE_MS,
  WAKEUP_POST_TIMEOUT_MS,
  WAKEUP_RETENTION_DAYS,
} from './services/proactiveWakeupGuardrails.js'

/**
 * What buildSweepDeps needs from a Drizzle client: the query builder, and
 * nothing else. Deliberately not `Awaited<ReturnType<typeof getDb>>` — that
 * also carries Cloud SQL's `$client: Pool`, which none of the queries below
 * touch and which the integration suite's client does not expose.
 */
type DbLike = NodePgDatabase<typeof schema>

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
  loadContext: (row: DueWakeup, now: Date, dayStart: Date) => Promise<WakeupContext>
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
  reapStaleClaims: (claimedBefore: Date) => Promise<number>
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
    // Stop before claiming anything this sweep cannot finish. Checked at the
    // top of the iteration, ahead of the claim, because it is the claim that
    // does the damage: a row killed after claiming is stranded until the
    // reaper, while a row never claimed is simply still pending on the next
    // tick. Reservation covers WAKEUP_POST_TIMEOUT_MS (the worst case where a
    // POST hangs until it aborts) plus SWEEP_RESERVE_MS for the DB roundtrips
    // in claim and loadContext, so a slow loadContext cannot push the sweep
    // into its last ten seconds of budget and then be killed during POST.
    const elapsedMs = deps.now().getTime() - now.getTime()
    if (elapsedMs + WAKEUP_POST_TIMEOUT_MS + SWEEP_RESERVE_MS > SWEEP_TIME_BUDGET_MS) {
      logger.info('Proactive sweep stopped early on time budget', {
        elapsedMs,
        claimed: posted + skipped,
        remaining: due.length - (posted + skipped),
      })
      break
    }

    try {
      // Claim BEFORE deciding, not after. An overlapping sweep that started
      // a few seconds earlier can read this row in pending, resolve it as
      // 'claimed' or terminal in between our selectDue and our resolveWakeup.
      // resolveWakeup updates by id only, so without this reorder a
      // concurrent sweep's POST could land just as we decided to skip and
      // our write would overwrite its 'claimed'/'done' with 'skipped'.
      // Acquiring ownership atomically first pins the row to this sweep.
      const won = await deps.claim(row.id, now)
      if (!won) continue

      const context = await deps.loadContext(row, now, dayStart)
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

  // Reap before deleting. A row whose claim succeeded but whose POST failed
  // (timeout, 429, cloud-agent restart) stays 'claimed'/'running' with a NULL
  // resolved_at: selectDue only reads 'pending', so it is never retried, and
  // deleteExpired filters on resolved_at, which no NULL row can satisfy. Left
  // alone these accumulate forever. Resolving them terminally first gives them
  // a resolved_at, so ordinary retention can collect them on a later pass.
  const staleClaimCutoff = new Date(now.getTime() - STALE_CLAIM_TIMEOUT_MS)
  const reaped = await deps.reapStaleClaims(staleClaimCutoff)

  const cutoff = new Date(now.getTime() - WAKEUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deleted = await deps.deleteExpired(cutoff)

  logger.info('Proactive wake-up sweep complete', {
    due: due.length,
    posted,
    skipped,
    reaped,
    deleted,
  })
}

/**
 * Real Drizzle-backed implementation. Wired here so the handler stays pure and
 * the unit tests stay independent of a live Postgres.
 *
 * `dbFactory` is injectable purely so the integration suite can point these
 * queries at the local `clanker_test` database: `getDb()` refuses to connect
 * under NODE_ENV=test and otherwise reaches for the real Cloud SQL connector,
 * so without this seam the SQL below could only ever be exercised against
 * production. Production callers use the default.
 */
export function buildSweepDeps(dbFactory: () => Promise<DbLike> = getDb): SweepDeps {
  return {
    now: () => new Date(),
    async selectDue(limit: number): Promise<DueWakeup[]> {
      const db = await dbFactory()
      const rows = await db
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
        .limit(limit)
      return rows
    },
    async loadContext(row: DueWakeup, now: Date, dayStart: Date): Promise<WakeupContext> {
      const db = await dbFactory()

      const [subRow] = await db
        .select({ currentCredits: subscriptions.currentCredits })
        .from(subscriptions)
        .where(eq(subscriptions.userId, row.userId))
        .limit(1)

      const [spendRow] = await db
        .select({ total: sum(scheduledWakeups.spentAmount) })
        .from(scheduledWakeups)
        .where(
          and(
            eq(scheduledWakeups.characterId, row.characterId),
            gte(scheduledWakeups.resolvedAt, dayStart),
            ne(scheduledWakeups.status, 'pending'),
            ne(scheduledWakeups.status, 'claimed'),
            // 'running' rows have not written spent_amount back yet; counting
            // them would read 0 and understate the day, and they are excluded
            // by the resolved_at filter anyway. Named explicitly so the set of
            // non-terminal statuses stays obvious at the call site.
            ne(scheduledWakeups.status, 'running'),
          ),
        )

      const [pushRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(scheduledWakeups)
        .where(
          and(
            eq(scheduledWakeups.characterId, row.characterId),
            gte(scheduledWakeups.resolvedAt, dayStart),
            eq(scheduledWakeups.deliveryMode, 'notify'),
          ),
        )

      const staleCutoff = new Date(now.getTime() - UNREAD_STALENESS_ESCAPE_MS)
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

      // Proactive messages are excluded: they are written with the owner's
      // userId as sender (cloud-agent), exactly like user-authored rows, so the
      // JSON marker is the only thing that tells them apart. Counting them here
      // would let a wake-up re-arm the notify cooldown against itself — the
      // sweep posts at T, reads its own row back as `lastUserMessageAt` at
      // T+5min, and suppresses notify for the next cooldown window even though
      // the user has done nothing. The spec defines this window against the
      // user's last message.
      // Typed as string, not Date, because that is what actually comes back: a
      // raw sql<> select bypasses Drizzle's column decoding, so the timestamptz
      // arrives as the driver's text form ('2026-09-09 15:44:28.204308+00')
      // even though plain pg would hand back a Date. Declaring it Date compiled
      // fine and then threw at runtime, where decideWakeup calls .getTime() on
      // it — inside the per-row try/catch, so every wake-up for a character
      // whose user had ever spoken failed as a logged 'Proactive wake-up
      // failed' and stranded the row until the reaper. Parse it explicitly.
      const [lastMsgRow] = await db
        .select({ lastAt: sql<string | null>`MAX(${messages.createdAt})` })
        .from(messages)
        .where(
          and(
            eq(messages.characterId, row.characterId),
            sql`${messages.messageData}->>'proactive' is distinct from 'true'`,
          ),
        )

      return {
        balance: subRow?.currentCredits ?? 0,
        todaysProactiveSpend: Number(spendRow?.total ?? 0),
        todaysPushCount: Number(pushRow?.count ?? 0),
        lastUserMessageAt: lastMsgRow?.lastAt ? new Date(lastMsgRow.lastAt) : null,
        unreadProactiveCount: Number(unreadRow?.count ?? 0),
      }
    },
    async claim(id: string, claimedAt: Date): Promise<boolean> {
      const db = await dbFactory()
      // AND status = 'pending' is the race-safety guard: two overlapping sweeps
      // both SELECT the same row, but only the first UPDATE matches a row still
      // in 'pending' status. The second returns rowCount = 0 and we skip.
      const result = await db
        .update(scheduledWakeups)
        .set({ status: 'claimed', claimedAt })
        .where(and(eq(scheduledWakeups.id, id), eq(scheduledWakeups.status, 'pending')))
      return result.rowCount === 1
    },
    async postWakeup(payload): Promise<void> {
      const url = process.env.CLOUD_AGENT_URL
      const secret = process.env.SCHEDULER_SECRET
      if (!url) throw new Error('Missing required environment variable: CLOUD_AGENT_URL')
      if (!secret) throw new Error('Missing required environment variable: SCHEDULER_SECRET')
      const res = await fetch(`${url}/agent/proactive-wakeup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(payload),
        // Per-row timeout. Without it a hung connection would consume the
        // whole sweep budget (60s schedule timeout) and abandon every other
        // claimed row in the batch.
        signal: AbortSignal.timeout(WAKEUP_POST_TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new Error(`proactive-wakeup POST failed: ${res.status}`)
      }
    },
    async resolveWakeup(id, patch): Promise<void> {
      const db = await dbFactory()
      await db
        .update(scheduledWakeups)
        .set({ status: patch.status, outcome: patch.outcome, resolvedAt: new Date() })
        .where(eq(scheduledWakeups.id, id))
    },
    async reapStaleClaims(claimedBefore: Date): Promise<number> {
      const db = await dbFactory()
      // spent_amount is left as-is rather than zeroed: if the turn did commit a
      // spend before dying, that money was really taken and the day's ceiling
      // should keep counting it. The status becomes terminal so the row stops
      // being invisible to both selectDue and deleteExpired.
      const reaped = await db
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
    },
    async deleteExpired(cutoff: Date): Promise<number> {
      const db = await dbFactory()
      const deleted = await db
        .delete(scheduledWakeups)
        .where(lt(scheduledWakeups.resolvedAt, cutoff))
        .returning({ id: scheduledWakeups.id })
      return deleted.length
    },
  }
}

export const proactiveWakeupSweep = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-central1',
    // LOAD-BEARING, not a performance knob. Nothing in this function serialises
    // sweeps against each other: the per-row claim stops two sweeps double-firing
    // the same row, but it cannot stop them working different rows of the SAME
    // character concurrently. Two such sweeps each read `todaysProactiveSpend`
    // before either has written its spend back (cloud-agent commits spentAmount
    // just before it answers the POST), so both see the same total and
    // DAILY_PROACTIVE_POWER_CEILING leaks by roughly one turn per overlapping
    // sweep. What prevents that today is arithmetic, not a lock: this timeout is
    // far below the five-minute schedule, so a sweep is always dead before the
    // next one starts.
    //
    // Therefore: keep this well under 300. Raising it toward the 540 used by
    // convertDocumentText/wikiLlm silently authorises overlapping sweeps and
    // un-caps proactive spend. If a sweep needs more time, give the loop a time
    // budget so it stops claiming rows near the deadline — do not buy time here.
    //
    // Pinned rather than left to the platform default so a firebase-tools or
    // Cloud Run default change cannot move it without this line changing.
    timeoutSeconds: 60,
    secrets: [...CLOUD_SQL_SECRETS, 'SCHEDULER_SECRET'],
  },
  async (event: ScheduledEvent) => {
    void event
    await proactiveWakeupSweepHandler(buildSweepDeps())
  },
)
