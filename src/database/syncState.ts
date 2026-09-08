/**
 * Generic key/cursor storage for incremental syncs.
 *
 * Task 9 (Phase 2 proactive scheduler) creates the `sync_state` table and
 * these helpers; Task 10 will read/write a `proactive_messages` cursor inside
 * the same transaction that persists fetched messages, so setSyncCursor must
 * accept an optional database handle to join a caller's transaction.
 *
 * Task 11 extends this with a JSON-blob helper pair (`getSyncJson`/`setSyncJson`)
 * so the mark-read queue can reuse the same table without a schema change.
 * The payload lives in the existing `cursor_created_at` TEXT column — the
 * other two columns stay NULL. This is cheaper than adding a dedicated
 * payload column for a single consumer and keeps the table generic.
 */

import type { SQLiteDatabase } from 'expo-sqlite'
import { getDatabase } from './index'

export interface SyncCursor {
  createdAt: string
  messageId: string
}

interface SyncCursorRow {
  cursor_created_at: string | null
  cursor_message_id: string | null
}

async function resolveDatabase(db?: SQLiteDatabase): Promise<SQLiteDatabase> {
  return db ?? (await getDatabase())
}

export async function getSyncCursor(key: string, db?: SQLiteDatabase): Promise<SyncCursor | null> {
  const database = await resolveDatabase(db)
  const row = await database.getFirstAsync<SyncCursorRow>(
    'SELECT cursor_created_at, cursor_message_id FROM sync_state WHERE key = ?',
    [key],
  )

  if (!row || row.cursor_created_at === null || row.cursor_message_id === null) {
    return null
  }

  return {
    createdAt: row.cursor_created_at,
    messageId: row.cursor_message_id,
  }
}

export async function setSyncCursor(
  key: string,
  cursor: SyncCursor,
  db?: SQLiteDatabase,
): Promise<void> {
  const database = await resolveDatabase(db)
  await database.runAsync(
    `INSERT OR REPLACE INTO sync_state (key, cursor_created_at, cursor_message_id, updated_at)
     VALUES (?, ?, ?, ?)`,
    [key, cursor.createdAt, cursor.messageId, Date.now()],
  )
}

export async function getSyncJson<T>(key: string, db?: SQLiteDatabase): Promise<T | null> {
  const database = await resolveDatabase(db)
  const row = await database.getFirstAsync<SyncCursorRow>(
    'SELECT cursor_created_at, cursor_message_id FROM sync_state WHERE key = ?',
    [key],
  )

  if (!row || row.cursor_created_at === null) {
    return null
  }

  // The other two columns are unused for JSON-blob keys; a non-null message_id
  // is just a stale artifact of cursor reuse and is harmless.
  return JSON.parse(row.cursor_created_at) as T
}

export async function setSyncJson<T>(key: string, value: T, db?: SQLiteDatabase): Promise<void> {
  const database = await resolveDatabase(db)
  await database.runAsync(
    `INSERT OR REPLACE INTO sync_state (key, cursor_created_at, cursor_message_id, updated_at)
     VALUES (?, ?, NULL, ?)`,
    [key, JSON.stringify(value), Date.now()],
  )
}
