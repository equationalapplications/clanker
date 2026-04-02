/**
 * SQLite database schema for local storage
 * Supports messages and characters with optional cloud sync
 */

export const SCHEMA_VERSION = 3

/**
 * SQL statements to create tables
 */
export const CREATE_TABLES = `
  -- Characters table
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    avatar_data TEXT,
    appearance TEXT,
    traits TEXT,
    emotions TEXT,
    context TEXT,
    is_public INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_to_cloud INTEGER DEFAULT 0,
    cloud_id TEXT,
    deleted_at INTEGER
  );

  -- Indexes for characters
  CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
  CREATE INDEX IF NOT EXISTS idx_characters_created_at ON characters(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_characters_cloud_id ON characters(cloud_id);

  -- Messages table
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL,
    sender_user_id TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    message_data TEXT,
    pending INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 1,
    error INTEGER DEFAULT 0,
    edited INTEGER DEFAULT 0
  );

  -- Indexes for messages
  CREATE INDEX IF NOT EXISTS idx_messages_character ON messages(character_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(character_id, sender_user_id, recipient_user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    updated_at INTEGER NOT NULL
  );
`

/**
 * Migration scripts for future schema updates
 */
export const MIGRATIONS: Record<number, string> = {
  2: `ALTER TABLE characters ADD COLUMN deleted_at INTEGER;`,
  3: `ALTER TABLE characters ADD COLUMN avatar_data TEXT;`,
}
