/**
 * Apply Cloud SQL migration SQL files to the local docker-compose Postgres.
 *
 * Uses a dev-only dev_migrations tracking table (production has no migration journal).
 *
 * Usage (from functions/):
 *   npm run migrate:dev
 *   MIGRATIONS=0016_llm_wiki_graph.sql npm run migrate:dev
 *   STAMP_MIGRATIONS=0014_pgvector_wiki_embeddings.sql npm run migrate:dev
 *
 * Defaults DATABASE_URL to docker-compose.local.yml credentials on localhost:5432.
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_DATABASE_URL = 'postgres://clanker_dev:local_pass@localhost:5432/clanker';

/** Authoritative apply order — mirrors docs/architecture-and-data.md (incl. hand-written 0012–0016). */
const MIGRATION_ORDER = [
  '0000_dazzling_kid_colt.sql',
  '0001_credit_transactions_idempotency.sql',
  '0002_users_timestamps_not_null.sql',
  '0003_character_voice.sql',
  '0004_wiki_memory.sql',
  '0004_lame_gwen_stacy.sql',
  '0005_subscriptions_document_counter.sql',
  '0006_partial_source_hash_index.sql',
  '0007_source_ref_idx.sql',
  '0008_wiki_memory_v2.sql',
  '0009_odd_sandman.sql',
  '0010_fix_source_type_check.sql',
  '0011_credits_redesign.sql',
  '0012_update_handle_new_user_trigger.sql',
  '0013_cloud_agent_tasks.sql',
  '0014_pgvector_wiki_embeddings.sql',
  '0015_organizations.sql',
  '0016_llm_wiki_graph.sql',
];

/** seedLocal.ts creates schema through pgvector embeddings but not org/graph tables. */
const SEED_LOCAL_BASELINE_THROUGH = '0014_pgvector_wiki_embeddings.sql';

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres_db', '::1']);

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

function assertLocalDatabaseUrl(connectionString) {
  if (process.env.FORCE_MIGRATE_DEV === '1') return;

  let hostname;
  try {
    const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
    hostname = url.hostname;
  } catch {
    console.error('DATABASE_URL is not a valid Postgres connection string.');
    process.exit(1);
  }

  if (!LOCAL_DB_HOSTS.has(hostname)) {
    console.error(
      `Refusing to run dev migrations against non-local host "${hostname}". ` +
      'Set FORCE_MIGRATE_DEV=1 to override.'
    );
    process.exit(1);
  }
}

function resolveMigrationFiles() {
  if (process.env.MIGRATIONS) {
    const files = process.env.MIGRATIONS.split(',').map((f) => f.trim()).filter(Boolean);
    for (const file of files) {
      if (!MIGRATION_ORDER.includes(file)) {
        console.error(`Unknown migration file: ${file}`);
        console.error(`Known migrations: ${MIGRATION_ORDER.join(', ')}`);
        process.exit(1);
      }
      const fullPath = path.join(drizzleDir, file);
      if (!existsSync(fullPath)) {
        console.error(`Migration file not found: ${fullPath}`);
        process.exit(1);
      }
    }
    return files;
  }
  return [...MIGRATION_ORDER];
}

function indexThrough(filename) {
  const idx = MIGRATION_ORDER.indexOf(filename);
  if (idx === -1) {
    console.error(`Unknown migration file: ${filename}`);
    process.exit(1);
  }
  return idx;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dev_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM dev_migrations ORDER BY id');
  return new Set(rows.map((row) => row.filename));
}

async function recordMigration(client, filename) {
  await client.query(
    'INSERT INTO dev_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename]
  );
}

async function stampMigrations(client, throughFilename) {
  const throughIdx = indexThrough(throughFilename);
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
  console.log(`Stamped ${toStamp.length} migration(s) through ${throughFilename} (SQL not executed).`);
}

async function maybeBaselineSeedLocal(client, applied) {
  if (applied.size > 0) return;
  if (process.env.MIGRATIONS || process.env.STAMP_MIGRATIONS) return;

  const { rows: [{ exists: hasUsers }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `);
  if (!hasUsers) return;

  const { rows: [{ exists: hasEmbedding }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'llm_wiki_entries' AND column_name = 'embedding'
    ) AS exists
  `);
  if (!hasEmbedding) {
    console.error(
      'Database has a users table but no dev_migrations history and no llm_wiki_entries.embedding column.\n' +
      'Wipe the Postgres volume for a clean slate, or stamp a baseline:\n' +
      `  STAMP_MIGRATIONS=${SEED_LOCAL_BASELINE_THROUGH} npm run migrate:dev`
    );
    process.exit(1);
  }

  console.log(
    'Detected seedLocal-style schema without dev_migrations history; baselining through ' +
    `${SEED_LOCAL_BASELINE_THROUGH}.`
  );
  await stampMigrations(client, SEED_LOCAL_BASELINE_THROUGH);
}

async function applyMigration(client, filename) {
  const fullPath = path.join(drizzleDir, filename);
  const sql = readFileSync(fullPath, 'utf8');
  console.log(`Applying ${filename}...`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await recordMigration(client, filename);
    await client.query('COMMIT');
    console.log(`Applied ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
assertLocalDatabaseUrl(databaseUrl);

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
});

const client = await pool.connect();
try {
  await ensureMigrationsTable(client);

  if (process.env.STAMP_MIGRATIONS) {
    const stampFiles = process.env.STAMP_MIGRATIONS.split(',').map((f) => f.trim()).filter(Boolean);
    if (stampFiles.length !== 1) {
      console.error('STAMP_MIGRATIONS must name exactly one migration file (stamps through it inclusive).');
      process.exit(1);
    }
    await stampMigrations(client, stampFiles[0]);
    process.exit(0);
  }

  let applied = await getAppliedMigrations(client);
  await maybeBaselineSeedLocal(client, applied);
  applied = await getAppliedMigrations(client);

  const requested = resolveMigrationFiles();
  const pending = requested.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log('No pending dev migrations.');
    process.exit(0);
  }

  for (const file of pending) {
    await applyMigration(client, file);
  }
} finally {
  client.release();
  await pool.end();
}

console.log('All pending dev migrations applied.');
