import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema.js'

export const TEST_DB_NAME = 'clanker_test'

const thisDir = path.dirname(fileURLToPath(import.meta.url))
// helpers → integration → lib-integration → functions/
const FUNCTIONS_ROOT = path.resolve(thisDir, '..', '..', '..')

const requiredTestUrl = (): string => {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw || !raw.startsWith('postgres')) {
    console.error(
      [
        'test:integration requires DATABASE_URL pointing at a LOCAL Postgres.',
        '',
        'Start the database:',
        '  docker compose -f docker-compose.local.yml up -d postgres_db',
        '',
        'Then point at the sibling TEST database (never the dev "clanker" db):',
        "  export DATABASE_URL='postgres://clanker_dev:local_pass@localhost:5432/clanker_test'",
        '',
        'Then re-run:  npm --prefix functions run test:integration',
      ].join('\n'),
    )
    process.exit(1)
  }
  return raw
}

export const resolveTestUrl = (): string => {
  const url = new URL(requiredTestUrl())
  if (url.pathname.replace(/^\//, '') === 'clanker') {
    throw new Error(
      `Hard guard: refusing to operate on the dev database "${url.pathname}". Point DATABASE_URL at ${TEST_DB_NAME}.`,
    )
  }
  return url.toString()
}

let readyPromise: Promise<void> | null = null

/** Preflight → CREATE DATABASE if absent → migrate once. Memoized per process. */
export const ensureIntegrationDatabase = (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = (async () => {
      const testUrl = resolveTestUrl()
      const adminUrl = new URL(testUrl)
      adminUrl.pathname = '/postgres'

      const admin = new pg.Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      try {
        await admin.query('SELECT 1') // unreachable-database fails HERE, once, loudly
        const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          TEST_DB_NAME,
        ])
        if (existing.rowCount === 0) {
          await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
        }
      } finally {
        await admin.end()
      }

      // scripts/migrate-dev.mjs honors DATABASE_URL verbatim and is idempotent;
      // it refuses non-local hosts, so this can never touch Cloud SQL.
      const result = spawnSync('node', ['scripts/migrate-dev.mjs'], {
        env: { ...process.env, DATABASE_URL: testUrl },
        cwd: FUNCTIONS_ROOT,
        stdio: 'inherit',
      })
      if (result.status !== 0) {
        throw new Error(`migrate-dev.mjs failed with exit code ${result.status}; aborting.`)
      }
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

let poolInstance: pg.Pool | null = null
export const getPool = (): pg.Pool => {
  if (!poolInstance) {
    poolInstance = new pg.Pool({ connectionString: resolveTestUrl(), max: 5 })
  }
  return poolInstance
}

type TestDb = NodePgDatabase<typeof schema>
let dbInstance: TestDb | null = null
/** Drop-in replacement for cloudSql getDb — hands the REAL services a test connection. */
export const testGetDb = async (): Promise<TestDb> => {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema })
  }
  return dbInstance
}

export type UserRow = typeof schema.users.$inferSelect

export const seedUser = async (firebaseUid: string, email: string): Promise<UserRow> => {
  const db = await testGetDb()
  const [row] = await db.insert(schema.users).values({ firebaseUid, email }).returning()
  return row
}

/** TRUNCATE the five payment tables; CASCADE handles FK children, RESTART IDENTITY resets sequences. */
export const truncateAll = async (): Promise<void> => {
  await getPool().query(
    'TRUNCATE users, subscriptions, processed_stripe_events, credit_transactions, credit_spend_events RESTART IDENTITY CASCADE',
  )
}

export const closeIntegrationPool = async (): Promise<void> => {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
    dbInstance = null
  }
}
