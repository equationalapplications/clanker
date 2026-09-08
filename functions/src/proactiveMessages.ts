import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
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
}

const defaultDeps: ProactiveMessageDeps = {
  userRepository,
  selectProactiveMessages,
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
    const createdAtIso = cursor.createdAt.toISOString()
    conditions.push(
      sql`(${messages.createdAt} > ${createdAtIso} OR (${messages.createdAt} = ${createdAtIso} AND ${messages.messageId} > ${cursor.messageId}))`,
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
    .orderBy(messages.createdAt, messages.messageId)
    .limit(limit)
  // isNotNull in the WHERE clause is enforced by the SQL engine but Drizzle
  // still infers the column as nullable. defaultNow() backfills every
  // existing row at INSERT, so any row that returned has a createdAt; the
  // cast just removes the over-cautious union from the type.
  return rows as unknown as ProactiveMessageRow[]
}

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

  if (cursor && Number.isNaN(cursor.createdAt.getTime())) {
    throw new HttpsError('invalid-argument', 'sinceCreatedAt must be an ISO timestamp.')
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
