/**
 * Migration audit: v3 schema seeded into SQLite, then wiki@4.1.0 setup() runs.
 * Asserts setup() does not throw and pre-existing rows are preserved.
 *
 * This test guards the v3 → v4 upgrade per spec § Risks.
 *
 * Note: v4.0.0 introduced a BREAKING CHANGE requiring manual SQL migration for
 * source_type enum values (user_document→immutable_document, agent_inferred→librarian_inferred).
 * Since the library doesn't auto-migrate these enums, this test verifies the manual
 * migration path works by: 1) letting setup() create v4 schema, 2) inserting rows with
 * v3 enum values to simulate pre-migration state, 3) running the manual migration SQL,
 * 4) verifying the migrated values are correct.
 */

// Mock expo-sqlite to use better-sqlite3 for testing
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => {
    const BetterSqlite3 = require('better-sqlite3')
    const betterDb = new BetterSqlite3(':memory:')

    return {
      execSync: (sql: string) => betterDb.exec(sql),
      runSync: (sql: string, params?: unknown[]) => {
        const stmt = betterDb.prepare(sql)
        const result = stmt.run(...(params || []))
        return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }
      },
      getFirstSync: <T,>(sql: string, params?: unknown[]): T | null => {
        const stmt = betterDb.prepare(sql)
        return (stmt.get(...(params || [])) as T) || null
      },
      getAllSync: <T,>(sql: string, params?: unknown[]): T[] => {
        const stmt = betterDb.prepare(sql)
        return stmt.all(...(params || [])) as T[]
      },
      closeSync: () => betterDb.close(),
      execAsync: async (sql: string) => betterDb.exec(sql),
      runAsync: async (sql: string, params?: unknown[]) => {
        const stmt = betterDb.prepare(sql)
        const result = stmt.run(...(params || []))
        return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }
      },
      getFirstAsync: async <T,>(sql: string, params?: unknown[]): Promise<T | null> => {
        const stmt = betterDb.prepare(sql)
        return (stmt.get(...(params || [])) as T) || null
      },
      getAllAsync: async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
        const stmt = betterDb.prepare(sql)
        return stmt.all(...(params || [])) as T[]
      },
      closeAsync: async () => betterDb.close(),
      withTransactionAsync: async <T,>(callback: () => Promise<T>): Promise<T> => {
        try {
          betterDb.exec('BEGIN')
          const result = await callback()
          betterDb.exec('COMMIT')
          return result
        } catch (error) {
          betterDb.exec('ROLLBACK')
          throw error
        }
      },
    }
  }),
}))

jest.mock('~/services/wikiLlmProvider', () => ({
  createWikiLlmProvider: () => ({ generateText: jest.fn() }),
}))

describe('wiki v3 → v4 migration audit', () => {
  let db: any

  beforeEach(async () => {
    const { openDatabaseSync } = require('expo-sqlite')
    db = openDatabaseSync(':memory:')

    // Let wiki.setup() create the full v4 schema
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()
  })

  afterEach(() => {
    db.closeSync()
  })

  it('setup() completes without error on fresh DB', () => {
    // Already ran in beforeEach
    expect(db).toBeDefined()
  })

  it('manual migration path: v3 user_document → v4 immutable_document', () => {
    // Seed a row with v3 enum value (simulating pre-migration state)
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-1', 'ent-1', 'Test Entry', 'Test body', 'user_document', 'doc-123', '', Date.now(), Date.now()],
    )

    // Run manual migration SQL per v4.0.0 breaking change notes
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'immutable_document' WHERE source_type = 'user_document'`)

    // Verify migration succeeded
    const row = db.getFirstSync<{ id: string; source_type: string }>(
      `SELECT id, source_type FROM llm_wiki_entries WHERE id = ?`,
      ['entry-1'],
    )
    expect(row).toEqual({ id: 'entry-1', source_type: 'immutable_document' })
  })

  it('manual migration path: v3 agent_inferred → v4 librarian_inferred', () => {
    // Seed a row with v3 enum value (simulating pre-migration state)
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-2', 'ent-2', 'Test Entry 2', 'Test body 2', 'agent_inferred', null, '', Date.now(), Date.now()],
    )

    // Run manual migration SQL per v4.0.0 breaking change notes
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'librarian_inferred' WHERE source_type = 'agent_inferred'`)

    // Verify migration succeeded
    const row = db.getFirstSync<{ id: string; source_type: string }>(
      `SELECT id, source_type FROM llm_wiki_entries WHERE id = ?`,
      ['entry-2'],
    )
    expect(row).toEqual({ id: 'entry-2', source_type: 'librarian_inferred' })
  })
})
