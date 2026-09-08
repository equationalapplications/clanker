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
