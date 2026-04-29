# Cloud SQL Migrations

How to generate and apply schema migrations to the production Cloud SQL (PostgreSQL) instance.

## Architecture

- **ORM**: Drizzle ORM (TypeScript)
- **Database**: PostgreSQL 18 (Cloud SQL — `clanker-prod:us-central1:clanker-prod`)
- **Schema definition**: `functions/src/db/schema.ts`
- **Migrations folder**: `functions/drizzle/`
- **Config**: `functions/drizzle.config.ts`

> **Note:** There is no `__drizzle_migrations` tracking table in production. Migrations must be applied manually via the node script below. Keep the "Applied Migrations" list in this file up to date.

---

## Applied Migrations

| # | File | Description |
|---|---|---|
| 0 | `0000_dazzling_kid_colt.sql` | Initial schema (users, subscriptions, characters, messages, credit_transactions) |
| 1 | `0001_credit_transactions_idempotency.sql` | Idempotency index on credit_transactions |
| 2 | `0002_users_timestamps_not_null.sql` | NOT NULL constraints on user timestamps |
| 3 | `0003_character_voice.sql` | `characters.voice` column *(not in journal — applied manually 2026-04-29)* |
| 4 | `0004_wiki_memory.sql` | `wiki_entries`, `agent_tasks`, `memory_events` tables |
| 5 | `0004_lame_gwen_stacy.sql` | `wiki_entries.source_hash/source_ref`, updated source_type constraint |
| 6 | `0005_subscriptions_document_counter.sql` | `subscriptions.documents_ingested_count/date` |
| 7 | `0006_partial_source_hash_index.sql` | Partial index on `wiki_entries.source_hash` |
| 8 | `0007_source_ref_idx.sql` | Index on `wiki_entries.source_ref` |

---

## Prerequisites

### Cloud SQL Auth Proxy

The proxy must be running before any DB access. The binary lives at `/tmp/cloud-sql-proxy` (it doesn't survive reboots — re-download if missing):

```bash
curl -o /tmp/cloud-sql-proxy \
  https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.15.2/cloud-sql-proxy.darwin.amd64 \
  && chmod +x /tmp/cloud-sql-proxy
```

### gcloud authentication

```bash
gcloud auth application-default login
```

Run this if you see `invalid_grant` / RAPT errors from the proxy. `gcloud auth login` alone is not sufficient — application-default credentials are required.

---

## Step-by-Step: Apply Migrations

### 1. Start the proxy

```bash
/tmp/cloud-sql-proxy clanker-prod:us-central1:clanker-prod --port 5433 &
```

### 2. Build DATABASE_URL

The DB password contains special characters and must be URL-encoded:

```bash
DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project=clanker-prod)
ENCODED_PASS=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$DB_PASS")
export DATABASE_URL="postgresql://clanker_app:${ENCODED_PASS}@127.0.0.1:5433/clanker"
```

### 3. Apply migrations

Edit the `MIGRATIONS` array to list only the files you want to apply, in order:

```bash
cd functions
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const MIGRATIONS = [
  // '0008_my_new_migration.sql',
];
(async () => {
  const client = await p.connect();
  try {
    for (const file of MIGRATIONS) {
      const stmts = fs.readFileSync('drizzle/' + file, 'utf8')
        .split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      console.log('Applying', file, '(' + stmts.length + ' statements)');
      for (const stmt of stmts) await client.query(stmt);
      console.log('  ✅ Done');
    }
  } catch (err) {
    console.error('❌', err.message, err.detail || '');
  } finally { client.release(); p.end(); }
})();
"
```

### 4. Verify

```bash
node -e "
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name\")
  .then(r => { console.log(r.rows.map(x => x.table_name)); p.end(); })
  .catch(e => { console.error(e.message); p.end(); })
"
```

### 5. Stop the proxy

```bash
kill %1
```

---

## Workflow for Schema Changes

1. Edit `functions/src/db/schema.ts`
2. Generate the migration file:
   ```bash
   cd functions && npx drizzle-kit generate
   ```
3. Review the generated SQL in `functions/drizzle/`
4. Follow steps 1–5 above, listing only the new file in `MIGRATIONS`
5. Commit both `schema.ts` and the migration SQL to git
6. Add a row to the "Applied Migrations" table in this file
