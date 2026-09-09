import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

type DbClient = ReturnType<typeof drizzle<typeof schema>>

const isTestEnv = process.env.NODE_ENV === 'test'
const requiredVars = [
  'CLOUD_SQL_CONNECTION_NAME',
  'CLOUD_SQL_DB_USER',
  'CLOUD_SQL_DB_PASS',
  'CLOUD_SQL_DB_NAME',
] as const

let connector: Connector | null = null
let pool: pg.Pool | null = null
let dbPromise: Promise<DbClient> | null = null
let closePromise: Promise<void> | null = null
let shutdownHandlersRegistered = false

function getRequiredEnv(name: (typeof requiredVars)[number]): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required Cloud SQL environment variable: ${name}`)
  }
  return value
}

function assertCloudSqlEnv(): void {
  const missingVars = requiredVars.filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })

  if (missingVars.length > 0) {
    throw new Error(`Missing required Cloud SQL environment variables: ${missingVars.join(', ')}`)
  }
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) {
    return
  }

  shutdownHandlersRegistered = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void closeCloudSql()
    })
  }
}

async function createDb(): Promise<DbClient> {
  if (isTestEnv) {
    throw new Error(
      'Direct database access not allowed in test environment. ' +
        'Tests must mock repositories and services instead of connecting to real databases.',
    )
  }

  assertCloudSqlEnv()

  connector = new Connector()
  const clientOpts = await connector.getOptions({
    instanceConnectionName: getRequiredEnv('CLOUD_SQL_CONNECTION_NAME'),
    ipType: IpAddressTypes.PUBLIC,
  })

  pool = new pg.Pool({
    ...clientOpts,
    user: getRequiredEnv('CLOUD_SQL_DB_USER'),
    password: getRequiredEnv('CLOUD_SQL_DB_PASS'),
    database: getRequiredEnv('CLOUD_SQL_DB_NAME'),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Bounds every statement on this pool. Without it a query that stalls on a
    // row lock or a Cloud SQL failover hangs until the function's own timeout,
    // which for the proactive sweep means the platform kill lands mid-POST and
    // strands the claimed row. Every statement here is single-row OLTP or an
    // indexed scan that completes in well under a second, so 10s is an order of
    // magnitude of headroom — a statement that hits it was already an incident,
    // and aborting converts a silent hang into a logged error the sweep's
    // per-row catch and telemetry can see.
    statement_timeout: 10_000,
  })

  registerShutdownHandlers()
  return drizzle(pool, { schema })
}

export async function getDb(): Promise<DbClient> {
  if (!dbPromise) {
    dbPromise = createDb().catch((error) => {
      dbPromise = null
      throw error
    })
  }

  return dbPromise
}

export async function closeCloudSql(): Promise<void> {
  if (closePromise) {
    return closePromise
  }

  closePromise = (async () => {
    const closeErrors: unknown[] = []

    if (pool) {
      try {
        await pool.end()
      } catch (error) {
        closeErrors.push(error)
      }
    }

    if (connector) {
      try {
        connector.close()
      } catch (error) {
        closeErrors.push(error)
      }
    }

    pool = null
    connector = null
    dbPromise = null

    if (closeErrors.length > 0) {
      throw closeErrors[0]
    }
  })()

  try {
    await closePromise
  } finally {
    closePromise = null
  }
}
