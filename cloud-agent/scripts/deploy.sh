#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-clanker-prod}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-clanker-cloud-agent}"
IMAGE="gcr.io/${PROJECT_ID}/clanker-cloud-agent"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

echo "Building and pushing ${IMAGE}..."
gcloud builds submit --project "${PROJECT_ID}" --config cloudbuild.yaml .

echo "Deploying ${SERVICE} to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --allow-unauthenticated
