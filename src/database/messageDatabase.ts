/**
 * Local SQLite message database service
 * Local-first architecture with optional server sync via Firebase callables
 */

import type { Message } from '~/types/chat'
import { getDatabase } from './index'
import { UNREAD_STALENESS_ESCAPE_MS } from '~/constants/proactive'

export interface LocalMessage {
  id: string
  character_id: string
  sender_user_id: string
  recipient_user_id: string | null
  text: string
  created_at: number
  message_data: string // JSON stringified Message data
  pending: number // 0 or 1 (SQLite boolean)
  sent: number // 0 or 1
  error: number // 0 or 1
  edited: number // 0 or 1
  synced_at: number | null // null = not synced to cloud
  read_at: number | null
}

// Wire shape produced by the server-side `fetchProactiveMessages` callable (Task 7).
// Mirrors `functions/src/proactiveMessages.ts` ProactiveMessagePayload; kept
// local rather than imported across the functions/ boundary because the
// functions/ tree is a separate package.
export interface ProactiveMessagePayload {
  messageId: string
  characterId: string
  text: string
  createdAt: string
  readAt: string | null
}

/**
 * Convert LocalMessage to Message format for GiftedChat
 */
function toGiftedChatMessage(
  msg: LocalMessage,
  currentUserId: string,
): Message & { character_id: string } {
  const isUserMessage = msg.sender_user_id === currentUserId

  return {
    // Spread extra data first so canonical fields always take precedence
    ...(msg.message_data ? JSON.parse(msg.message_data) : {}),
    _id: msg.id,
    text: msg.text,
    createdAt: new Date(msg.created_at),
    user: {
      _id: msg.sender_user_id,
      name: isUserMessage ? 'You' : 'Character',
    },
    character_id: msg.character_id,
    pending: msg.pending === 1,
    sent: msg.sent === 1,
  }
}

interface ExpectedMessageRow {
  characterId: string
  senderUserId: string
  recipientUserId: string | null
  text: string
  messageData: string
  syncedAt?: number | null
}

