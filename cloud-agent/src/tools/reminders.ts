import { createHash } from 'node:crypto'
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
  /**
   * Stable operation identifier. Same logical args → same opId → same row,
   * so a retry (or a duplicate call from the model) hits ON CONFLICT DO
   * NOTHING on the primary key instead of inserting a duplicate the sweep
   * would double-fire. The escalation path is responsible for deriving this
   * — it has no caller-driven opId supply.
   */
  opId: string
}

/**
 * Canonical string for a set_reminder operation. Mirrored exactly in
 * src/services/edgeToolExecutors.ts (exported as `reminderOpIdCanonical`):
 * both set_reminder entry points (escalation and edge) must hash identical
 * bytes here, so the opId they produce agrees across the two paths and the
 * server's ON CONFLICT DO NOTHING collapses them onto the same row.
 *
 * `remindAt` is the RAW ISO string from the model — NOT a parsed Date —
 * because Date#toISOString normalises the offset to "Z" while the edge input
 * may carry "+02:00", and the two would hash to different bytes for the same
 * wall-clock moment. The packages cannot share a module; keep the format
 * equal by hand.
 */
export function reminderOpIdCanonical(args: {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}): string {
  return `${args.characterId}|${args.reason.trim()}|${args.remindAt}|${args.priority ?? 0}`
}

/**
 * Deterministic operation id: same (character, reason, remindAt, priority) →
 * same opId, so a network retry lands on the same server row (the insert's
 * ON CONFLICT DO NOTHING) instead of inserting a duplicate the sweep would
 * double-fire. SHA-256 (256-bit) over the canonical string — 256 bits of
 * entropy, well above the FNV-1a 32-bit budget that collided on a real test
 * corpus. Mirrors the same helper in src/services/edgeToolExecutors.ts.
 */
export async function deriveOpId(args: {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}): Promise<string> {
  const hex = createHash('sha256').update(reminderOpIdCanonical(args), 'utf8').digest('hex')
  return `op-${hex}`
}

export function buildWakeupInsert(args: WakeupInsertArgs) {
  return {
    id: args.opId,
    characterId: args.characterId,
    userId: args.userId,
    reason: args.reason,
    dueAt: args.dueAt,
    priority: args.priority,
    status: 'pending' as const,
    runKey: args.opId,
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
      remind_at: z.iso
        .datetime({ offset: true })
        .describe('ISO 8601 datetime with timezone offset (Z or ±HH:MM), in the future.'),
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

        // Canonical-string input uses the RAW `remind_at` (not
        // `dueAt.toISOString()`) so the SHA-256 bytes match the edge side's
        // bytes for the same wall-clock moment — see reminderOpIdCanonical.
        const opId = await deriveOpId({
          characterId,
          reason: reason.trim(),
          remindAt: remind_at,
          priority: priority ?? 0,
        })
        // ON CONFLICT DO NOTHING so a retry from the same logical call lands
        // on the existing row instead of inserting a duplicate the sweep
        // would double-fire. The cloud-agent path has no client-driven opId
        // supply, so the deterministic hash is what collapses retries.
        await db
          .insert(scheduledWakeups)
          .values(
            buildWakeupInsert({
              userId,
              characterId,
              reason: reason.trim(),
              dueAt,
              priority: priority ?? 0,
              opId,
            }),
          )
          .onConflictDoNothing({ target: scheduledWakeups.id })
        return formatReminderResult({ scheduled: true, dueAt: dueAt.toISOString() })
      } catch (error) {
        console.error('[CloudAgent] set_reminder failed:', error)
        return 'Not scheduled: an internal error occurred.'
      }
    },
  })
}
