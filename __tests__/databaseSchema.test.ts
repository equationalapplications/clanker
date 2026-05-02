import {
  CREATE_TABLES,
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

  it('bumps schema to v17 for wiki cleanup migration', () => {
    expect(SCHEMA_VERSION).toBe(17)
    // Migration 13: adds source_hash — skipped if column exists OR wiki_entries table is missing
    expect(MIGRATION_SKIP_GUARDS[13]).toEqual([
      { table: 'wiki_entries', column: 'source_hash' },
      { table: 'wiki_entries', skipIfTableMissing: true },
    ])
    expect(MIGRATIONS[13]).toContain('ALTER TABLE wiki_entries ADD COLUMN source_hash TEXT')
    expect(MIGRATIONS[13]).not.toContain('source_ref')
    // Migration 14: adds source_ref column — skipped if column exists OR wiki_entries table is missing
    expect(MIGRATION_SKIP_GUARDS[14]).toEqual([
      { table: 'wiki_entries', column: 'source_ref' },
      { table: 'wiki_entries', skipIfTableMissing: true },
    ])
    expect(MIGRATIONS[14]).toContain('ALTER TABLE wiki_entries ADD COLUMN source_ref TEXT')
    expect(MIGRATIONS[14]).not.toContain('idx_wiki_entries_source_hash')
    // Migration 15: swaps to partial index — skipped if wiki_entries table is missing
    expect(MIGRATION_SKIP_GUARDS[15]).toEqual([
      { table: 'wiki_entries', skipIfTableMissing: true },
    ])
    expect(MIGRATIONS[15]).toContain('DROP INDEX IF EXISTS idx_wiki_entries_source_hash')
    expect(MIGRATIONS[15]).toContain('WHERE source_hash IS NOT NULL')
    // Migration 16: adds partial index on source_ref — skipped if wiki_entries table is missing
    expect(MIGRATION_SKIP_GUARDS[16]).toEqual([
      { table: 'wiki_entries', skipIfTableMissing: true },
    ])
    expect(MIGRATIONS[16]).toContain('CREATE INDEX IF NOT EXISTS idx_wiki_entries_source_ref')
    expect(MIGRATIONS[16]).toContain('WHERE source_ref IS NOT NULL')
    // Migration 17: drops old wiki tables
    expect(MIGRATION_SKIP_GUARDS[17]).toBeUndefined()
    expect(MIGRATIONS[17]).toContain('DROP TABLE IF EXISTS wiki_entries')
    expect(MIGRATIONS[17]).toContain('DROP TABLE IF EXISTS agent_tasks')
    expect(MIGRATIONS[17]).toContain('DROP TABLE IF EXISTS memory_events')
    expect(MIGRATIONS[17]).toContain('DROP TABLE IF EXISTS derived_synonyms')
  })

  it('does not include old wiki memory tables in base schema', () => {
    expect(CREATE_TABLES).not.toContain('CREATE TABLE IF NOT EXISTS wiki_entries')
    expect(CREATE_TABLES).not.toContain('CREATE TABLE IF NOT EXISTS agent_tasks')
    expect(CREATE_TABLES).not.toContain('CREATE TABLE IF NOT EXISTS memory_events')
    expect(CREATE_TABLES).not.toContain('CREATE TABLE IF NOT EXISTS derived_synonyms')
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
