import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let pool: pg.Pool;

if (process.env.NODE_ENV === 'test' || !process.env.CLOUD_SQL_CONNECTION_NAME) {
  // Use a dummy pool for unit tests or local development without cloud sql access
  pool = new pg.Pool();
} else {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME,
    ipType: IpAddressTypes.PRIVATE,
  });

  pool = new pg.Pool({
    ...clientOpts,
    user: process.env.CLOUD_SQL_DB_USER,
    password: process.env.CLOUD_SQL_DB_PASS,
    database: process.env.CLOUD_SQL_DB_NAME,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

export const db = drizzle(pool, { schema });
