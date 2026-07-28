import {
  SCHEMA_VERSION,
  MIGRATIONS,
  MIGRATION_SKIP_GUARDS,
  CREATE_TABLES,
  LATEST_SCHEMA_REQUIRED_COLUMNS,
} from '../src/database/schema'

describe('character_images schema', () => {
  it('bumps SCHEMA_VERSION to 23', () => {
    expect(SCHEMA_VERSION).toBe(23)
  })

  it('migration 22 creates the character_images table and its indexes', () => {
    const sql = MIGRATIONS[22]
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS character_images')
    expect(sql).toContain('storage_kind TEXT NOT NULL')
    expect(sql).toContain("sync_state TEXT NOT NULL DEFAULT 'local'")
    expect(sql).toContain('idx_character_images_char')
    expect(sql).toContain('idx_character_images_sync')
  })

  it('migration 23 adds characters.active_image_id', () => {
    expect(MIGRATIONS[23]).toContain('ALTER TABLE characters ADD COLUMN active_image_id TEXT')
  })

  it('guards both migrations so legacy databases can skip them', () => {
    expect(MIGRATION_SKIP_GUARDS[22]).toEqual([
      { table: 'character_images', column: 'id' },
    ])
    expect(MIGRATION_SKIP_GUARDS[23]).toEqual([
      { table: 'characters', column: 'active_image_id' },
    ])
  })

  it('creates the same objects on a fresh install', () => {
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS character_images')
    expect(CREATE_TABLES).toContain('active_image_id TEXT')
    expect(LATEST_SCHEMA_REQUIRED_COLUMNS.characters).toContain('active_image_id')
  })
})
