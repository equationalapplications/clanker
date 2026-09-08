import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import { and, desc, eq, gte, lt, ne, sql, sum } from 'drizzle-orm'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { getDb } from './db/cloudSql.js'
import { messages, scheduledWakeups, subscriptions, users } from './db/schema.js'
import {
  decideWakeup,
  utcDayStart,
  SWEEP_BATCH_LIMIT,
  STALE_CLAIM_TIMEOUT_MS,
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
 * the tests stay independent of a live Postgres.
 */
export function buildSweepDeps(): SweepDeps {
  return {
    now: () => new Date(),
    async selectDue(limit: number): Promise<DueWakeup[]> {
      const db = await getDb()
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
    async loadContext(row: DueWakeup, dayStart: Date): Promise<WakeupContext> {
      const db = await getDb()

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

      const [lastMsgRow] = await db
        .select({ lastAt: sql<Date | null>`MAX(${messages.createdAt})` })
        .from(messages)
        .where(eq(messages.characterId, row.characterId))

      // Phase 1 delivers nothing, so there is no delivered-then-unread queue to
      // count. Returning 0 lets the guardrail correctly treat every wake-up as
      // eligible to notify until the push-count or cooldown check fires.
      return {
        balance: subRow?.currentCredits ?? 0,
        todaysProactiveSpend: Number(spendRow?.total ?? 0),
        todaysPushCount: Number(pushRow?.count ?? 0),
        lastUserMessageAt: lastMsgRow?.lastAt ?? null,
        unreadProactiveCount: 0,
      }
    },
    async claim(id: string, claimedAt: Date): Promise<boolean> {
      const db = await getDb()
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
      })
      if (!res.ok) {
        throw new Error(`proactive-wakeup POST failed: ${res.status}`)
      }
    },
    async resolveWakeup(id, patch): Promise<void> {
      const db = await getDb()
      await db
        .update(scheduledWakeups)
        .set({ status: patch.status, outcome: patch.outcome, resolvedAt: new Date() })
        .where(eq(scheduledWakeups.id, id))
    },
    async reapStaleClaims(claimedBefore: Date): Promise<number> {
      const db = await getDb()
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
      const db = await getDb()
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
    secrets: [...CLOUD_SQL_SECRETS, 'SCHEDULER_SECRET'],
  },
  async (event: ScheduledEvent) => {
    void event
    await proactiveWakeupSweepHandler(buildSweepDeps())
  },
)
