# Database Migrations

Covers both the production Cloud SQL flow and the local docker-compose Postgres flow, and how to record a new migration correctly in each.

## Architecture

- ORM: Drizzle ORM (TypeScript)
- Schema: `functions/src/db/schema.ts`
- Migration SQL files: `functions/drizzle/`
- Drizzle config: `functions/drizzle.config.ts`

There are two independent Postgres targets, each with its own migration runner:

| Target                        | Runner                                                                                | Tracking                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Production Cloud SQL          | `functions/scripts/migrate.mjs` (via `npm run migrate` / `npm run deploy:migrations`) | `schema_migrations` table (created automatically; baselined 2026-08-01) |
| Local docker-compose Postgres | `functions/scripts/migrate-dev.mjs` (via `npm run migrate:dev`)                       | `dev_migrations` table (dev-only, created automatically)                |

Both runners apply the same SQL files from `functions/drizzle/`, in the order declared by
`functions/scripts/migrationOrder.mjs` (`MIGRATION_ORDER`) — the single source of truth both
runners import.

Because applied files are now recorded, the production runner will:

- **skip** any migration already recorded as applied, so re-running a deploy is safe;
- **refuse** a migration whose predecessors in `MIGRATION_ORDER` are unapplied (override with `ALLOW_OUT_OF_ORDER=1`);
- **refuse** a file absent from `MIGRATION_ORDER` (override with `ALLOW_UNTRACKED=1`).

> **Important:** verify `CLOUD_SQL_CONNECTION_NAME` points to the intended instance before applying migrations.
>
> **Journal desync:** `functions/drizzle/meta/_journal.json` is stuck at `0011_credits_redesign`, but hand-written migration files `0012`–`0018`+ already exist on disk. **Do not run `npx drizzle-kit generate`** — it will assign a conflicting number/tag against the stale journal. See "Workflow for Schema Changes" below.

### Incident: unapplied `0001` broke all signups (2026-07-20 → 2026-08-01)

Production ran with **no** migration tracking until 2026-08-01; the "Applied Migrations" table
below was the only record, and it was wrong in both directions — it claimed `0001` had been
applied (it had not) and claimed `0014` had not (it had).

`0001_credit_transactions_idempotency.sql` creates the partial unique index
`credit_transactions_idempotency_idx`. It had never been applied to `clanker-prod`. This was
harmless until `0021` (commit `83884a3b`, 2026-07-20) rewrote `handle_new_user()` to guard its
signup grant with `ON CONFLICT (user_id, reason, reference_id) WHERE reference_id IS NOT NULL`,
which requires that index as its arbiter. From then on **every new signup** aborted with
Postgres `42P10` ("no unique or exclusion constraint matching the ON CONFLICT specification"),
rolling back the `users` insert and surfacing as a generic `exchangeToken` "Failed to bootstrap
user". Zero users were created for 12 days. Affected accounts exist in Firebase Auth with no
Cloud SQL row; they self-heal on next sign-in.

Fixed by applying `0001`, then introducing the `schema_migrations` table and the ordering guard
above so a migration can no longer be applied on top of missing predecessors.

---

## Production: Applied Migrations

