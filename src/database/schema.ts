/**
 * SQLite database schema for local storage
 * Supports messages and characters with optional cloud sync
 */

import { DEFAULT_VOICE } from '~/constants/voiceDefaults'

export const SCHEMA_VERSION = 14

/**
 * Columns that must exist for a database to be treated as already matching
 * the latest schema version during bootstrap.
 */
export const LATEST_SCHEMA_REQUIRED_COLUMNS: Record<string, string[]> = {
  characters: [
    'deleted_at',
    'avatar_data',
    'avatar_mime_type',
    'save_to_cloud',
    'summary_checkpoint',
    'owner_user_id',
    'voice',
    'heal_checkpoint',
    'memory_checkpoint',
  ],
  wiki_entries: ['source_hash', 'source_ref'],
}

/**
 * Column-presence guards that can be used to skip migrations when upgrading
 * legacy databases that may already contain the target column.
 */
export const MIGRATION_SKIP_GUARDS: Record<number, { table: string; column: string }[]> = {
  2: [{ table: 'characters', column: 'deleted_at' }],
  3: [{ table: 'characters', column: 'avatar_data' }],
  4: [{ table: 'characters', column: 'avatar_mime_type' }],
  5: [{ table: 'characters', column: 'save_to_cloud' }],
  6: [{ table: 'characters', column: 'summary_checkpoint' }],
  7: [{ table: 'characters', column: 'owner_user_id' }],
  9: [{ table: 'characters', column: 'voice' }],
  11: [{ table: 'characters', column: 'heal_checkpoint' }],
  12: [{ table: 'characters', column: 'memory_checkpoint' }],
  13: [{ table: 'wiki_entries', column: 'source_hash' }, { table: 'wiki_entries', column: 'source_ref' }],
}

/**
 * FTS5 virtual table and triggers (platform-specific)
 * Note: On web, SQLite is provided via wa-sqlite through expo-sqlite, and
 * these statements are applied during initialization only when FTS5 support
 * is available there or on native platforms.
 */
export const CREATE_WIKI_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
    title,
    body,
    tags,
    content='wiki_entries',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS wiki_entries_ai AFTER INSERT ON wiki_entries BEGIN
    INSERT INTO wiki_fts(rowid, title, body, tags)
    VALUES (new.rowid, new.title, new.body, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS wiki_entries_au AFTER UPDATE OF title, body, tags ON wiki_entries BEGIN
    INSERT INTO wiki_fts(wiki_fts, rowid, title, body, tags)
    VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    INSERT INTO wiki_fts(rowid, title, body, tags)
    VALUES (new.rowid, new.title, new.body, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS wiki_entries_ad AFTER DELETE ON wiki_entries BEGIN
    INSERT INTO wiki_fts(wiki_fts, rowid, title, body, tags)
    VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  END;
`

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
    voice TEXT NOT NULL DEFAULT '${DEFAULT_VOICE}',
    heal_checkpoint INTEGER NOT NULL DEFAULT 0,
    memory_checkpoint INTEGER NOT NULL DEFAULT 0
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

  -- Wiki entries table
  CREATE TABLE IF NOT EXISTS wiki_entries (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    confidence TEXT NOT NULL DEFAULT 'inferred',
    source_type TEXT NOT NULL DEFAULT 'agent_inferred',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0,
    synced_to_cloud INTEGER NOT NULL DEFAULT 0,
    cloud_id TEXT,
    deleted_at INTEGER,
    source_hash TEXT,
    source_ref TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_wiki_entries_character_user ON wiki_entries(character_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_wiki_entries_updated_at ON wiki_entries(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_entries_character_deleted ON wiki_entries(character_id, deleted_at);

  -- Agent tasks table
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    due_context TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolution_note TEXT,
    synced_to_cloud INTEGER NOT NULL DEFAULT 0,
    cloud_id TEXT,
    deleted_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_agent_tasks_character_status ON agent_tasks(character_id, user_id, status);
  CREATE INDEX IF NOT EXISTS idx_agent_tasks_priority ON agent_tasks(priority DESC);

  -- Memory events table
  CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    related_entry_id TEXT,
    related_task_id TEXT,
    source_ref TEXT,
    created_at INTEGER NOT NULL,
    synced_to_cloud INTEGER NOT NULL DEFAULT 0,
    cloud_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_memory_events_character_created ON memory_events(character_id, user_id, created_at DESC);

  -- Derived synonym table
  CREATE TABLE IF NOT EXISTS derived_synonyms (
    term TEXT NOT NULL,
    character_id TEXT NOT NULL,
    synonyms TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (term, character_id)
  );

  CREATE INDEX IF NOT EXISTS idx_derived_synonyms_character ON derived_synonyms(character_id);

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
  9: `ALTER TABLE characters ADD COLUMN voice TEXT NOT NULL DEFAULT '${DEFAULT_VOICE}';`,
  10: `UPDATE characters SET voice = '${DEFAULT_VOICE}' WHERE voice IS NULL OR voice = '';`,
  11: `ALTER TABLE characters ADD COLUMN heal_checkpoint INTEGER NOT NULL DEFAULT 0`,
  12: `ALTER TABLE characters ADD COLUMN memory_checkpoint INTEGER NOT NULL DEFAULT 0`,
  13: `ALTER TABLE wiki_entries ADD COLUMN source_hash TEXT;
ALTER TABLE wiki_entries ADD COLUMN source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash)`,
  14: `DROP INDEX IF EXISTS idx_wiki_entries_source_hash;
CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash) WHERE source_hash IS NOT NULL`,
}
