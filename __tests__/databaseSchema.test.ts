import { CREATE_TABLES, MIGRATION_SKIP_GUARDS } from '../src/database/schema'

describe('database schema migration guards', () => {
  it('guards voice column on migration 9, not migration 8', () => {
    expect(MIGRATION_SKIP_GUARDS[8]).toBeUndefined()
    expect(MIGRATION_SKIP_GUARDS[9]).toEqual({ table: 'characters', column: 'voice' })
  })

  it('includes voice column in base characters table', () => {
    expect(CREATE_TABLES).toContain('voice TEXT')
  })
})