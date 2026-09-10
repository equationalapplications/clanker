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
//
// `opId` is a client-minted stable operation identifier — required so retries
// from the same logical operation collapse onto the same row. The caller (the
// edge executor) mints it once per intent and reuses it on every retry. Server
// uses it as the row's primary key, and the insert path is ON CONFLICT DO
// NOTHING so the second attempt returns the existing row's dueAt instead of
// creating a duplicate that the sweep would later double-fire.
export interface WakeupInsertArgs {
  userId: string
  characterId: string
  reason: string
  dueAt: Date
  priority: number
  opId: string
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
  // Returns true when a new row was inserted, false when an existing row with
  // the same opId was found and left untouched.
  insertWakeup: (row: ReturnType<typeof buildWakeupInsert>) => Promise<boolean>
  // Reads back an existing row's dueAt for the conflict-returned path. The
  // caller passes the opId (the row's id).
  findWakeupDueAt: (opId: string) => Promise<Date | null>
}

async function characterOwnedBy(characterId: string, userId: string): Promise<boolean> {
  const db = await getDb()
  const [row] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
  return row !== undefined
}

async function todaysProactiveSpend(characterId: string, now: Date): Promise<number> {
  const db = await getDb()
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

async function insertWakeup(row: ReturnType<typeof buildWakeupInsert>): Promise<boolean> {
  // ON CONFLICT DO NOTHING so a retry with the same opId (the row's primary
  // key) leaves the existing row untouched. The sweep would otherwise see two
  // pending rows for the same logical operation and POST twice.
  const result = await (await getDb())
    .insert(scheduledWakeups)
    .values(row)
    .onConflictDoNothing({ target: scheduledWakeups.id })
  return (result.rowCount ?? 0) === 1
}

async function findWakeupDueAt(opId: string): Promise<Date | null> {
  const db = await getDb()
  const [row] = await db
    .select({ dueAt: scheduledWakeups.dueAt })
    .from(scheduledWakeups)
    .where(eq(scheduledWakeups.id, opId))
    .limit(1)
  return row?.dueAt ?? null
}

const defaultDeps: ScheduleWakeupDeps = {
  userRepository,
  characterOwnedBy,
  todaysProactiveSpend,
  insertWakeup,
  findWakeupDueAt,
}

type ScheduleWakeupData = {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
  opId: string
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
  if (typeof d.opId !== 'string' || d.opId.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'opId must be a non-empty stable operation identifier.',
    )
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
    opId: d.opId,
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
    opId: data.opId,
  })
  const wasInserted = await deps.insertWakeup(row)
  if (!wasInserted) {
    // The opId already has a row — a retry from the same logical operation.
    // Return that row's dueAt so the caller sees a stable answer across
    // retries. If the row has since been deleted we report the originally
    // requested dueAt: the caller's intent is still valid for that time.
    const existingDueAt = await deps.findWakeupDueAt(data.opId)
    const dueAtIso = (existingDueAt ?? dueAt).toISOString()
    return {
      ok: true,
      message: `Scheduled. You will wake up at ${dueAtIso} to follow up on this.`,
      dueAt: dueAtIso,
    }
  }
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
