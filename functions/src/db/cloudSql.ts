import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let poolInstance: pg.Pool | null = null;

export async function getDb() {
  if (dbInstance) return dbInstance;

  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME || '',
    ipType: IpAddressTypes.PRIVATE,
  });

  poolInstance = new pg.Pool({
    ...clientOpts,
    user: process.env.CLOUD_SQL_DB_USER,
    password: process.env.CLOUD_SQL_DB_PASS,
    database: process.env.CLOUD_SQL_DB_NAME,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  dbInstance = drizzle(poolInstance, { schema });
  return dbInstance;
}

// For cases where we can't await, we export a proxy or just rely on getDb
// Since repositories are already written to use `db` directly, 
// we might need to refactor them or use a Proxy.

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    if (!dbInstance) {
      throw new Error('Database not initialized. Call getDb() first or ensure async context.');
    }
    return (dbInstance as any)[prop];
  },
});
