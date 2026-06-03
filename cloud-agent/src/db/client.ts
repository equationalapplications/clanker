import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>

const isTestEnv = process.env.NODE_ENV === 'test'
const requiredVars = [
  'CLOUD_SQL_CONNECTION_NAME',
  'CLOUD_SQL_DB_USER',
  'CLOUD_SQL_DB_PASS',
  'CLOUD_SQL_DB_NAME',
] as const

let connector: Connector | null = null
let pool: pg.Pool | null = null
let dbPromise: Promise<DrizzleClient> | null = null
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
  const missing = requiredVars.filter((n) => {
    const v = process.env[n]
    return !v || v.trim().length === 0
  })
  if (missing.length > 0) {
    throw new Error(`Missing required Cloud SQL environment variables: ${missing.join(', ')}`)
  }
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return
  shutdownHandlersRegistered = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void closeCloudSql() })
  }
}

async function createDb(): Promise<DrizzleClient> {
  if (isTestEnv) {
    throw new Error(
      'Direct database access not allowed in test environment. ' +
      'Tests must inject a mock DrizzleClient.'
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
  })

  registerShutdownHandlers()
  return drizzle(pool, { schema })
}

export async function getDb(): Promise<DrizzleClient> {
  if (!dbPromise) {
    dbPromise = createDb().catch((error) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export async function closeCloudSql(): Promise<void> {
  if (closePromise) return closePromise

  closePromise = (async () => {
    const errors: unknown[] = []
    if (pool) {
      try { await pool.end() } catch (e) { errors.push(e) }
    }
    if (connector) {
      try { connector.close() } catch (e) { errors.push(e) }
    }
    pool = null
    connector = null
    dbPromise = null
    if (errors.length > 0) throw errors[0]
  })()

  try {
    await closePromise
  } finally {
    closePromise = null
  }
}
