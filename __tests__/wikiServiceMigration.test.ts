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

  beforeEach(() => {
    const { openDatabaseSync } = require('expo-sqlite')
    db = openDatabaseSync(':memory:')
  })

  afterEach(() => {
    db.closeSync()
  })

  it('v3 DB upgrades to v4 after manual enum migration', async () => {
    // 1. Seed minimal v3 schema
    db.execSync(`
      CREATE TABLE llm_wiki_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE llm_wiki_entries (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        source_hash TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (entity_id) REFERENCES llm_wiki_entities(id)
      );
      CREATE TABLE llm_wiki_facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES llm_wiki_entities(id)
      );
    `)

    // 2. Insert test data with v3 enum values
    const now = Date.now()
    db.runSync(
      `INSERT INTO llm_wiki_entities (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['ent-1', 'Test Entity', now, now],
    )
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-1', 'ent-1', 'User Doc Entry', 'Body 1', 'user_document', 'doc-123', '', now, now],
    )
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-2', 'ent-1', 'Agent Entry', 'Body 2', 'agent_inferred', null, '', now, now],
    )

    // 3. Run manual migration SQL per v4.0.0 breaking change notes
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'immutable_document' WHERE source_type = 'user_document'`)
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'librarian_inferred' WHERE source_type = 'agent_inferred'`)

    // 4. Run wiki.setup() to upgrade schema to v4
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()

    // 5. Verify rows preserved with correct v4 enum values
    const rows = db.getAllSync(`SELECT id, source_type FROM llm_wiki_entries ORDER BY id`)
    expect(rows).toEqual([
      { id: 'entry-1', source_type: 'immutable_document' },
      { id: 'entry-2', source_type: 'librarian_inferred' },
    ])

    // Verify entity also preserved
    const entity = db.getFirstSync(`SELECT id, name FROM llm_wiki_entities`)
    expect(entity).toEqual({ id: 'ent-1', name: 'Test Entity' })
  })
})
