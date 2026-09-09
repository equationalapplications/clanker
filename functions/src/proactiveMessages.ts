import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from './db/cloudSql.js'
import { characters, messages } from './db/schema.js'
import { userRepository } from './services/userRepository.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'

export const PROACTIVE_SYNC_PAGE_LIMIT = 100

export type ProactiveMessageRow = {
  messageId: string
  characterId: string
  text: string
  createdAt: Date
  readAt: Date | null
}

export type ProactiveMessagePayload = {
  messageId: string
  characterId: string
  text: string
  createdAt: string
  readAt: string | null
}

type ProactiveMessageCursor = {
  createdAt: Date
  messageId: string
}

export type SelectProactiveMessagesArgs = {
  userId: string
  cursor: ProactiveMessageCursor | null
  limit: number
}

type ProactiveMessageDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid'>
  selectProactiveMessages: (args: SelectProactiveMessagesArgs) => Promise<ProactiveMessageRow[]>
  markRead: (args: { userId: string; messageIds: string[] }) => Promise<number>
}

const defaultDeps: ProactiveMessageDeps = {
  userRepository,
  selectProactiveMessages,
  markRead,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function selectProactiveMessages({
  userId,
  cursor,
  limit,
}: SelectProactiveMessagesArgs): Promise<ProactiveMessageRow[]> {
  const db = await getDb()
  const conditions = [
    eq(characters.userId, userId),
    sql`${messages.messageData}->>'proactive' = 'true'`,
    // defaultNow() backfills any missing value at INSERT, so every existing
    // row has a non-null created_at. The predicate also narrows Drizzle's
    // nullable column type down to Date for the cursor bindings.
    isNotNull(messages.createdAt),
  ]
  if (cursor) {
    // Cursor halves are server-issued ISO strings; Postgres coerces both sides
    // to timestamptz consistently. The (created_at, message_id) tuple is the
    // tiebreak that stops a page boundary dropping a row that shares the
    // last row's created_at with the first row of the next page.
    //
    // Postgres stores timestamp with time zone at microsecond precision but
    // node-postgres hands back a JavaScript Date, which is millisecond.
    // Without date_trunc here, a row at 12:00:00.123456 becomes a JS Date
    // rounded DOWN to 12:00:00.123, the cursor goes out as 12:00:00.123, and
    // Postgres sees 12:00:00.123456 > 12:00:00.123 — selecting the same row
    // again. Truncating the column to ms matches the cursor's native
    // precision and makes the round-trip exact.
    const createdAtIso = cursor.createdAt.toISOString()
    conditions.push(
      sql`(date_trunc('milliseconds', ${messages.createdAt}) > ${createdAtIso}::timestamptz OR (date_trunc('milliseconds', ${messages.createdAt}) = ${createdAtIso}::timestamptz AND ${messages.messageId} > ${cursor.messageId}))`,
    )
  }
  const rows = await db
    .select({
      messageId: messages.messageId,
      characterId: messages.characterId,
      text: messages.text,
      createdAt: messages.createdAt,
      readAt: messages.readAt,
    })
    .from(messages)
    .innerJoin(characters, eq(messages.characterId, characters.id))
    .where(and(...conditions))
    // ORDER BY must match the cursor predicate's total order exactly. Postgres
    // stores created_at at microsecond precision; the cursor predicate truncates
    // it to milliseconds (see comment on the date_trunc block above). Ordering
    // by the raw column could disagree with the predicate — a row at
    // .123999 with a smaller message_id could land after a .123456 row, then
    // get skipped on the next page. Truncate here too so page boundary == cursor
    // tuple boundary.
    .orderBy(sql`date_trunc('milliseconds', ${messages.createdAt})`, messages.messageId)
    .limit(limit)
  // isNotNull in the WHERE clause is enforced by the SQL engine but Drizzle
  // still infers the column as nullable. defaultNow() backfills every
  // existing row at INSERT, so any row that returned has a createdAt; the
  // cast just removes the over-cautious union from the type.
  return rows as unknown as ProactiveMessageRow[]
}

async function markRead({
  userId,
  messageIds,
}: {
  userId: string
  messageIds: string[]
}): Promise<number> {
  const db = await getDb()
  // Only ever NULL -> timestamp. The isNull guard makes the write
  // one-directional: a repeat call returns 0 rows affected instead of
  // overwriting the original read_at, so out-of-order retries can't
  // resurrect a cleared badge.
  const updated = await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        inArray(messages.messageId, messageIds),
        isNull(messages.readAt),
        // Scope to characters the caller owns so a user can never mark
        // someone else's messages read.
        sql`EXISTS (SELECT 1 FROM ${characters} WHERE ${characters.id} = ${messages.characterId} AND ${characters.userId} = ${userId})`,
      ),
    )
    .returning({ messageId: messages.messageId })
  return updated.length
}

/**
 * ISO 8601 date-time with a mandatory timezone designator (Z or ±HH:MM).
 * Deliberately stricter than Date.parse, which resolves an offset-less
 * date-time against the server's local zone.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const fetchProactiveMessagesHandler = async (
  request: CallableRequest,
  deps: ProactiveMessageDeps = defaultDeps,
): Promise<{
  messages: ProactiveMessagePayload[]
  nextCursor: { createdAt: string; messageId: string } | null
}> => {
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

  // A NaN check alone is too weak: Date.parse accepts '2026-09-08T12:00:00'
  // (no offset) and resolves it against the runtime's local zone, and accepts
  // loose forms like '2026' or 'Sep 8 2026' outright. Any of those round-trips
  // through toISOString() into PG as a different absolute instant than the
  // caller meant, so the cursor silently walks past rows. This callable is
  // public, so the value need not come from our own client — which always
  // sends toISOString() output. Require an explicit Z or ±HH:MM designator so
  // the instant is unambiguous.
  if (
    cursor &&
    (!ISO_INSTANT.test(sinceCreatedAt as string) || Number.isNaN(cursor.createdAt.getTime()))
  ) {
    throw new HttpsError(
      'invalid-argument',
      'sinceCreatedAt must be an ISO timestamp with a timezone designator.',
    )
  }

  const pageSize =
    typeof limit === 'number' && limit > 0
      ? Math.min(limit, PROACTIVE_SYNC_PAGE_LIMIT)
      : PROACTIVE_SYNC_PAGE_LIMIT

  // The character set is derived server-side. The client never names a
  // character it then gets trusted about.
  const rows = await deps.selectProactiveMessages({
    userId: user.id,
    cursor,
    limit: pageSize,
  })

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

export const fetchProactiveMessages = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => fetchProactiveMessagesHandler(request),
)

export const markProactiveReadHandler = async (
  request: CallableRequest,
  deps: ProactiveMessageDeps = defaultDeps,
): Promise<{ updated: number }> => {
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

  const updated = await deps.markRead({
    userId: user.id,
    messageIds: messageIds as string[],
  })
  return { updated }
}

export const markProactiveRead = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => markProactiveReadHandler(request),
)
