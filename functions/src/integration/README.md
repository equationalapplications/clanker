# Payment webhook integration suite

Drives the real `stripeWebhookHandler` / `revenueCatWebhookHandler` cores over
genuine HTTP (genuinely-signed payloads) against a real local Postgres DB
named `clanker_test`. Fully offline: the Stripe REST client and the GA4
senders are the only fakes.

## Prerequisites

1. Docker Postgres from the repo root:

   ```sh
   docker compose -f docker-compose.local.yml up -d postgres_db
   ```

2. Point DATABASE_URL at the sibling TEST database (the suite creates and
   migrates it; it refuses to operate on the dev `clanker` db):

   ```sh
   export DATABASE_URL='postgres://clanker_dev:local_pass@localhost:5432/clanker_test'
   ```

## Run

```sh
npm --prefix functions run test:integration
```

Notes:

- Do NOT set NODE_ENV=test for this suite (cloudSql's test guard throws).
- Files run sequentially (--test-concurrency=1) because both truncate the
  same tables between tests.
- Dev `clanker` data is never touched; a hard name guard aborts otherwise.
