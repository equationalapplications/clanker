/**
 * SQLite database schema for local storage
 * Supports messages and characters with optional cloud sync
 */

export const SCHEMA_VERSION = 1

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
    appearance TEXT,
    traits TEXT,
    emotions TEXT,
    context TEXT,
    is_public INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_to_cloud INTEGER DEFAULT 0,
    cloud_id TEXT
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

  -- Insert initial schema version
  INSERT OR IGNORE INTO schema_version (version, updated_at) 
  VALUES (${SCHEMA_VERSION}, ${Date.now()});
`

/**
 * Migration scripts for future schema updates
 */
export const MIGRATIONS: Record<number, string> = {
    // Example: version 2 migration
    // 2: `ALTER TABLE messages ADD COLUMN some_new_field TEXT;`,
}
