/**
 * SQLite database connection and initialization
 */

import * as SQLite from 'expo-sqlite'
import { CREATE_TABLES, SCHEMA_VERSION, MIGRATIONS } from './schema'

let db: SQLite.SQLiteDatabase | null = null

/**
 * Initialize and return the database instance
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (db) return db

    try {
        db = await SQLite.openDatabaseAsync('clanker.db')
        await initializeDatabase(db)
        return db
    } catch (error) {
        console.error('Failed to open database:', error)
        throw error
    }
}

/**
 * Initialize database schema
 */
async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
    try {
        // Create tables
        await database.execAsync(CREATE_TABLES)

        // Check current schema version
        const result = await database.getFirstAsync<{ version: number }>(
            'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
        )

        const currentVersion = result?.version || 0

        // Run migrations if needed
        if (currentVersion < SCHEMA_VERSION) {
            await runMigrations(database, currentVersion)
        }

        console.log('✅ Database initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database:', error)
        throw error
    }
}

/**
 * Run database migrations
 */
async function runMigrations(
    database: SQLite.SQLiteDatabase,
    fromVersion: number,
): Promise<void> {
    console.log(`Running migrations from version ${fromVersion} to ${SCHEMA_VERSION}`)

    for (let version = fromVersion + 1; version <= SCHEMA_VERSION; version++) {
        const migration = MIGRATIONS[version]
        if (migration) {
            console.log(`Applying migration ${version}`)
            await database.execAsync(migration)
        }
    }

    // Update schema version
    await database.runAsync(
        'INSERT OR REPLACE INTO schema_version (version, updated_at) VALUES (?, ?)',
        [SCHEMA_VERSION, Date.now()],
    )
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
    if (db) {
        await db.closeAsync()
        db = null
        console.log('Database closed')
    }
}

/**
 * Clear all data (for testing/reset)
 */
export async function clearAllData(): Promise<void> {
    const database = await getDatabase()
    await database.execAsync('DELETE FROM messages;')
    console.log('All data cleared')
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
    messageCount: number
    databaseSize: number
}> {
    const database = await getDatabase()

    const messageCount =
        (
            await database.getFirstAsync<{ count: number }>(
                'SELECT COUNT(*) as count FROM messages',
            )
        )?.count || 0

    // Note: Getting actual file size requires native module or file system access
    // For now, return 0 or estimate based on row count
    const databaseSize = 0

    return {
        messageCount,
        databaseSize,
    }
}
