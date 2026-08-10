import {
  SCHEMA_VERSION,
  MIGRATIONS,
  MIGRATION_SKIP_GUARDS,
  CREATE_TABLES,
  LATEST_SCHEMA_REQUIRED_COLUMNS,
} from '../src/database/schema'

describe('character_images schema', () => {
  it('bumps SCHEMA_VERSION to 24', () => {
    expect(SCHEMA_VERSION).toBe(24)
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

  // CREATE_TABLES runs before any migration, so migration 22 is always guard-skipped
  // for real users. Drift between the two definitions would therefore only ever surface
  // here — assert them column-for-column rather than just probing for the table name.
  it('defines an identical character_images schema on both paths', () => {
    const norm = (sql: string) => sql.replace(/\s+/g, ' ')
    const fresh = norm(CREATE_TABLES)
    const migrated = norm(MIGRATIONS[22])

    const definitions = [
      'id TEXT PRIMARY KEY NOT NULL',
      'character_id TEXT NOT NULL',
      'user_id TEXT NOT NULL',
      'storage_kind TEXT NOT NULL',
      'master_ref TEXT NOT NULL',
      'thumb_ref TEXT',
      "mime_type TEXT NOT NULL DEFAULT 'image/webp'",
      'source TEXT NOT NULL',
      "sync_state TEXT NOT NULL DEFAULT 'local'",
      'sync_attempts INTEGER NOT NULL DEFAULT 0',
      'created_at INTEGER NOT NULL',
      'deleted_at INTEGER',
      'idx_character_images_char ON character_images(character_id, created_at DESC)',
      "idx_character_images_sync ON character_images(sync_state) WHERE sync_state IN ('pending_upload', 'pending_delete')",
    ]

    for (const definition of definitions) {
      expect(migrated).toContain(definition)
      expect(fresh).toContain(definition)
    }
  })
})

describe('migration 24 — chat photo linkage', () => {
  it('adds message_id and a partial index', () => {
    expect(MIGRATIONS[24]).toContain('ALTER TABLE character_images ADD COLUMN message_id TEXT')
    expect(MIGRATIONS[24]).toContain('idx_character_images_message')
    expect(MIGRATIONS[24]).toContain('WHERE message_id IS NOT NULL')
  })

  it('is skipped when the column already exists', () => {
    expect(MIGRATION_SKIP_GUARDS[24]).toEqual([
      { table: 'character_images', column: 'message_id' },
    ])
  })

  it('fresh installs get the column without running the migration', () => {
    expect(CREATE_TABLES).toContain('message_id')
    expect(CREATE_TABLES).toContain('idx_character_images_message')
  })
})
