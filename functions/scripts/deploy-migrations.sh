#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT must be set (export GCP_PROJECT=your-project-id)" >&2
  exit 1
fi

if [[ -z "${MIGRATIONS:-}" ]]; then
  echo "Error: MIGRATIONS must be set (comma-separated filenames in functions/drizzle/, e.g. MIGRATIONS=\"0017_my_new_migration.sql\")" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "Fetching Cloud SQL secrets for project ${GCP_PROJECT}..."
CLOUD_SQL_CONNECTION_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_CONNECTION_NAME --project="${GCP_PROJECT}")
CLOUD_SQL_DB_USER=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_USER --project="${GCP_PROJECT}")
CLOUD_SQL_DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project="${GCP_PROJECT}")
CLOUD_SQL_DB_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_NAME --project="${GCP_PROJECT}")
export CLOUD_SQL_CONNECTION_NAME CLOUD_SQL_DB_USER CLOUD_SQL_DB_PASS CLOUD_SQL_DB_NAME

if [[ "${SKIP_BACKUP:-}" != "true" ]]; then
  bash "${REPO_ROOT}/scripts/backup-db.sh"
else
  echo "SKIP_BACKUP=true set, skipping pre-migration backup."
fi

echo "Applying migrations: ${MIGRATIONS}"
node scripts/migrate.mjs