export function resolveCreatedAtMs(additionalData?: Partial<Message>): number {
  const value = additionalData?.createdAt
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

async function resolveInsertConflict(
  db: Awaited<ReturnType<typeof getDatabase>>,
  id: string,
  userId: string,
  expected: ExpectedMessageRow,
): Promise<Message & { character_id: string }> {
  const existing = await db.getFirstAsync<LocalMessage>('SELECT * FROM messages WHERE id = ?', [id])
  if (!existing) {
    throw new Error(`Message insert conflict for id ${id} but no row found`)
  }

  if (
    existing.character_id !== expected.characterId ||
    existing.sender_user_id !== expected.senderUserId ||
    existing.recipient_user_id !== expected.recipientUserId ||
    existing.text !== expected.text
  ) {
    throw new Error(`Message id collision for ${id}: existing row does not match replay payload`)
  }

  const messageDataChanged = existing.message_data !== expected.messageData
  const syncedAtChanged =
    expected.syncedAt !== undefined && existing.synced_at !== expected.syncedAt

  if (messageDataChanged || syncedAtChanged) {
    await db.runAsync(
      'UPDATE messages SET message_data = ?, synced_at = COALESCE(?, synced_at) WHERE id = ?',
      [expected.messageData, expected.syncedAt ?? null, id],
    )
    const updated = await db.getFirstAsync<LocalMessage>('SELECT * FROM messages WHERE id = ?', [
      id,
    ])
    if (!updated) {
      throw new Error(`Message row missing after merge update for id ${id}`)
    }
    return toGiftedChatMessage(updated, userId)
  }

  return toGiftedChatMessage(existing, userId)
}

/**
 * Get all messages for a character conversation
 */
export async function getMessages(
  characterId: string,
  userId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<Message[]> {
  const db = await getDatabase()

  const messages = await db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     ORDER BY created_at DESC, rowid DESC 
     LIMIT ? OFFSET ?`,
    [characterId, userId, userId, limit, offset],
  )

  return messages.map((msg) => toGiftedChatMessage(msg, userId))
}

/**
 * Get a single message by ID
 */
export async function getMessage(messageId: string, userId: string): Promise<Message | null> {
  const db = await getDatabase()

  const message = await db.getFirstAsync<LocalMessage>(
    'SELECT * FROM messages WHERE id = ? AND (sender_user_id = ? OR recipient_user_id = ?)',
    [messageId, userId, userId],
  )

  return message ? toGiftedChatMessage(message, userId) : null
}

/**
 * Send a new message (save to local database)
 */
export async function sendMessage(
  characterId: string,
  userId: string,
  text: string,
  messageId?: string,
  additionalData?: Partial<Message>,
): Promise<Message> {
  const db = await getDatabase()

  const id = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const createdAt = resolveCreatedAtMs(additionalData)
  const messageData = additionalData ? JSON.stringify(additionalData) : '{}'

  // ON CONFLICT DO NOTHING: a persisted/resumed mutation (see PersistQueryClientProvider in
  // app/_layout.tsx) can replay the same client-generated id after a paused mutation is restored.
  // The replay carries identical content, so a duplicate insert is a no-op, not an error.
  const insertResult = await db.runAsync(
    `INSERT INTO messages
     (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [id, characterId, userId, characterId, text, createdAt, messageData, 0, 1, 0, 0],
  )

  if (insertResult.changes === 0) {
    return resolveInsertConflict(db, id, userId, {
      characterId,
      senderUserId: userId,
      recipientUserId: characterId,
      text,
      messageData,
    })
  }

  return {
    _id: id,
    text,
    createdAt: new Date(createdAt),
    user: {
      _id: userId,
      name: 'You',
    },
    sent: true,
    pending: false,
    ...additionalData,
  }
}

/**
 * Save an AI response message
 */
export async function saveAIMessage(
  characterId: string,
  userId: string,
  text: string,
  messageId?: string,
  additionalData?: Partial<Message>,
  syncedAt?: number,
): Promise<Message> {
  const db = await getDatabase()

  const id = messageId || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const createdAt = resolveCreatedAtMs(additionalData)
  const messageData = additionalData ? JSON.stringify(additionalData) : '{}'

  const insertResult = await db.runAsync(
    `INSERT INTO messages
     (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      id,
      characterId,
      characterId,
      userId,
      text,
      createdAt,
      messageData,
      0,
      1,
      0,
      0,
      syncedAt ?? null,
    ],
  )

  if (insertResult.changes === 0) {
    return resolveInsertConflict(db, id, userId, {
      characterId,
      senderUserId: characterId,
      recipientUserId: userId,
      text,
      messageData,
      syncedAt: syncedAt ?? null,
    })
  }

  return {
    _id: id,
    text,
    createdAt: new Date(createdAt),
    user: {
      _id: characterId,
      name: 'Character',
    },
    sent: true,
    pending: false,
    ...additionalData,
  }
}

/**
 * Update message status (pending, sent, error)
 */
export async function updateMessageStatus(
  messageId: string,
  status: {
    pending?: boolean
    sent?: boolean
    error?: boolean
  },
): Promise<void> {
  const db = await getDatabase()

  const updates: string[] = []
  const values: (number | string)[] = []

  if (status.pending !== undefined) {
    updates.push('pending = ?')
    values.push(status.pending ? 1 : 0)
  }
  if (status.sent !== undefined) {
    updates.push('sent = ?')
    values.push(status.sent ? 1 : 0)
  }
  if (status.error !== undefined) {
    updates.push('error = ?')
    values.push(status.error ? 1 : 0)
  }

  if (updates.length === 0) return

  values.push(messageId)

  await db.runAsync(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`, values)
}

/**
 * Update message text (for edits)
 */
export async function updateMessageText(messageId: string, text: string): Promise<void> {
  const db = await getDatabase()

  await db.runAsync('UPDATE messages SET text = ?, edited = 1 WHERE id = ?', [text, messageId])
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string): Promise<void> {
  const db = await getDatabase()

  await db.runAsync('DELETE FROM messages WHERE id = ?', [messageId])
}

/**
 * Delete all messages for a character
 */
export async function deleteCharacterMessages(characterId: string): Promise<void> {
  const db = await getDatabase()

  await db.runAsync('DELETE FROM messages WHERE character_id = ?', [characterId])
}

/**
 * Get message count for a character
 */
export async function getMessageCount(characterId: string, userId: string): Promise<number> {
  const db = await getDatabase()

  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)`,
    [characterId, userId, userId],
  )

  return result?.count || 0
}

/**
 * Get last message for a character (for preview)
 */
export async function getLastMessage(characterId: string, userId: string): Promise<Message | null> {
  const db = await getDatabase()

  const message = await db.getFirstAsync<LocalMessage>(
    `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     ORDER BY created_at DESC, rowid DESC 
     LIMIT 1`,
    [characterId, userId, userId],
  )

  return message ? toGiftedChatMessage(message, userId) : null
}

/**
 * Search messages by text
 */
export async function searchMessages(
  characterId: string,
  userId: string,
  searchText: string,
): Promise<Message[]> {
  const db = await getDatabase()

  const messages = await db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     AND text LIKE ?
     ORDER BY created_at DESC, rowid DESC 
     LIMIT 50`,
    [characterId, userId, userId, `%${searchText}%`],
  )

  return messages.map((msg) => toGiftedChatMessage(msg, userId))
}

