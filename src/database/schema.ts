/**
 * SQLite database schema for local storage
 * Supports messages and characters with optional cloud sync
 */

export const SCHEMA_VERSION = 9

/**
 * Columns that must exist for a database to be treated as already matching
 * the latest schema version during bootstrap.
 */
export const LATEST_SCHEMA_REQUIRED_COLUMNS: Record<string, string[]> = {
  characters: ['deleted_at', 'avatar_data', 'avatar_mime_type', 'save_to_cloud', 'summary_checkpoint', 'owner_user_id', 'voice'],
}

/**
 * Column-presence guards that can be used to skip migrations when upgrading
 * legacy databases that may already contain the target column.
 */
export const MIGRATION_SKIP_GUARDS: Record<number, { table: string; column: string }> = {
  2: { table: 'characters', column: 'deleted_at' },
  3: { table: 'characters', column: 'avatar_data' },
  4: { table: 'characters', column: 'avatar_mime_type' },
  5: { table: 'characters', column: 'save_to_cloud' },
  6: { table: 'characters', column: 'summary_checkpoint' },
  7: { table: 'characters', column: 'owner_user_id' },
  9: { table: 'characters', column: 'voice' },
}

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
    avatar_mime_type TEXT DEFAULT 'image/webp',
    appearance TEXT,
    traits TEXT,
    emotions TEXT,
    context TEXT,
    is_public INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_to_cloud INTEGER DEFAULT 0,
    save_to_cloud INTEGER DEFAULT 0,
    cloud_id TEXT,
    deleted_at INTEGER,
    summary_checkpoint INTEGER DEFAULT 0,
    owner_user_id TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT 'Umbriel'
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
  4: `ALTER TABLE characters ADD COLUMN avatar_mime_type TEXT DEFAULT 'image/webp';`,
  5: `ALTER TABLE characters ADD COLUMN save_to_cloud INTEGER DEFAULT 0;`,
  6: `ALTER TABLE characters ADD COLUMN summary_checkpoint INTEGER DEFAULT 0;`,
  7: `ALTER TABLE characters ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''; UPDATE characters SET owner_user_id = user_id WHERE owner_user_id = '' AND (save_to_cloud = 1 OR cloud_id IS NULL);`,
  8: `UPDATE characters SET owner_user_id = user_id WHERE (owner_user_id IS NULL OR owner_user_id = '') AND (save_to_cloud = 1 OR cloud_id IS NULL OR COALESCE(is_public, 0) = 0);`,
  9: `ALTER TABLE characters ADD COLUMN voice TEXT NOT NULL DEFAULT 'Umbriel'; UPDATE characters SET voice = 'Umbriel' WHERE voice IS NULL OR voice = '';`,
}
