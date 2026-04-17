import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let pool: pg.Pool;
const isTestEnv = process.env.NODE_ENV === 'test';

if (isTestEnv) {
  // Unit tests stub repository/service methods and should not require Cloud SQL config.
  pool = new pg.Pool();
} else {
  const requiredVars = [
    'CLOUD_SQL_CONNECTION_NAME',
    'CLOUD_SQL_DB_USER',
    'CLOUD_SQL_DB_PASS',
    'CLOUD_SQL_DB_NAME',
  ] as const;

  const missingVars = requiredVars.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required Cloud SQL environment variables: ${missingVars.join(', ')}`
    );
  }

  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME!,
    ipType: IpAddressTypes.PRIVATE,
  });

  pool = new pg.Pool({
    ...clientOpts,
    user: process.env.CLOUD_SQL_DB_USER!,
    password: process.env.CLOUD_SQL_DB_PASS!,
    database: process.env.CLOUD_SQL_DB_NAME!,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

export const db = drizzle(pool, { schema });
