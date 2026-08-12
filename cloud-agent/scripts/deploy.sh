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
# corsOrigins() in src/index.ts denies all cross-origin browser access when
# CORS_ORIGIN is unset, and isAllowedWsOrigin() gates the WebSocket upgrades on
# the same list. The production web client is served from Firebase Hosting and
# calls this service cross-origin, so its origins must be allowlisted here or
# both /agent/run and the /agent/stream + /agent/live upgrades fail in the
# browser. Keep in sync with the Storage allowlist in cors.json at the repo root.
# The native mobile app is unaffected either way: it is not subject to CORS, and
# its synthesized WebSocket Origin matches this service's own origin.
CORS_ORIGIN="${CORS_ORIGIN:-https://clanker-ai.com,https://clanker-prod.web.app,https://clanker-prod.firebaseapp.com}"
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
  # The leading ^@^ sets @ as the pair delimiter instead of the default comma,
  # which CORS_ORIGIN's own value contains. Without it gcloud would split the
  # origin list into bogus env vars.
  --set-env-vars "^@^GOOGLE_GENAI_USE_VERTEXAI=true@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GOOGLE_CLOUD_LOCATION=${GEMINI_LOCATION}@CORS_ORIGIN=${CORS_ORIGIN}"
  # Explicitly pin required secrets so every deploy is self-contained.
  # --update-secrets adds/overwrites only these; other secrets (Cloud SQL x4) are preserved.
  # GEMINI_API_KEY was deleted from Secret Manager; remove its binding if still present.
  --update-secrets "SCHEDULER_SECRET=SCHEDULER_SECRET:latest"
  --remove-secrets "GEMINI_API_KEY"
)
if [[ "${ALLOW_UNAUTHENTICATED}" == "true" ]]; then
  DEPLOY_ARGS+=(--allow-unauthenticated)
else
  DEPLOY_ARGS+=(--no-allow-unauthenticated)
fi

gcloud run deploy "${SERVICE}" "${DEPLOY_ARGS[@]}"
