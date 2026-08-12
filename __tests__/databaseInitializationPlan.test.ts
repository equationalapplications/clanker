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
    const legacySchema = CREATE_TABLES.replace(/,\s*message_id\s+TEXT\s*\n(\s*\);)/, '\n$1')
    expect(legacySchema).not.toContain('message_id')
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