/**
 * Batch insert messages (for initial sync or imports)
 */
export async function batchInsertMessages(messages: LocalMessage[]): Promise<void> {
  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const msg of messages) {
      await db.runAsync(
        `INSERT OR REPLACE INTO messages
         (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id,
          msg.character_id,
          msg.sender_user_id,
          msg.recipient_user_id,
          msg.text,
          msg.created_at,
          msg.message_data,
          msg.pending,
          msg.sent,
          msg.error,
          msg.edited,
          msg.synced_at,
        ],
      )
    }
  })
}

/**
 * Get the most recent message across all conversations for a user
 */
export async function getMostRecentMessage(
  userId: string,
): Promise<(Message & { character_id: string }) | null> {
  const db = await getDatabase()

  const message = await db.getFirstAsync<LocalMessage>(
    `SELECT * FROM messages
         WHERE sender_user_id = ? OR recipient_user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
    [userId, userId],
  )

  if (!message) return null

  return toGiftedChatMessage(message, userId)
}

/**
 * Get recent messages for summary generation (oldest to newest)
 */
export async function getMessagesForContextSummary(
  characterId: string,
  userId: string,
  limit: number,
): Promise<Message[]> {
  const db = await getDatabase()

  const messages = await db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     ORDER BY created_at DESC, rowid DESC 
     LIMIT ?`,
    [characterId, userId, userId, limit],
  )

  return messages.reverse().map((msg) => toGiftedChatMessage(msg, userId))
}

/**
 * Prune old messages while keeping only the newest messages for a conversation
 */
export async function pruneMessagesForCharacter(
  characterId: string,
  userId: string,
  keepLatestCount: number,
): Promise<void> {
  const db = await getDatabase()

  if (keepLatestCount <= 0) {
    await db.runAsync(
      `DELETE FROM messages 
       WHERE character_id = ? 
       AND (sender_user_id = ? OR recipient_user_id = ?)`,
      [characterId, userId, userId],
    )
    return
  }

  await db.runAsync(
    `DELETE FROM messages
     WHERE character_id = ?
       AND (sender_user_id = ? OR recipient_user_id = ?)
       AND id NOT IN (
         SELECT id
         FROM messages
         WHERE character_id = ?
           AND (sender_user_id = ? OR recipient_user_id = ?)
         ORDER BY created_at DESC
         LIMIT ?
       )`,
    [characterId, userId, userId, characterId, userId, userId, keepLatestCount],
  )
}

export async function getUnsyncedMessages(
  characterId: string,
  userId: string,
): Promise<LocalMessage[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages
     WHERE character_id = ? AND (sender_user_id = ? OR recipient_user_id = ?) AND synced_at IS NULL
     ORDER BY created_at ASC`,
    [characterId, userId, userId],
  )
}

