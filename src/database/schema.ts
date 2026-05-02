/**
 * SQLite database schema for local storage
 * Supports messages and characters with optional cloud sync
 */

import { DEFAULT_VOICE } from '~/constants/voiceDefaults'

export const SCHEMA_VERSION = 17

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
  // wiki_entries removed — table no longer exists on fresh installs (package owns llm_wiki_* tables)
}

/**
 * Column-presence guards that can be used to skip migrations when upgrading
 * legacy databases that may already contain the target column.
 *
 * Each guard is satisfied when:
 * - `{ table, column }` — the named column already exists in the table
 * - `{ table, skipIfTableMissing: true }` — the table does not exist at all
 *
 * A migration is skipped when ANY of its guards is satisfied.
 */
export type MigrationSkipGuard =
  | { table: string; column: string }
  | { table: string; skipIfTableMissing: true }

export const MIGRATION_SKIP_GUARDS: Record<number, MigrationSkipGuard[]> = {
  2: [{ table: 'characters', column: 'deleted_at' }],
  3: [{ table: 'characters', column: 'avatar_data' }],
  4: [{ table: 'characters', column: 'avatar_mime_type' }],
  5: [{ table: 'characters', column: 'save_to_cloud' }],
  6: [{ table: 'characters', column: 'summary_checkpoint' }],
  7: [{ table: 'characters', column: 'owner_user_id' }],
  9: [{ table: 'characters', column: 'voice' }],
  11: [{ table: 'characters', column: 'heal_checkpoint' }],
  12: [{ table: 'characters', column: 'memory_checkpoint' }],
  // wiki_entries may not exist on legacy DBs that never had the wiki feature;
  // skip column/index migrations when the table is absent (migration 17 drops it anyway).
  13: [{ table: 'wiki_entries', column: 'source_hash' }, { table: 'wiki_entries', skipIfTableMissing: true }],
  14: [{ table: 'wiki_entries', column: 'source_ref' }, { table: 'wiki_entries', skipIfTableMissing: true }],
  15: [{ table: 'wiki_entries', skipIfTableMissing: true }],
  16: [{ table: 'wiki_entries', skipIfTableMissing: true }],
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
  13: `ALTER TABLE wiki_entries ADD COLUMN source_hash TEXT`,
  14: `ALTER TABLE wiki_entries ADD COLUMN source_ref TEXT`,
  15: `DROP INDEX IF EXISTS idx_wiki_entries_source_hash;
CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash) WHERE source_hash IS NOT NULL`,
  16: `CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_ref ON wiki_entries(character_id, source_ref) WHERE source_ref IS NOT NULL`,
  17: `DROP TRIGGER IF EXISTS wiki_entries_ai;
DROP TRIGGER IF EXISTS wiki_entries_au;
DROP TRIGGER IF EXISTS wiki_entries_ad;
DROP TABLE IF EXISTS wiki_fts;
DROP TABLE IF EXISTS wiki_entries;
DROP TABLE IF EXISTS agent_tasks;
DROP TABLE IF EXISTS memory_events;
DROP TABLE IF EXISTS derived_synonyms`.trim(),
}
