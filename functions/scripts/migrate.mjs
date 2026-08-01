/**
 * Apply Cloud SQL migration SQL files to production.
 *
 * Tracks applied files in a schema_migrations table so re-runs are safe and
 * out-of-order application is caught before it corrupts the schema. Prior to
 * 2026-08-01 production had no tracking at all: the only record was a
 * hand-maintained table in docs/db-migrations.md, which drifted from reality
 * and let 0001 go unapplied for months (see that doc's incident note).
 *
 * Usage (from functions/, normally via `npm run deploy:migrations`):
 *   MIGRATIONS=0023_my_change.sql npm run migrate
 *   STAMP_MIGRATIONS=0022_character_images.sql npm run migrate   # baseline, no SQL executed
 *
 * Escape hatches (avoid unless you know why you need them):
 *   ALLOW_OUT_OF_ORDER=1  apply even though earlier migrations are unapplied
 *   ALLOW_UNTRACKED=1     apply a file that is not in MIGRATION_ORDER
 */
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MIGRATION_ORDER, migrationIndex, missingPrerequisites } from './migrationOrder.mjs';

const required = ['CLOUD_SQL_CONNECTION_NAME', 'CLOUD_SQL_DB_USER', 'CLOUD_SQL_DB_PASS', 'CLOUD_SQL_DB_NAME'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

if (!process.env.MIGRATIONS && !process.env.STAMP_MIGRATIONS) {
  console.error('Missing required env var: MIGRATIONS (or STAMP_MIGRATIONS to baseline)');
  process.exit(1);
}

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

function resolveMigrationPath(file) {
  const base = path.basename(file);
  if (base !== file || !/^[a-zA-Z0-9_.-]+\.sql$/.test(base)) {
    console.error(`Invalid migration filename: ${file} (must be a simple .sql basename in functions/drizzle/)`);
    process.exit(1);
  }
  const fullPath = path.resolve(drizzleDir, base);
  if (fullPath !== drizzleDir && !fullPath.startsWith(`${drizzleDir}${path.sep}`)) {
    console.error(`Migration path escapes drizzle directory: ${file}`);
    process.exit(1);
  }
  if (!existsSync(fullPath)) {
    console.error(`Migration file not found: ${fullPath}`);
    process.exit(1);
  }
  return fullPath;
}

function parseList(value) {
  return value.split(',').map((f) => f.trim()).filter(Boolean);
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY id');
  return new Set(rows.map((row) => row.filename));
}

async function recordMigration(client, filename) {
  await client.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename]
  );
}

/**
 * Refuse to apply a migration while anything earlier in MIGRATION_ORDER is still
 * unapplied. This is the guard that would have caught 0021 being applied on top of
 * a database that never received 0001 — 0021's trigger depends on the index 0001
 * creates, so the mismatch only surfaced later as a runtime 42P10 on every signup.
 */
function assertPrerequisites(file, applied, batch) {
  const missing = missingPrerequisites(file, applied, batch);
  if (missing.length === 0) return;

  console.error(`Refusing to apply ${file}: earlier migrations are not applied:`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    'Apply those first, or if they genuinely ran outside this tracker, baseline with:\n' +
    `  STAMP_MIGRATIONS=<last-applied-file> npm run migrate\n` +
    'Set ALLOW_OUT_OF_ORDER=1 to override (rarely correct).'
  );
  process.exit(1);
}

function assertTracked(file) {
  if (migrationIndex(file) !== -1) return;
  if (process.env.ALLOW_UNTRACKED === '1') {
    console.warn(`Warning: ${file} is not in MIGRATION_ORDER; applying anyway (ALLOW_UNTRACKED=1).`);
    return;
  }
  console.error(
    `Unknown migration file: ${file}\n` +
    'Add it to scripts/migrationOrder.mjs (MIGRATION_ORDER) so both runners agree on ordering, ' +
    'or set ALLOW_UNTRACKED=1 for a one-off.'
  );
  process.exit(1);
}

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
  await ensureMigrationsTable(client);

  // Baseline mode: record everything through the named file as applied, without
  // executing any SQL. Used once to adopt tracking on a database whose schema was
  // already verified to match the migration set.
  if (process.env.STAMP_MIGRATIONS) {
    const stampFiles = parseList(process.env.STAMP_MIGRATIONS);
    if (stampFiles.length !== 1) {
      console.error('STAMP_MIGRATIONS must name exactly one migration file (stamps through it inclusive).');
      process.exit(1);
    }
    const throughIdx = migrationIndex(stampFiles[0]);
    if (throughIdx === -1) {
      console.error(`Unknown migration file: ${stampFiles[0]}`);
      process.exit(1);
    }
    const toStamp = MIGRATION_ORDER.slice(0, throughIdx + 1);
    await client.query('BEGIN');
    try {
      for (const file of toStamp) {
        await recordMigration(client, file);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(`Stamped ${toStamp.length} migration(s) through ${stampFiles[0]} (SQL not executed).`);
    process.exit(0);
  }

  const requested = parseList(process.env.MIGRATIONS);
  const applied = await getApplied(client);

  const pending = [];
  for (const file of requested) {
    resolveMigrationPath(file);
    assertTracked(file);
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied).`);
      continue;
    }
    pending.push(file);
  }

  if (pending.length === 0) {
    console.log('No pending migrations.');
    process.exit(0);
  }

  if (process.env.ALLOW_OUT_OF_ORDER !== '1') {
    for (const file of pending) {
      assertPrerequisites(file, applied, pending);
    }
  }

  for (const file of pending) {
    const fullPath = resolveMigrationPath(file);
    const sql = readFileSync(fullPath, 'utf8');
    console.log(`Applying ${path.basename(file)}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      // Recorded inside the migration's own transaction, so a failed migration
      // never leaves a row claiming it succeeded.
      await recordMigration(client, file);
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
