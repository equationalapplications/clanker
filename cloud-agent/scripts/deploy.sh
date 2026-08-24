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

# TRAFFIC_CHECK_ATTEMPTS governs the post-deploy traffic assertion below.
# Validate it BEFORE building/deploying: under `set -e` a bad value would
# otherwise abort the script only when that check runs — after a successful
# deploy — reporting a healthy deploy as failed. Reject anything that is not a
# positive integer (a zero would silently disable the retry loop). Gated on the
# same escape hatches as the assertion itself: SKIP_TRAFFIC_CHECK=true and
# --no-traffic deploys never read this value, so aborting them here would block
# deliberate holds/emergency deploys over a variable they don't consume.
if [[ "${SKIP_TRAFFIC_CHECK:-}" != "true" ]] \
    && ! printf '%s\n' "${DEPLOY_ARGS[@]}" | grep -qx -- '--no-traffic'; then
  _TRAFFIC_CHECK_ATTEMPTS="${TRAFFIC_CHECK_ATTEMPTS:-6}"
  if ! [[ "${_TRAFFIC_CHECK_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: TRAFFIC_CHECK_ATTEMPTS must be a positive integer (got '${_TRAFFIC_CHECK_ATTEMPTS}')." >&2
    exit 1
  fi
fi

echo "Building and pushing ${IMAGE}..."
gcloud builds submit --project "${PROJECT_ID}" --config cloudbuild.yaml .

echo "Deploying ${SERVICE} to Cloud Run (${REGION})..."

# Remember what the newest revision was BEFORE deploying, so the traffic
# check below can report whether this deploy created a revision at all (a
# redeploy of unchanged config reuses the existing revision). Guarded
# because the service may not exist yet on a first-ever deploy.
PREV_LATEST_REVISION="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"

gcloud run deploy "${SERVICE}" "${DEPLOY_ARGS[@]}"

# --- Post-deploy traffic assertion -------------------------------------------
# gcloud run deploy exits 0 even when it leaves the brand-new revision at 0%
# traffic, which happens whenever the service's split is pinned to an older
# revision (any manual `update-traffic` pins it permanently until promoted).
# The Aug 11–14 prod deploys sat unserved for days exactly this way. Assert the
# revision we just deployed actually receives traffic before declaring success.
# This NEVER shifts traffic on failure — promotion is an operator decision
# (the promote/rollback commands are printed below).
#
# Escape hatches:
#   SKIP_TRAFFIC_CHECK=true        skip the check entirely (deliberate holds)
#   --no-traffic in DEPLOY_ARGS    detected below and skips automatically
# ">0%" counts as pass, so a partial canary split (e.g. 10%) still passes.
if [[ "${SKIP_TRAFFIC_CHECK:-}" == "true" ]]; then
  echo "SKIP_TRAFFIC_CHECK=true set, skipping post-deploy traffic check."
elif printf '%s\n' "${DEPLOY_ARGS[@]}" | grep -qx -- '--no-traffic'; then
  echo "--no-traffic deploy requested, skipping post-deploy traffic check."
else
  TARGET_REVISION="$(gcloud run services describe "${SERVICE}" \
    --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"
  if [[ -z "${TARGET_REVISION}" ]]; then
    echo "Error: could not read latestCreatedRevisionName after deploy; refusing to trust 'done.'" >&2
    exit 1
  fi
  if [[ "${TARGET_REVISION}" == "${PREV_LATEST_REVISION:-}" ]]; then
    echo "No new revision created (unchanged config); verifying ${TARGET_REVISION}."
  else
    echo "New revision ${TARGET_REVISION}; verifying it receives traffic..."
  fi

  TRAFFIC_PERCENT=""
  # Traffic application is normally immediate once deploy returns; retries only
  # absorb API/eventual-consistency lag. Each row is "<revision>,<percent>"; a
  # revision can appear twice (split + tagged route), so take its largest share.
  for _attempt in $(seq 1 "${_TRAFFIC_CHECK_ATTEMPTS}"); do
    TRAFFIC_ROWS="$(gcloud run services describe "${SERVICE}" \
      --project "${PROJECT_ID}" --region "${REGION}" \
      --format='csv[no-heading](status.traffic.revisionName,status.traffic.percent)' 2>/dev/null || true)"
    TRAFFIC_PERCENT="$(awk -F',' -v rev="${TARGET_REVISION}" \
      '$1 == rev { if ($2 + 0 > best + 0) best = $2 } END { print best }' <<<"${TRAFFIC_ROWS}")"
    PCT="${TRAFFIC_PERCENT:-0}"; PCT="${PCT%%.*}"
    if (( PCT > 0 )); then
      break
    fi
    # Don't sleep after the final iteration — would just waste time before
    # the error block prints.
    if (( _attempt < _TRAFFIC_CHECK_ATTEMPTS )); then
      sleep 5
    fi
  done

  PCT="${TRAFFIC_PERCENT:-0}"; PCT="${PCT%%.*}"
  if (( PCT > 0 )); then
    echo "Traffic verified: ${TARGET_REVISION} serving ${PCT}% (${PREV_LATEST_REVISION:-none} -> ${TARGET_REVISION})."
  else
    {
      echo ""
      echo "ERROR: deploy finished but ${TARGET_REVISION} is receiving 0% traffic."
      echo "The revision is healthy but unserved; traffic stayed pinned as below:"
      gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
        --format='table(status.traffic.revisionName,status.traffic.percent,status.traffic.tag)' >&2 || true
      echo ""
      echo "New revision status:"
      gcloud run revisions describe "${TARGET_REVISION}" --project "${PROJECT_ID}" --region "${REGION}" >&2 || true
      echo ""
      echo "Nothing was shifted automatically. To promote (when you choose to):"
      echo "  gcloud run services update-traffic ${SERVICE} --to-latest --project ${PROJECT_ID} --region ${REGION}"
      echo "To pin a specific revision instead:"
      echo "  gcloud run services update-traffic ${SERVICE} --to-revisions <REVISION>=100 --project ${PROJECT_ID} --region ${REGION}"
      echo "(Re-run with SKIP_TRAFFIC_CHECK=true to bypass this assertion.)"
    } >&2
    exit 1
  fi
fi
