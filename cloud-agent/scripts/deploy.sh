#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT must be set (export GCP_PROJECT=your-project-id)" >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-clanker-cloud-agent}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

echo "Building and pushing ${IMAGE}..."
gcloud builds submit --project "${PROJECT_ID}" --config cloudbuild.yaml .

echo "Deploying ${SERVICE} to Cloud Run (${REGION})..."
DEPLOY_ARGS=(
  --project "${PROJECT_ID}"
  --image "${IMAGE}"
  --region "${REGION}"
)
if [[ "${ALLOW_UNAUTHENTICATED}" == "true" ]]; then
  DEPLOY_ARGS+=(--allow-unauthenticated)
else
  DEPLOY_ARGS+=(--no-allow-unauthenticated)
fi

gcloud run deploy "${SERVICE}" "${DEPLOY_ARGS[@]}"
