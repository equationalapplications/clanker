/**
 * SQLite database connection and initialization
 */

import { Platform } from 'react-native'
import * as SQLite from 'expo-sqlite'
import {
    CREATE_TABLES,
    CREATE_WIKI_FTS,
    SCHEMA_VERSION,
    MIGRATIONS,
    LATEST_SCHEMA_REQUIRED_COLUMNS,
    MIGRATION_SKIP_GUARDS,
} from './schema'

let db: SQLite.SQLiteDatabase | null = null
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null
let wikiFtsAvailable = false

/**
 * Returns true if the SQLite build has FTS5 available and the wiki_fts virtual
 * table was successfully created during initialization. On web (wa-sqlite via
 * expo-sqlite) FTS5 is not bundled, so this returns false and callers should
 * fall back to a LIKE-based scan.
 */
export function isWikiFtsAvailable(): boolean {
    return wikiFtsAvailable
}

type DatabaseExecutor = Pick<
    SQLite.SQLiteDatabase,
    'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync'
>

function isOPFSLockError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error)
    return (
        msg.includes('NoModificationAllowedError') ||
        msg.includes('createSyncAccessHandle') ||
        msg.includes('Access Handles cannot be created')
    )
}

async function openDatabaseAsyncWithRetry(
    name: string,
    retries = 5,
    baseDelayMs = 300,
): Promise<SQLite.SQLiteDatabase> {
    let lastError: unknown
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await SQLite.openDatabaseAsync(name)
        } catch (error) {
            lastError = error
            if (!isOPFSLockError(error)) throw error
            console.warn(`[DB] OPFS lock on attempt ${attempt + 1}/${retries}, retrying…`)
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)))
        }
    }
    if (Platform.OS === 'web' && isOPFSLockError(lastError)) {
        console.error(
            `[DB] Retries exhausted while opening "${name}". Preserving existing OPFS data and aborting instead of deleting the database.`,
        )
        throw new Error(
            `Database "${name}" is locked in browser storage. Close other tabs or windows using this app and try again.`,
            { cause: lastError instanceof Error ? lastError : undefined },
        )
    }
    if (lastError instanceof Error) {
        throw lastError
    }
    throw new Error(`Failed to open database "${name}" after ${retries} attempt(s).`, {
        cause: lastError,
    })
}

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
            const database = await openDatabaseAsyncWithRetry('clanker.db')
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
        await tryInitializeWikiFts(database)

        console.log('✅ Database initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database:', error)
        throw error
    }
}

/**
 * Attempt to initialize FTS5 tables for wiki memory
 * On web (wa-sqlite via expo-sqlite), FTS5 may not be available, so this fails gracefully
 */
async function tryInitializeWikiFts(executor: DatabaseExecutor): Promise<void> {
    try {
        await executor.execAsync(CREATE_WIKI_FTS)
        wikiFtsAvailable = true
        console.log('✅ Wiki FTS5 tables initialized successfully')
    } catch (error) {
        wikiFtsAvailable = false
        // FTS5 is not available on web (wa-sqlite). Fail gracefully.
        // The wiki_entries table exists (created in CREATE_TABLES); searchEntries
        // falls back to a LIKE-based scan when this flag is false.
        if (Platform.OS === 'web') {
            console.warn(
                '[DB] FTS5 module not available on web platform. Wiki memory will use LIKE-based search fallback.',
            )
        } else {
            // On native platforms, FTS5 should be available. Log the actual error.
            console.error('Failed to initialize FTS5 tables:', error)
        }
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
        const hasCharacterColumn = (columnName: string) => characterColumnNames.has(columnName)
        const hasLatestCharacterSchema = LATEST_SCHEMA_REQUIRED_COLUMNS.characters.every(
            (requiredColumn) => hasCharacterColumn(requiredColumn),
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
        if (hasCharacterColumn('deleted_at')) inferredVersion = 2
        if (hasCharacterColumn('deleted_at') && hasCharacterColumn('avatar_data')) inferredVersion = 3
        if (
            hasCharacterColumn('deleted_at') &&
            hasCharacterColumn('avatar_data') &&
            hasCharacterColumn('avatar_mime_type')
        ) {
            inferredVersion = 4
        }
        if (
            hasCharacterColumn('deleted_at') &&
            hasCharacterColumn('avatar_data') &&
            hasCharacterColumn('avatar_mime_type') &&
            hasCharacterColumn('save_to_cloud')
        ) {
            inferredVersion = 5
        }
        if (
            hasCharacterColumn('deleted_at') &&
            hasCharacterColumn('avatar_data') &&
            hasCharacterColumn('avatar_mime_type') &&
            hasCharacterColumn('save_to_cloud') &&
            hasCharacterColumn('summary_checkpoint')
        ) {
            inferredVersion = 6
        }
        if (
            hasCharacterColumn('deleted_at') &&
            hasCharacterColumn('avatar_data') &&
            hasCharacterColumn('avatar_mime_type') &&
            hasCharacterColumn('save_to_cloud') &&
            hasCharacterColumn('summary_checkpoint') &&
            hasCharacterColumn('owner_user_id')
        ) {
            inferredVersion = 7
        }
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
            const skipGuards = MIGRATION_SKIP_GUARDS[version]
            if (skipGuards && skipGuards.length > 0) {
                // Skip migration if ALL guard columns already exist
                const allColumnsExist = await Promise.all(
                    skipGuards.map((guard) => hasColumn(executor, guard.table, guard.column))
                )
                if (allColumnsExist.every((exists) => exists)) {
                    const guardDescr = skipGuards.map((g) => `${g.table}.${g.column}`).join(', ')
                    console.log(`Skipping migration ${version}: ${guardDescr} already exist`)
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
