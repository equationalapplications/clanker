import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const required = ['CLOUD_SQL_CONNECTION_NAME', 'CLOUD_SQL_DB_USER', 'CLOUD_SQL_DB_PASS', 'CLOUD_SQL_DB_NAME', 'MIGRATIONS'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const files = process.env.MIGRATIONS.split(',').map((f) => f.trim()).filter(Boolean);
const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

const connector = new Connector();
const clientOpts = await connector.getOptions({
  instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME,
  ipType: IpAddressTypes.PUBLIC,
});

const pool = new pg.Pool({
  ...clientOpts,
  user: process.env.CLOUD_SQL_DB_USER,
  password: process.env.CLOUD_SQL_DB_PASS,
  database: process.env.CLOUD_SQL_DB_NAME,
  max: 1,
});

const client = await pool.connect();
try {
  for (const file of files) {
    const fullPath = path.join(drizzleDir, file);
    const sql = readFileSync(fullPath, 'utf8');
    console.log(`Applying ${file}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
} finally {
  client.release();
  await pool.end();
  connector.close();
}
console.log('All migrations applied.');
