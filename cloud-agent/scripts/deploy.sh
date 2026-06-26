#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "Error: GCP_PROJECT must be set (export GCP_PROJECT=your-project-id)" >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-clanker-cloud-agent}"
# Gemini 3 family is currently global-only on Vertex AI (no us-central1
# regional serving yet). GEMINI_LOCATION governs the Vertex AI model calls
# made by the agent, independent of REGION above (the Cloud Run service's
# own deploy region).
GEMINI_LOCATION="${GOOGLE_CLOUD_LOCATION:-global}"
# cloudbuild.yaml currently builds/pushes gcr.io/$PROJECT_ID/clanker-cloud-agent
IMAGE="gcr.io/${PROJECT_ID}/clanker-cloud-agent"
# Public by default: the app does its own Firebase-token auth (see
# requireAuth/CORS comments in src/index.ts) and the browser calls this
# service directly, so Cloud Run's invoker IAM must allow unauthenticated
# access. Set ALLOW_UNAUTHENTICATED=false only for a deliberately private deploy.
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
  --memory 512Mi
  --timeout 540
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${GEMINI_LOCATION}"
  # GEMINI_API_KEY secret was deleted (embeddings.ts migrated to Vertex AI ADC);
  # remove the dangling secret-backed env var carried forward from prior revisions.
  --remove-secrets "GEMINI_API_KEY"
)
if [[ "${ALLOW_UNAUTHENTICATED}" == "true" ]]; then
  DEPLOY_ARGS+=(--allow-unauthenticated)
else
  DEPLOY_ARGS+=(--no-allow-unauthenticated)
fi

gcloud run deploy "${SERVICE}" "${DEPLOY_ARGS[@]}"
