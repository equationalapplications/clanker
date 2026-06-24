#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT must be set (export GCP_PROJECT=your-project-id)" >&2
  exit 1
fi

if [[ -z "${CLOUD_SQL_CONNECTION_NAME:-}" ]]; then
  CLOUD_SQL_CONNECTION_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_CONNECTION_NAME --project="${GCP_PROJECT}")
fi

# CLOUD_SQL_CONNECTION_NAME is "project:region:instance" — backups create takes the instance name only.
INSTANCE_NAME="${CLOUD_SQL_CONNECTION_NAME##*:}"

echo "Triggering on-demand backup of Cloud SQL instance ${INSTANCE_NAME} (project ${GCP_PROJECT})..."
gcloud sql backups create \
  --instance="${INSTANCE_NAME}" \
  --project="${GCP_PROJECT}" \
  --description="pre-deploy backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Backup complete."
