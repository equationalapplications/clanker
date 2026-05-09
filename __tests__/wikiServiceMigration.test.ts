/**
 * Migration audit: v3 schema seeded into SQLite, then wiki@4.1.0 setup() runs.
 * Asserts setup() does not throw and pre-existing rows are preserved.
 *
 * This test guards the v3 → v4 upgrade per spec § Risks.
 */

// Minimal v3 schema fragment — table prefix matches wikiService.
const V3_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS llm_wiki_entities (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS llm_wiki_facts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`

// Mock expo-sqlite for this test to use better-sqlite3
// Factory must require modules inline to avoid out-of-scope variable references
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => {
    // Require better-sqlite3 inline to avoid hoisting issues
    const BetterSqlite3 = require('better-sqlite3')
    const betterDb = new BetterSqlite3(':memory:')

    // Adapter to match expo-sqlite API (both sync and async)
    return {
      // Sync methods
      execSync: (sql: string) => {
        betterDb.exec(sql)
      },
      runSync: (sql: string, params?: unknown[]) => {
        const stmt = betterDb.prepare(sql)
        const result = stmt.run(...(params || []))
        return {
          changes: result.changes,
          lastInsertRowId: result.lastInsertRowid,
        }
      },
      getFirstSync: <T,>(sql: string, params?: unknown[]): T | null => {
        const stmt = betterDb.prepare(sql)
        return (stmt.get(...(params || [])) as T) || null
      },
      getAllSync: <T,>(sql: string, params?: unknown[]): T[] => {
        const stmt = betterDb.prepare(sql)
        return stmt.all(...(params || [])) as T[]
      },
      closeSync: () => {
        betterDb.close()
      },
      // Async methods (required by expo-llm-wiki)
      execAsync: async (sql: string) => {
        betterDb.exec(sql)
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        const stmt = betterDb.prepare(sql)
        const result = stmt.run(...(params || []))
        return {
          changes: result.changes,
          lastInsertRowId: result.lastInsertRowid,
        }
      },
      getFirstAsync: async <T,>(sql: string, params?: unknown[]): Promise<T | null> => {
        const stmt = betterDb.prepare(sql)
        return (stmt.get(...(params || [])) as T) || null
      },
      getAllAsync: async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
        const stmt = betterDb.prepare(sql)
        return stmt.all(...(params || [])) as T[]
      },
      closeAsync: async () => {
        betterDb.close()
      },
      // Transaction support with async callback
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

type SQLiteDatabase = {
  execSync: (sql: string) => void
  runSync: (sql: string, params?: unknown[]) => void
  getFirstSync: <T>(sql: string, params?: unknown[]) => T | null
  getAllSync: <T>(sql: string, params?: unknown[]) => T[]
  closeSync: () => void
}

function seedV3(db: SQLiteDatabase) {
  db.execSync(V3_TABLES_SQL)
  db.runSync(
    `INSERT INTO llm_wiki_entities (id, name, created_at) VALUES (?, ?, ?)`,
    ['ent-1', 'Test Char', 1_700_000_000_000],
  )
  db.runSync(
    `INSERT INTO llm_wiki_facts (id, entity_id, text, created_at) VALUES (?, ?, ?, ?)`,
    ['fact-1', 'ent-1', 'likes coffee', 1_700_000_001_000],
  )
}

describe('wiki v3 → v4 migration audit', () => {
  let db: SQLiteDatabase

  beforeEach(() => {
    const { openDatabaseSync } = require('expo-sqlite')
    db = openDatabaseSync(':memory:')
    seedV3(db)
  })

  afterEach(() => {
    db.closeSync()
  })

  it('setup() completes without error against v3-seeded DB', async () => {
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()
  })

  it('preserves pre-existing entity row after migration', async () => {
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()
    const row = db.getFirstSync<{ id: string; name: string }>(
      `SELECT id, name FROM llm_wiki_entities WHERE id = ?`,
      ['ent-1'],
    )
    expect(row).toEqual({ id: 'ent-1', name: 'Test Char' })
  })

  it('preserves pre-existing fact row after migration', async () => {
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()
    const row = db.getFirstSync<{ id: string; text: string }>(
      `SELECT id, text FROM llm_wiki_facts WHERE id = ?`,
      ['fact-1'],
    )
    expect(row).toEqual({ id: 'fact-1', text: 'likes coffee' })
  })
})
