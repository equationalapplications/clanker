import { DatabaseSync } from 'node:sqlite'
import { applyInitializationPlan, type DatabaseExecutor } from '~/database'
import { CREATE_TABLES } from '~/database/schema'

/**
 * Wraps a real node:sqlite connection as the async DatabaseExecutor shape
 * expo-sqlite exposes, so these tests exercise actual SQLite semantics
 * (e.g. "no such column") instead of a mock that can't fail the same way.
 */
function wrapExecutor(db: DatabaseSync): DatabaseExecutor {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql)
    },
    runAsync: async (sql: string, params?: unknown) => {
      db.prepare(sql).run(...(Array.isArray(params) ? params : params ? [params] : []))
      return {} as never
    },
    getAllAsync: async <T>(sql: string, params?: unknown) => {
      return db
        .prepare(sql)
        .all(...(Array.isArray(params) ? params : params ? [params] : [])) as T[]
    },
    getFirstAsync: async <T>(sql: string, params?: unknown) => {
      const row = db.prepare(sql).get(...(Array.isArray(params) ? params : params ? [params] : []))
      return (row ?? null) as T | null
    },
  }
}

describe('applyInitializationPlan against a real SQLite engine', () => {
  it('upgrades a pre-migration-24 DB (character_images without message_id) without throwing', async () => {
    const db = new DatabaseSync(':memory:')
    // Simulate a returning user's DB: everything at the current (post-24) shape
    // except character_images, stripped back to its pre-migration-24 column list
    // (migration 22 shape, no message_id) — this is what every real returning
    // web user's local DB actually looked like before this release.
    const legacySchema = CREATE_TABLES
      // Strip character_images.message_id (migration 24). The \b boundaries
      // keep sync_state.cursor_message_id intact — that column exists in the
      // current CREATE_TABLES block but must NOT be stripped here.
      .replace(/,\s*\bmessage_id\b\s+TEXT\s*\n(\s*\);)/, '\n$1')
      // Strip messages.read_at (migration 25). CREATE_TABLES now carries the
      // column directly, but a pre-migration-24 legacy DB never had it.
      .replace(/,\s*\bread_at\b\s+INTEGER\s*\n(\s*\);)/, '\n$1')
      // Drop the sync_state table block (migration 26). It did not exist on
      // pre-migration-24 legacy DBs and would shadow migration 26's CREATE
      // TABLE IF NOT EXISTS anyway, so it's harmless — but the cleaner
      // simulation removes it to mirror the real shape.
      .replace(
        /\n  -- Sync cursor storage[^\n]*\n  CREATE TABLE IF NOT EXISTS sync_state \([\s\S]*?\n  \);/,
        '',
      )
    // Sanity-check: character_images no longer has message_id as a column.
    const characterImagesBlock =
      legacySchema.match(/CREATE TABLE IF NOT EXISTS character_images \([\s\S]*?\n  \);/)?.[0] ?? ''
    expect(characterImagesBlock).not.toMatch(/\bmessage_id\b/)
    db.exec(legacySchema)
    db.exec('INSERT INTO schema_version (version, updated_at) VALUES (23, 0);')

    const executor = wrapExecutor(db)

    await expect(applyInitializationPlan(executor)).resolves.toBeUndefined()

    const columns = db.prepare('PRAGMA table_info(character_images)').all() as { name: string }[]
    expect(columns.some((c) => c.name === 'message_id')).toBe(true)

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='character_images'")
      .all() as { name: string }[]
    expect(indexes.some((i) => i.name === 'idx_character_images_message')).toBe(true)

    db.close()
  })

  it('creates the message index on a fresh install too', async () => {
    const db = new DatabaseSync(':memory:')
    const executor = wrapExecutor(db)

    await expect(applyInitializationPlan(executor)).resolves.toBeUndefined()

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='character_images'")
      .all() as { name: string }[]
    expect(indexes.some((i) => i.name === 'idx_character_images_message')).toBe(true)

    db.close()
  })
})
