import { CREATE_TABLES, MIGRATIONS, MIGRATION_SKIP_GUARDS } from '../src/database/schema'

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
})