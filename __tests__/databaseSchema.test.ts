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
    expect(MIGRATION_SKIP_GUARDS[9]).toEqual({ table: 'characters', column: 'voice' })
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

  it('bumps schema to v11 for wiki memory tables', () => {
    expect(SCHEMA_VERSION).toBe(11)
    expect(MIGRATION_SKIP_GUARDS[11]).toEqual({ table: 'characters', column: 'heal_checkpoint' })
    expect(LATEST_SCHEMA_REQUIRED_COLUMNS.characters).toEqual(
      expect.arrayContaining(['heal_checkpoint', 'memory_checkpoint']),
    )
  })

  it('includes wiki memory tables in base schema', () => {
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS wiki_entries')
    expect(CREATE_TABLES).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS agent_tasks')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS memory_events')
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS derived_synonyms')
    expect(CREATE_TABLES).toContain('heal_checkpoint INTEGER NOT NULL DEFAULT 0')
    expect(CREATE_TABLES).toContain('memory_checkpoint INTEGER NOT NULL DEFAULT 0')
  })

  it('adds wiki memory schema in migration 11', () => {
    expect(MIGRATIONS[11]).toContain('CREATE TABLE IF NOT EXISTS wiki_entries')
    expect(MIGRATIONS[11]).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts')
    expect(MIGRATIONS[11]).toContain('CREATE TRIGGER IF NOT EXISTS wiki_entries_ai')
    expect(MIGRATIONS[11]).toContain('ALTER TABLE characters ADD COLUMN heal_checkpoint INTEGER NOT NULL DEFAULT 0')
    expect(MIGRATIONS[11]).toContain('ALTER TABLE characters ADD COLUMN memory_checkpoint INTEGER NOT NULL DEFAULT 0')
  })
})