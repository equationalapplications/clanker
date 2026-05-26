# Cloud SQL Migrations

How to generate and apply schema migrations to the production Cloud SQL (PostgreSQL) instance.

## Architecture

- **ORM**: Drizzle ORM (TypeScript)
- **Database**: PostgreSQL 18 (Cloud SQL)
- **Schema definition**: `functions/src/db/schema.ts`
- **Migrations folder**: `functions/drizzle/`
- **Config**: `functions/drizzle.config.ts` (uses `DATABASE_URL`; do not hard-code production values)

> **Note:** There is no `__drizzle_migrations` tracking table in production. Migrations must be applied manually via the node script below. Keep the "Applied Migrations" list in this file up to date.
>
> **Warning:** Before generating or applying migrations, verify that `CLOUD_SQL_CONNECTION_NAME` points to the intended Cloud SQL instance (staging vs production). Do **not** run migration commands until you have confirmed the target.

---

## Applied Migrations

This list covers the initial schema plus all subsequent migration files. Files are listed in the order they were applied. `0003_character_voice.sql` was applied manually and is absent from the Drizzle journal — that is intentional. The duplicate `0004_` prefix is from Drizzle's own numbering and both files are distinct.

| # | File | Applied |
|---|---|---|
| initial | `0000_dazzling_kid_colt.sql` | Initial schema (users, subscriptions, characters, messages, credit_transactions) |
| 1 | `0001_credit_transactions_idempotency.sql` | Idempotency index on credit_transactions |
| 2 | `0002_users_timestamps_not_null.sql` | NOT NULL constraints on user timestamps |
| 3 | `0003_character_voice.sql` | `characters.voice` column *(not in Drizzle journal — applied manually 2026-04-29)* |
| 4 | `0004_wiki_memory.sql` | `wiki_entries`, `agent_tasks`, `memory_events` tables |
| 5 | `0004_lame_gwen_stacy.sql` | `wiki_entries.source_hash/source_ref`, updated source_type constraint |
| 6 | `0005_subscriptions_document_counter.sql` | `subscriptions.documents_ingested_count/date` |
| 7 | `0006_partial_source_hash_index.sql` | Partial index on `wiki_entries.source_hash` |
| 8 | `0007_source_ref_idx.sql` | Index on `wiki_entries.source_ref` |
| 9 | `0008_wiki_memory_v2.sql` | `llm_wiki_entries`, `llm_wiki_events`, `llm_wiki_tasks` tables + `characters.save_to_cloud` *(applied 2026-05-02)* |
| 10 | `0009_odd_sandman.sql` | `llm_wiki_entries`: `source_type`, `last_accessed_at`, `access_count` columns *(applied 2026-05-02)* |
| 11 | `0010_fix_source_type_check.sql` | Fix `source_type` CHECK constraint on `llm_wiki_entries` *(applied 2026-05-02)* |
| 12 | `0011_credits_redesign.sql` | `credit_transactions`: `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at`; `subscriptions`: `next_expiry_date`; backfill + constraints *(applied 2026-05-26)* |
| 13 | `0012_update_handle_new_user_trigger.sql` | Update `handle_new_user` trigger to seed signup credit transaction row *(applied 2026-05-26)* |

---

## Prerequisites

### gcloud application-default credentials

The Cloud SQL connector uses Application Default Credentials. Run once per machine:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "${GCP_PROJECT}"
```

`gcloud auth login` alone is not sufficient — application-default credentials are required.

---

## Step-by-Step: Apply Migrations

Before running any commands, set these shell variables to match your target environment:

```bash
# Set these to the target environment before proceeding
export GCP_PROJECT="your-project-id"
```

> **Warning:** Double-check `GCP_PROJECT` before continuing — running against the wrong instance may corrupt production data.

### 1. Fetch credentials from Secret Manager

```bash
export CLOUD_SQL_CONNECTION_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_CONNECTION_NAME --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_USER=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_USER --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_NAME --project="${GCP_PROJECT}")
```

### 2. Write a temporary migration runner

```bash
cat > /tmp/migrate.mjs << 'EOF'
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const required = (name) => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

const connectionName = required('CLOUD_SQL_CONNECTION_NAME');
const user = required('CLOUD_SQL_DB_USER');
const password = required('CLOUD_SQL_DB_PASS');
const database = required('CLOUD_SQL_DB_NAME');
const migrations = (process.env.MIGRATIONS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!migrations.length) {
  console.error('Set MIGRATIONS=file1.sql,file2.sql');
  process.exit(1);
}

const connector = new Connector();
const clientOpts = await connector.getOptions({
  instanceConnectionName: connectionName,
  ipType: IpAddressTypes.PUBLIC,
});

const pool = new pg.Pool({ ...clientOpts, user, password, database, max: 1 });
const client = await pool.connect();

try {
  for (const file of migrations) {
    const sqlPath = path.join(process.cwd(), 'drizzle', file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const stmts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    console.log(`Applying ${file} (${stmts.length} statements)…`);
    await client.query('BEGIN');
    try {
      for (const stmt of stmts) await client.query(stmt);
      await client.query('COMMIT');
      console.log(`  ✅ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
} catch (err) {
  console.error('❌', err.message, err.detail || '');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  connector.close();
}
EOF
```

### 3. Apply migrations

Edit the `MIGRATIONS` value to list only the files you want to apply, in order:

```bash
cd functions && MIGRATIONS="0013_my_new_migration.sql" node /tmp/migrate.mjs
```

### 4. Verify

```bash
node --input-type=module << 'EOF'
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';

const connector = new Connector();
const opts = await connector.getOptions({
  instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME,
  ipType: IpAddressTypes.PUBLIC,
});
const pool = new pg.Pool({ ...opts, user: process.env.CLOUD_SQL_DB_USER, password: process.env.CLOUD_SQL_DB_PASS, database: process.env.CLOUD_SQL_DB_NAME });
const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
console.log(rows.map(r => r.table_name));
await pool.end();
connector.close();
EOF
```

---

## Workflow for Schema Changes

1. Edit `functions/src/db/schema.ts`
2. Generate the migration file:
   ```bash
   cd functions && npx drizzle-kit generate
   ```
3. Review the generated SQL in `functions/drizzle/`
4. Follow steps 1–4 above, listing only the new file in `MIGRATIONS`
5. Commit both `schema.ts` and the migration SQL to git
