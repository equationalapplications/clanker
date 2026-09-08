/**
 * Generic key/cursor storage for incremental syncs.
 *
 * Task 9 (Phase 2 proactive scheduler) creates the `sync_state` table and
 * these helpers; Task 10 will read/write a `proactive_messages` cursor inside
 * the same transaction that persists fetched messages, so setSyncCursor must
 * accept an optional database handle to join a caller's transaction.
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
