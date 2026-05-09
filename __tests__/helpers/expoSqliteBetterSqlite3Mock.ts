/**
 * Test helper: Mocks expo-sqlite to use better-sqlite3 for in-memory testing.
 * Implements both sync and async expo-sqlite APIs using better-sqlite3 as the backend.
 */
export function createExpoSqliteBetterSqlite3Mock() {
  return {
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
  }
}
