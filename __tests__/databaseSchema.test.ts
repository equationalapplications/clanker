import {
  CREATE_TABLES,
  CREATE_WIKI_FTS,
  LATEST_SCHEMA_REQUIRED_COLUMNS,
  MIGRATIONS,
  MIGRATION_SKIP_GUARDS,
  SCHEMA_VERSION,
} from '../src/database/schema'

describe('database schema migration guards', () => {
  it('guards voice column on migration 9, not migration 8', () => {
    expect(MIGRATION_SKIP_GUARDS[8]).toBeUndefined()
    expect(MIGRATION_SKIP_GUARDS[9]).toEqual([{ table: 'characters', column: 'voice' }])
  })

  it('includes voice column in base characters table', () => {
    expect(CREATE_TABLES).toContain("voice TEXT NOT NULL DEFAULT 'Umbriel'")
  })

  it('adds voice column in migration 9', () => {
    expect(MIGRATIONS[9]).toContain("DEFAULT 'Umbriel'")
    expect(MIGRATIONS[9]).not.toContain('UPDATE')
  })

  it('backfills voice in migration 10', () => {
    expect(MIGRATIONS[10]).toContain("UPDATE characters SET voice = 'Umbriel'")
    expect(MIGRATIONS[10]).toContain("voice = ''")
  })

  it('has migration guards for v11 and v12', () => {
    expect(MIGRATION_SKIP_GUARDS[11]).toEqual([{ table: 'characters', column: 'heal_checkpoint' }])
    expect(MIGRATION_SKIP_GUARDS[12]).toEqual([{ table: 'characters', column: 'memory_checkpoint' }])
    expect(LATEST_SCHEMA_REQUIRED_COLUMNS.characters).toEqual(
      expect.arrayContaining(['heal_checkpoint', 'memory_checkpoint']),
    )
  })

  it('bumps schema to v15 for wiki_entries source columns with one guard per migration', () => {
    expect(SCHEMA_VERSION).toBe(15)
    // Migration 13: adds source_hash (one guard, retry-safe)
    expect(MIGRATION_SKIP_GUARDS[13]).toEqual([{ table: 'wiki_entries', column: 'source_hash' }])
    expect(MIGRATIONS[13]).toContain('ALTER TABLE wiki_entries ADD COLUMN source_hash TEXT')
    expect(MIGRATIONS[13]).not.toContain('source_ref')
    // Migration 14: adds source_ref column only (one guard, retry-safe; index handled by migration 15)
    expect(MIGRATION_SKIP_GUARDS[14]).toEqual([{ table: 'wiki_entries', column: 'source_ref' }])
    expect(MIGRATIONS[14]).toContain('ALTER TABLE wiki_entries ADD COLUMN source_ref TEXT')
    expect(MIGRATIONS[14]).not.toContain('idx_wiki_entries_source_hash')
    // Migration 15: swaps to partial index (no guard needed, idempotent)
    expect(MIGRATION_SKIP_GUARDS[15]).toBeUndefined()
    expect(MIGRATIONS[15]).toContain('DROP INDEX IF EXISTS idx_wiki_entries_source_hash')
    expect(MIGRATIONS[15]).toContain('WHERE source_hash IS NOT NULL')
    expect(LATEST_SCHEMA_REQUIRED_COLUMNS.wiki_entries).toEqual(
      expect.arrayContaining(['source_hash', 'source_ref']),
    )
    expect(CREATE_TABLES).toContain('source_hash TEXT')
    expect(CREATE_TABLES).toContain('source_ref TEXT')
    // Fresh installs run CREATE_TABLES (skipping migrations when columns exist),
    // so the partial index must live in CREATE_TABLES — not only in migration 15.
    expect(CREATE_TABLES).toContain(
      'CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_hash ON wiki_entries(character_id, source_hash) WHERE source_hash IS NOT NULL',
    )
  })

  it('includes wiki memory tables in base schema', () => {
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS wiki_entries')
    expect(CREATE_WIKI_FTS).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS agent_tasks')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS memory_events')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS derived_synonyms')
    expect(CREATE_TABLES).toContain('heal_checkpoint INTEGER NOT NULL DEFAULT 0')
    expect(CREATE_TABLES).toContain('memory_checkpoint INTEGER NOT NULL DEFAULT 0')
  })

  it('adds heal_checkpoint in migration 11 and memory_checkpoint in migration 12', () => {
    expect(MIGRATIONS[11]).toContain('ALTER TABLE characters ADD COLUMN heal_checkpoint INTEGER NOT NULL DEFAULT 0')
    expect(MIGRATIONS[11]).not.toContain('memory_checkpoint')
    expect(MIGRATIONS[12]).toContain('ALTER TABLE characters ADD COLUMN memory_checkpoint INTEGER NOT NULL DEFAULT 0')
    expect(MIGRATIONS[12]).not.toContain('heal_checkpoint')
  })
})