export async function markMessagesAsSynced(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return
  const db = await getDatabase()
  const now = Date.now()
  const placeholders = messageIds.map(() => '?').join(',')
  await db.runAsync(`UPDATE messages SET synced_at = ? WHERE id IN (${placeholders})`, [
    now,
    ...messageIds,
  ])
}

/**
 * Two-phase local apply for proactive messages pushed by the server.
 *
 * Phase 1: INSERT OR IGNORE keyed by the server's `messageId` (which is the
 * shared primary key). The sync can never overwrite a row this device already
 * authored or received another way — OR REPLACE would silently reset
 * pending/sent/error and clobber locally-edited text on every re-sync.
 *
 * Phase 2: A targeted read_at update that ONLY fires when read_at IS NULL.
 * Server-issued read state has to be one-directional — an out-of-order page
 * (a stale cursor replayed after a user has cleared the badge) cannot resurrect
 * a read receipt that was cleared on another device.
 *
 * `userId` is a parameter because proactive messages carry no userId on the
 * wire, and the columns cannot be faked. A proactive message is a character ->
 * user message, so it takes the mirror of the user-authored shape written by
 * insertMessage (sender = user, recipient = character): sender is the
 * character, recipient is the user. Both halves are load-bearing. Every read
 * path here — getMessages, getMessage, getLastMessage, getMessageCount,
 * searchMessages — filters `(sender_user_id = ? OR recipient_user_id = ?)`
 * against the user, so a row naming only the character is invisible to all of
 * them; and toGiftedChatMessage decides authorship with
 * `sender_user_id === currentUserId`, so naming the user as sender would render
 * the character's own message as the user's.
 *
 * When `db` is omitted the function opens its own transaction. When `db` is
 * provided (Task 10 orchestrator pattern) the caller is already inside a
 * transaction — the inserts join it so a cursor advance that follows can land
 * in the same transaction and a crash mid-page rolls both back atomically.
 */
export async function applyProactiveMessages(
  payload: ProactiveMessagePayload[],
  userId: string,
  db?: Awaited<ReturnType<typeof getDatabase>>,
): Promise<void> {
  const database = db ?? (await getDatabase())
  const runApply = async () => {
    for (const msg of payload) {
      await database.runAsync(
        `INSERT OR IGNORE INTO messages
         (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited, synced_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, ?, ?)`,
        [
          msg.messageId,
          msg.characterId,
          msg.characterId,
          userId,
          msg.text,
          Date.parse(msg.createdAt),
          JSON.stringify({ proactive: true }),
          Date.parse(msg.createdAt),
          msg.readAt ? Date.parse(msg.readAt) : null,
        ],
      )

      if (msg.readAt) {
        await database.runAsync(
          `UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL`,
          [Date.parse(msg.readAt), msg.messageId],
        )
      }
    }
  }

  if (db) {
    await runApply()
  } else {
    await database.withTransactionAsync(runApply)
  }
}

/**
 * Count proactive messages for a character that are unread and still inside
 * the staleness escape. Mirrors the server's `UNREAD_STALENESS_ESCAPE_MS`
 * guardrail so the client badge and the server's push-decision agree about
 * which messages still count. `message_data` is a JSON-encoded string on the
 * client; `json_extract` returns the integer `1` for `true`.
 */
export async function countUnreadProactive(characterId: string, nowMs: number): Promise<number> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM messages
      WHERE character_id = ? AND read_at IS NULL AND created_at >= ?
        AND json_extract(message_data, '$.proactive') = 1`,
    [characterId, nowMs - UNREAD_STALENESS_ESCAPE_MS],
  )
  return row?.count ?? 0
}

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
