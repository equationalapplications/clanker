/**
 * SQLite database connection and initialization
 */

import { Platform } from 'react-native'
import * as SQLite from 'expo-sqlite'
import {
    CREATE_TABLES,
    SCHEMA_VERSION,
    MIGRATIONS,
    LATEST_SCHEMA_REQUIRED_COLUMNS,
    MIGRATION_SKIP_GUARDS,
} from './schema'

let db: SQLite.SQLiteDatabase | null = null
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

type DatabaseExecutor = Pick<
    SQLite.SQLiteDatabase,
    'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync'
>

/**
 * Initialize and return the database instance
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (dbPromise) {
        return dbPromise
    }

    if (db && !dbPromise) {
        try {
            await db.closeAsync()
        } catch (error) {
            console.warn('Failed to close stale database connection:', error)
        } finally {
            db = null
            dbPromise = null
        }
    }

    dbPromise = (async () => {
        try {
            const database = await SQLite.openDatabaseAsync('clanker.db')
            await initializeDatabase(database)
            db = database
            return database
        } catch (error) {
            db = null
            dbPromise = null
            console.error('Failed to open database:', error)
            throw error
        }
    })()

    return dbPromise
}

/**
 * Initialize database schema
 */
async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
    try {
        // On web (wa-sqlite + AccessHandlePoolVFS), the VFS cannot create the
        // SQLite rollback journal file alongside the database, causing all writes
        // to fail with SQLITE_CANTOPEN. Setting journal_mode=MEMORY stores the
        // rollback journal in RAM instead of a file. On native we keep WAL mode
        // for better durability (crash-safe rollback journal on disk).
        if (Platform.OS === 'web') {
            await database.execAsync('PRAGMA journal_mode=MEMORY;')
        } else {
            await database.execAsync('PRAGMA journal_mode=WAL;')
        }

        await applyInitializationPlan(database)

        console.log('✅ Database initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database:', error)
        throw error
    }
}

async function applyInitializationPlan(executor: DatabaseExecutor): Promise<void> {
    // Create tables (uses IF NOT EXISTS — safe on both fresh and existing DBs)
    await executor.execAsync(CREATE_TABLES)

    // Check current schema version
    const result = await executor.getFirstAsync<{ version: number }>(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
    )

    if (!result) {
        // No recorded schema version. This can mean:
        // - A true fresh install where CREATE_TABLES already created the latest schema
        // - A legacy DB that predates schema_version and still needs migrations
        //
        // Distinguish between these by confirming the DB already has the
        // migration-added columns from the latest schema.
        const columns = await executor.getAllAsync<{ name: string }>('PRAGMA table_info(characters)')
        const characterColumnNames = new Set(columns.map((column) => column.name))
        const hasDeletedAt = characterColumnNames.has('deleted_at')
        const hasAvatarData = characterColumnNames.has('avatar_data')
        const hasAvatarMimeType = characterColumnNames.has('avatar_mime_type')
        const hasSaveToCloud = characterColumnNames.has('save_to_cloud')
        const hasLatestCharacterSchema = LATEST_SCHEMA_REQUIRED_COLUMNS.characters.every(
            (requiredColumn) => characterColumnNames.has(requiredColumn),
        )

        if (hasLatestCharacterSchema) {
            // Fresh DB already at latest schema: just record the current schema version
            await executor.runAsync(
                'INSERT OR REPLACE INTO schema_version (version, updated_at) VALUES (?, ?)',
                [SCHEMA_VERSION, Date.now()],
            )
            return
        }

        // Legacy DB without schema_version can be partially migrated.
        // Infer the nearest version so we only apply missing migrations.
        let inferredVersion = 0
        if (hasDeletedAt) inferredVersion = 2
        if (hasDeletedAt && hasAvatarData) inferredVersion = 3
        if (hasDeletedAt && hasAvatarData && hasAvatarMimeType) inferredVersion = 4
        if (hasDeletedAt && hasAvatarData && hasAvatarMimeType && hasSaveToCloud) inferredVersion = 5
        await runMigrations(executor, inferredVersion)
        return
    }

    if (result.version < SCHEMA_VERSION) {
        // Existing DB that needs upgrading
        await runMigrations(executor, result.version)
    }
}

/**
 * Run database migrations
 */
async function runMigrations(executor: DatabaseExecutor, fromVersion: number): Promise<void> {
    console.log(`Running migrations from version ${fromVersion} to ${SCHEMA_VERSION}`)

    await applyMigrations(executor, fromVersion)
}

async function applyMigrations(executor: DatabaseExecutor, fromVersion: number): Promise<void> {
    for (let version = fromVersion + 1; version <= SCHEMA_VERSION; version++) {
        const migration = MIGRATIONS[version]
        if (migration) {
            const skipGuard = MIGRATION_SKIP_GUARDS[version]
            if (skipGuard) {
                const columnExists = await hasColumn(executor, skipGuard.table, skipGuard.column)
                if (columnExists) {
                    console.log(
                        `Skipping migration ${version}: ${skipGuard.table}.${skipGuard.column} already exists`,
                    )
                    continue
                }
            }

            console.log(`Applying migration ${version}`)
            await execStatementsSequentially(executor, migration)
        }
    }

    // Update schema version
    await executor.runAsync(
        'INSERT OR REPLACE INTO schema_version (version, updated_at) VALUES (?, ?)',
        [SCHEMA_VERSION, Date.now()],
    )
}

async function hasColumn(
    database: DatabaseExecutor,
    tableName: string,
    columnName: string,
): Promise<boolean> {
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`)
    return columns.some((column) => column.name === columnName)
}

async function execStatementsSequentially(
    database: DatabaseExecutor,
    sqlBatch: string,
): Promise<void> {
    const statements = sqlBatch
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)

    for (const statement of statements) {
        try {
            await database.execAsync(`${statement};`)
        } catch (error) {
            console.error(`Failed SQL statement: ${statement};`, error)
            throw error
        }
    }
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
    let databaseToClose = db

    if (!databaseToClose && dbPromise) {
        try {
            databaseToClose = await dbPromise
        } catch {
            db = null
            dbPromise = null
            return
        }
    }

    if (databaseToClose) {
        await databaseToClose.closeAsync()
    }

    db = null
    dbPromise = null
    console.log('Database closed')
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