**The `schema_migrations` table in production is now the source of truth**, not this table.
Query it directly rather than trusting the list below:

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY id;
```

This table is kept as a human-readable changelog of what each migration does. It is no longer
load-bearing, and was demonstrably unreliable while it was (see the incident note above).

| #       | File                                               | Notes                                                                                                                                   |
| ------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| initial | `0000_dazzling_kid_colt.sql`                       | Initial schema                                                                                                                          |
| 1       | `0001_credit_transactions_idempotency.sql`         | Idempotency index. **Not actually applied until 2026-08-01** despite this table long claiming otherwise — see incident note above       |
| 2       | `0002_users_timestamps_not_null.sql`               | NOT NULL constraints                                                                                                                    |
| 3       | `0003_character_voice.sql`                         | `characters.voice` (applied manually, not in Drizzle journal)                                                                           |
| 4       | `0004_wiki_memory.sql`                             | Wiki memory tables                                                                                                                      |
| 5       | `0004_lame_gwen_stacy.sql`                         | `source_hash`/`source_ref`, updated constraint                                                                                          |
| 6       | `0005_subscriptions_document_counter.sql`          | Document counter columns                                                                                                                |
| 7       | `0006_partial_source_hash_index.sql`               | Partial index                                                                                                                           |
| 8       | `0007_source_ref_idx.sql`                          | Index on source_ref                                                                                                                     |
| 9       | `0008_wiki_memory_v2.sql`                          | LLM wiki tables + `characters.save_to_cloud`                                                                                            |
| 10      | `0009_odd_sandman.sql`                             | LLM wiki columns                                                                                                                        |
| 11      | `0010_fix_source_type_check.sql`                   | Fix CHECK constraint                                                                                                                    |
| 12      | `0011_credits_redesign.sql`                        | Credit transactions redesign                                                                                                            |
| 13      | `0012_update_handle_new_user_trigger.sql`          | Update signup credit trigger                                                                                                            |
| 14      | `0013_cloud_agent_tasks.sql`                       | Cloud agent task tracking                                                                                                               |
| 15      | `0015_organizations.sql`                           | `organizations`/`organization_members` tables                                                                                           |
| 16      | `0016_llm_wiki_graph.sql`                          | `llm_wiki_edges`/`llm_wiki_ontology` tables                                                                                             |
| 17      | `0017_expo_push_token.sql`                         | `users.expo_push_token` column for Expo Push (bridge Phase 2)                                                                           |
| 18      | `0018_billing_hardening.sql`                       | `subscriptions.subscription_provider`/`cancel_at_period_end`, `processed_stripe_events` dedupe table, unique `stripe_customer_id` index |
| 19      | `0019_character_voice_default_fix.sql`             | Fix `characters.voice` default/backfill off stale `Umbriel` value                                                                       |
| 20      | `0020_credit_power_scale.sql`                      | Inflate `credit_transactions`/`subscriptions` credit balances ×100 for Power unit rename                                                |
| 21      | `0021_fix_handle_new_user_trigger_power_scale.sql` | Fix `handle_new_user()` trigger still hardcoding 50 (missed by 0020, which only updated existing rows) — new signups now get 5,000      |
| 22      | `0022_character_images.sql`                        | `character_images` table + `characters.active_image_id` for the image pipeline refactor (PR #580)                                       |
| 23      | `0023_character_images_chat.sql`                   | `character_images.message_id` for chat photo uploads (Phase 2 vision/chat-uploads)                                                      |
| 24      | `0024_credit_spend_events.sql`                     | Append-only `credit_spend_events` attribution ledger (issue #375; PR #623). Applied to prod 2026-08-22 with pre-backup                   |

`0014_pgvector_wiki_embeddings.sql` **is** applied to `clanker-prod` (a 2026-08-01 schema audit
confirmed the `vector` extension, `llm_wiki_entries.embedding`, and the HNSW index
`llm_wiki_entries_embedding_idx` all present). This document previously recorded it as an
unapplied gap; that was incorrect.

### Prerequisites

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "${GCP_PROJECT}"
```

### Apply Migrations (production)

1. Set project: `export GCP_PROJECT="your-project-id"`
2. Apply: `cd functions && MIGRATIONS="0019_my_new_migration.sql" npm run deploy:migrations`

`deploy:migrations` (`functions/scripts/deploy-migrations.sh`) fetches the four `CLOUD_SQL_*` secrets from Secret Manager, triggers an on-demand native Cloud SQL backup (`functions/scripts/backup-db.sh`, `gcloud sql backups create`) as a pre-migration safeguard, then runs `functions/scripts/migrate.mjs`. Both scripts are checked into the repo so they resolve `@google-cloud/cloud-sql-connector`/`pg` from `functions/node_modules` — do not copy `migrate.mjs` to `/tmp` or elsewhere outside `functions/`, that breaks module resolution.

The backup step can be skipped with `SKIP_BACKUP=true npm run deploy:migrations`, or triggered standalone via `npm run backup:db`. It runs entirely inside Google's infrastructure (no data leaves the cloud boundary, no local bandwidth used) — deliberately not a `pg_dump`-to-laptop approach, which would pull production user data onto local hardware unnecessarily.

To fetch secrets manually instead (e.g. for one-off inspection) or run `migrate.mjs` directly without the wrapper:

```bash
export CLOUD_SQL_CONNECTION_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_CONNECTION_NAME --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_USER=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_USER --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project="${GCP_PROJECT}")
export CLOUD_SQL_DB_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_NAME --project="${GCP_PROJECT}")
cd functions && MIGRATIONS="0019_my_new_migration.sql" npm run migrate
```

---

## Local Dev: docker-compose Postgres

`docker-compose.local.yml` runs a `pgvector/pgvector:pg18` container (`postgres_db`) for the `cloud-agent` service, with `DATABASE_URL=postgres://clanker_dev:local_pass@postgres_db:5432/clanker`. A fresh or wiped volume has **no schema and no seed data** — the cloud-agent's mock-auth flow (`MOCK_FIREBASE_AUTH=true`, uid `local_test_user_123`) will fail with `relation "users" does not exist` or later `"User not found"` until both of the following are run.

> **Keep the major version matched to production** (Cloud SQL `POSTGRES_18`). Local ran `pg15` until 2026-08-01 — two majors behind — so local testing did not faithfully represent prod. Changing the major is not an in-place upgrade; Postgres will refuse to start on a data directory written by an older major. Recreate it:
>
> ```bash
> docker compose -f docker-compose.local.yml rm -sfv postgres_db
> docker compose -f docker-compose.local.yml up -d postgres_db
> cd functions && npm run migrate:dev   # then re-seed, step 2 below
> ```

### 1. Apply schema

```bash
cd functions && npm run migrate:dev
```

This runs `functions/scripts/migrate-dev.mjs` against `postgres://clanker_dev:local_pass@localhost:5432/clanker` (override with `DATABASE_URL`). Unlike production, it tracks applied files in a dev-only `dev_migrations` table, so it's safe to re-run — only pending files are applied.

Useful flags:

- `MIGRATIONS=0016_llm_wiki_graph.sql npm run migrate:dev` — apply one specific file
- `STAMP_MIGRATIONS=0014_pgvector_wiki_embeddings.sql npm run migrate:dev` — mark migrations through a file as applied without running their SQL (e.g. to baseline a DB that `cloud-agent/scripts/seedLocal.ts` already brought partway up to date)

The script refuses to run against a non-localhost `DATABASE_URL` unless `FORCE_MIGRATE_DEV=1` is set — it's a safety rail against pointing dev tooling at production by accident.

### 2. Seed the dev user/character

```bash
docker compose -f docker-compose.local.yml exec cloud-agent npx tsx scripts/seedLocal.ts
```

`cloud-agent/scripts/seedLocal.ts` creates a deterministic test user (`firebase_uid = 'local_test_user_123'`, `id = 11111111-1111-4111-8111-111111111111`) and test character matching the mocked `verifyToken` uid, plus a mock wiki entry. Without this, mock-authenticated requests resolve a uid that has no matching `users` row.

> The cloud-agent's generic dev error message ("Expired Vertex AI credentials are a common cause...") fires on _any_ `agent/run` 500, including missing-schema or missing-seed errors — it is not necessarily a credentials problem. Check `docker compose -f docker-compose.local.yml logs cloud-agent` for the actual Postgres error (e.g. `relation "users" does not exist`, code `42P01`) before assuming ADC/Vertex is the cause.

---

## Workflow for Schema Changes (how to record a new migration)

1. Edit `functions/src/db/schema.ts` to reflect the desired end state.
2. **Do not run `npx drizzle-kit generate`** — the journal (`functions/drizzle/meta/_journal.json`) is stuck at `0011` while on-disk files go past `0018`; generating would produce a conflicting index against the stale journal.
3. Hand-write the migration SQL as a new file at the next sequential index, e.g. `functions/drizzle/0019_my_change.sql`, matching the style of existing migrations (`CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` for FKs, explicit `CREATE INDEX`).
4. Add the new filename to `MIGRATION_ORDER` in `functions/scripts/migrationOrder.mjs` — both runners import it, and both refuse to apply a file that is not listed. Keep it in the order it must run.
5. Add a row to the "Applied Migrations" table above as a changelog entry (`schema_migrations` in production is the actual record).
6. Apply locally first (`cd functions && npm run migrate:dev`) to sanity-check the SQL against a real Postgres instance.
7. Apply to production following "Apply Migrations (production)" above.
8. Commit `schema.ts`, the new migration SQL file, the `MIGRATION_ORDER` update, and the "Applied Migrations" table update together in one PR.

If a migration depends on an object created by an earlier one (an index backing an
`ON CONFLICT`, a column, a constraint), the ordering guard in step 4 is what enforces it — but
state the dependency in a SQL comment too, as `0021` does.

Do **not** update `_journal.json` or add Drizzle snapshot files as part of routine schema changes — that's a deliberate, separate re-sync operation, not part of normal migration authoring.
