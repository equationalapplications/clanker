# Firebase Cloud Functions

This document outlines the architecture and management of Firebase Cloud Functions within the `clanker` repository.

## Overview

`clanker` utilizes several backend services implemented as Firebase Cloud Functions. These functions are deployed to the dedicated `clanker-prod` Firebase project.

`exchangeToken` now performs Cloud SQL bootstrap directly.

The source code for these functions is located in the `/functions` directory at the root of this repository.

## Codebase Configuration

`clanker` uses the Firebase `codebase` feature in `firebase.json` so targeted deploy filters remain stable and explicit.

**`firebase.json`:**
```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "clanker",
      "ignore": ["..."],
      "predeploy": ["..."]
    }
  ]
}
```

By setting `"codebase": "clanker"`, deploy commands can reliably target this app's functions with `functions:clanker:<name>` filters.

## Core Functions

### `exchangeToken`

- **Purpose**: Bootstraps a Firebase user in Cloud SQL and returns app user + subscription state.
- **Process**:
  1. Verifies the user's Firebase Auth ID token.
  2. Finds or creates the corresponding Cloud SQL user.
  3. Finds or initializes the user's Cloud SQL subscription row.
  4. Returns bootstrap payload `{ user, subscription }`.

### `generateReply`

- **Purpose**: Generates chat/introduction text replies server-side using Vertex AI with enforced auth and billing.
- **Process**:
    1. Verifies callable auth context and token integrity.
    2. Resolves Cloud SQL user from authenticated Firebase identity.
    3. Reads active subscription row from Cloud SQL `subscriptions` table.
    4. Authorizes access (unlimited tiers or available credits).
    5. Calls Vertex AI to generate the reply.
    6. Spends one credit only for non-unlimited plans, and only after successful generation.
- **Security**:
  - Enforces App Check.
  - Keeps AI invocation server-side to prevent direct client bypass.
- **IAM requirement**:
  - The Cloud Run runtime service account for `generatereply` must have project role `roles/aiplatform.user`.
  - Missing this role causes Vertex AI calls to fail with `PERMISSION_DENIED` on `aiplatform.endpoints.predict` for model resources such as `publishers/google/models/gemini-2.5-flash`.
- **Reference**: See [Chat response function deep-dive](./CHAT_RESPONSE_FUNCTION.md).

### `generateImage`

- **Purpose**: Generates character avatar images server-side with enforced auth, App Check, throttling, and billing.
- **Process**:
    1. Verifies callable auth context and token integrity.
    2. Resolves Cloud SQL user from Firebase identity.
    3. Reads active subscription row and validates access (unlimited tiers or available credits).
    4. Applies prompt validation + per-user throttling guard.
    5. Calls Vertex AI image model (`gemini-2.5-flash-image`) and extracts inline base64 image data.
    6. Spends one credit only for non-unlimited plans and only after successful generation.
    7. Returns `{ imageBase64, mimeType, creditsSpent, remainingCredits, planTier }`.
- **Security**:
  - Enforces App Check.
  - Keeps image model access server-side (client has no direct GenAI SDK access).
- **IAM requirement**:
  - The Cloud Run runtime service account for `generateimage` must have project role `roles/aiplatform.user`.

- **Reference**: See [Image generation function deep-dive](./IMAGE_GENERATION_FUNCTION.md).

### `summarizeText`

- **Purpose**: Summarizes chat memory text server-side for local SQLite context compaction.
- **Process**:
    1. Verifies callable auth context and token integrity.
    2. Validates summarization input (`text`, `maxCharacters`).
    3. Calls Vertex AI text model and returns bounded summary output.
- **Security**:
  - Enforces App Check.
  - Keeps model invocation server-side.
- **Billing**:
  - Does not spend user credits.

### `purchasePackageStripe`

- **Purpose**: Creates a Stripe Checkout session for purchasing subscriptions or one-time packages.
- **Process**:
    1. Verifies the user is authenticated.
    2. Validates the requested `priceId`.
    3. Finds or creates a Stripe Customer record for the user's email.
    4. Creates and returns a Stripe Checkout session URL.
- **Security**: This function is protected by App Check to ensure requests come from a valid `clanker` client application.
- **Config Guards**:
  - Fails fast with `failed-precondition` when any required Stripe config is missing (`STRIPE_MONTHLY_20_PRICE_ID`, `STRIPE_MONTHLY_50_PRICE_ID`, `STRIPE_CREDIT_PACK_PRICE_ID`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`).
  - Validates `STRIPE_SECRET_KEY` format before calling Stripe and rejects non-printable characters (prevents invalid Authorization header errors caused by malformed secret values).

## Environment Configuration

The functions require environment variables for Cloud SQL and Stripe. These are documented in `functions/.env.example`. For local development, you can create a `.env` file in the `functions` directory. For production, these are configured securely in Google Cloud.

### Secrets vs params policy

`clanker` keeps credentials in Firebase Secret Manager and uses Firebase params/env config for non-sensitive values.

- Keep in Secret Manager:
  - `CLOUD_SQL_CONNECTION_NAME`
  - `CLOUD_SQL_DB_USER`
  - `CLOUD_SQL_DB_PASS`
  - `CLOUD_SQL_DB_NAME`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `REVENUECAT_WEBHOOK_SECRET`
- Use params/env config (non-sensitive):
  - `STRIPE_MONTHLY_20_PRICE_ID`
  - `STRIPE_MONTHLY_50_PRICE_ID`
  - `STRIPE_CREDIT_PACK_PRICE_ID`
  - `STRIPE_SUCCESS_URL`
  - `STRIPE_CANCEL_URL`

These values are read through `functions/src/runtimeConfig.ts` (via `defineString(...)` params with
environment-variable fallback).

Set non-sensitive values via env config for local/dev and let deploy prompt for param values in production:

```bash
# local functions development
cp functions/.env.example functions/.env
```

For deployment, `defineString(...)` params are resolved by Firebase CLI during deploy. If missing, the CLI prompts for values and persists them for the project.

Current Clanker production checkout URL params:

- `STRIPE_SUCCESS_URL=https://clanker-ai.com/checkout/success`
- `STRIPE_CANCEL_URL=https://clanker-ai.com/checkout/cancel`

Note: checkout URL values are required. The function does not fall back to hard-coded production URLs when they are missing.

## Runbook: New Environment Onboarding

Use this checklist when setting up Firebase Functions for a new environment.

### Local development

- [ ] Copy `functions/.env.example` to `functions/.env`.
- [ ] Fill local runtime values in `functions/.env` (includes sensitive Cloud SQL values; do not commit):
  - `CLOUD_SQL_CONNECTION_NAME`
  - `CLOUD_SQL_DB_USER`
  - `CLOUD_SQL_DB_PASS`
  - `CLOUD_SQL_DB_NAME`
  - `STRIPE_MONTHLY_20_PRICE_ID`
  - `STRIPE_MONTHLY_50_PRICE_ID`
  - `STRIPE_CREDIT_PACK_PRICE_ID`
  - `STRIPE_SUCCESS_URL`
  - `STRIPE_CANCEL_URL`
- [ ] Ensure sensitive values exist in Firebase Secret Manager for the target project:
  - `CLOUD_SQL_CONNECTION_NAME`
  - `CLOUD_SQL_DB_USER`
  - `CLOUD_SQL_DB_PASS`
  - `CLOUD_SQL_DB_NAME`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `REVENUECAT_WEBHOOK_SECRET`
- [ ] Validate locally from `functions/`:
  - `npm run lint`
  - `npm run build`

### Staging

- [ ] Confirm active project: `firebase use <staging-project-id-or-alias>`.
- [ ] Verify secrets are present in staging:
  - `firebase functions:secrets:get CLOUD_SQL_CONNECTION_NAME`
  - `firebase functions:secrets:get CLOUD_SQL_DB_USER`
  - `firebase functions:secrets:get CLOUD_SQL_DB_PASS`
  - `firebase functions:secrets:get CLOUD_SQL_DB_NAME`
  - `firebase functions:secrets:get STRIPE_SECRET_KEY`
  - `firebase functions:secrets:get STRIPE_WEBHOOK_SECRET`
  - `firebase functions:secrets:get REVENUECAT_WEBHOOK_SECRET`
- [ ] Deploy from `functions/`: `npm run deploy`.
- [ ] If prompted, enter missing non-sensitive param values once (CLI persists them for the staging project).
- [ ] Smoke test:
  - callable: `exchangeToken`, `generateReply`, `generateImage`, `summarizeText`, `spendCredits`, `purchasePackageStripe`
  - webhooks: `stripeWebhook`, `revenueCatWebhook`

### Production

- [ ] Confirm active project: `firebase use <prod-project-id-or-alias>`.
- [ ] Re-check production secrets (same commands as staging).
- [ ] Deploy from `functions/`: `npm run deploy`.
- [ ] If prompted, enter missing non-sensitive param values once for production.
  - `STRIPE_SUCCESS_URL`: `https://clanker-ai.com/checkout/success`
  - `STRIPE_CANCEL_URL`: `https://clanker-ai.com/checkout/cancel`
- [ ] Verify deploy output shows all functions updated successfully.
- [ ] Run post-deploy validation:
  - auth flow (`exchangeToken`) works end-to-end
  - image callable (`generateImage`) returns base64 payload for authorized user
  - Stripe checkout callable returns a valid URL
  - Stripe/RevenueCat webhook deliveries return 2xx
  - `functions:log` shows no startup config errors

## Runbook: Rotate Stripe Secret

Use this when rotating `STRIPE_SECRET_KEY`.

1. Set the new secret version:
  - `printf '%s' '<new-sk-live-or-sk-test-value>' | firebase functions:secrets:set STRIPE_SECRET_KEY --project clanker-prod`
2. Verify versions:
  - `firebase functions:secrets:get STRIPE_SECRET_KEY --project clanker-prod`
3. Redeploy Stripe-dependent functions so they pick up the new secret version:
  - `firebase deploy --only functions:clanker:purchasePackageStripe,functions:clanker:stripeWebhook --project clanker-prod`
4. (Optional) Disable old versions after validation:
  - `firebase functions:secrets:destroy STRIPE_SECRET_KEY@<old-version> --project clanker-prod`

Important:
- In this repo, targeted deploy filters must include the codebase prefix (`functions:clanker:<name>`), otherwise Firebase can report "No function matches given --only filters".

## Deployment

To deploy the functions, navigate to the `functions` directory and use the `deploy` script:

```bash
cd functions
npm run deploy
```

This script is defined in `functions/package.json` and is configured to deploy to the `clanker-prod` project.

```json
"scripts": {
  "deploy": "firebase deploy --only functions -P clanker-prod"
}
```

## Post-Deployment: The `allUsersIngress` Tag

Due to a strict Google Cloud Organization policy ("Domain Restricted Sharing"), Cloud Run services (which power Firebase Gen 2 functions) are blocked from being publicly accessible by default. However, Firebase `onCall` functions and webhooks *must* be accessible by `allUsers` at the infrastructure layer so that the SDKs and external services can reach them.

To resolve this, an organization policy exception is configured using custom tag `1035311523842/allUsersIngress/True`.

When you deploy a **new** Firebase function, the Firebase CLI will log a warning that it failed to set the invoker permissions, and the deployed function will be inaccessible (returning `403 Forbidden` errors). You must manually attach this tag to the underlying Cloud Run service and grant the invoker role.

### Reference values

| Value | Description |
|---|---|
| **Project ID** | `clanker-prod` |
| **Project Number** | `54051268985` |
| **Region** | `us-central1` |
| **Org ID** | `1035311523842` |
| **Tag** | `1035311523842/allUsersIngress/True` |

### Tagged services

All callable and webhook Cloud Run services must have the tag. Current list:

- `exchangetoken`
- `generatereply`
- `generateimage`
- `summarizetext`
- `purchasepackagestripe`
- `spendcredits`
- `stripewebhook`
- `revenuecatwebhook`
- `adminlistusers`
- `adminsetusercredits`
- `adminsetusersubscription`
- `admincleartermsacceptance`
- `adminresetuserstate`
- `admindeleteuser`
- `deletemyaccount`

### Commands

Replace `FUNCTION_NAME` with the lowercase Cloud Run service name (e.g. `adminlistusers`).
Set these shell variables first, then run commands as-is:

```bash
PROJECT_ID="clanker-prod"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
REGION="us-central1"
TAG_VALUE="1035311523842/allUsersIngress/True"
```

Use these discovery commands before running tag or IAM updates in non-production environments:

```bash
gcloud config get-value project
gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)'
gcloud run services list --platform=managed --format='table(metadata.name,metadata.labels.location)'
```

```bash
# 1. Attach the tag to bypass the organization policy
gcloud resource-manager tags bindings create \
  --tag-value="$TAG_VALUE" \
  --parent="//run.googleapis.com/projects/$PROJECT_NUMBER/locations/$REGION/services/FUNCTION_NAME" \
  --location="$REGION"

# 2. Wait ~15 seconds, then grant public invocation access
gcloud run services add-iam-policy-binding FUNCTION_NAME \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

To tag and grant access to **all services at once**:

```bash
for fn in exchangetoken generatereply generateimage summarizetext purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser deletemyaccount; do
  echo "=== $fn ==="
  gcloud resource-manager tags bindings create \
    --tag-value="$TAG_VALUE" \
    --parent="//run.googleapis.com/projects/$PROJECT_NUMBER/locations/$REGION/services/$fn" \
    --location="$REGION"
done

# Wait ~15 seconds for tag propagation, then:

for fn in exchangetoken generatereply generateimage summarizetext purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser deletemyaccount; do
  echo "=== $fn ==="
  gcloud run services add-iam-policy-binding "$fn" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member="allUsers" \
    --role="roles/run.invoker"
done
```

To **verify** which services have the tag:

```bash
for fn in exchangetoken generatereply generateimage summarizetext purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser deletemyaccount; do
  echo "=== $fn ==="
  gcloud resource-manager tags bindings list \
    --parent="//run.googleapis.com/projects/$PROJECT_NUMBER/locations/$REGION/services/$fn" \
    --location="$REGION" 2>&1
done
```

*(Note: You may need to wait 10-15 seconds between attaching the tag and granting the IAM role for the policy exception to propagate. Services that already have the tag will return an ALREADY_EXISTS error — this is safe to ignore.)*

### Troubleshooting: Tag Present But `allUsers` Still Blocked

If `gcloud run services add-iam-policy-binding ... --member="allUsers" --role="roles/run.invoker"` fails with:

- `FAILED_PRECONDITION: One or more users named in the policy do not belong to a permitted customer`

then the tag is attached, but the effective organization policy exception is not active for this project/resource path.

Use this quick verification flow:

```bash
PROJECT_ID="clanker-prod"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
REGION="us-central1"

# 1) Confirm tag exists on service
gcloud resource-manager tags bindings list \
  --parent="//run.googleapis.com/projects/$PROJECT_NUMBER/locations/$REGION/services/stripewebhook" \
  --location="$REGION"

# 2) Inspect effective domain-restriction org policy
gcloud org-policies describe constraints/iam.allowedPolicyMemberDomains \
  --effective \
  --project="$PROJECT_ID" \
  --format=json

# 3) Retry invoker grant (enforcement test)
gcloud run services add-iam-policy-binding stripewebhook \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Interpretation:

- If step 1 shows `1035311523842/allUsersIngress/True` but step 3 still fails, org policy exception rule is missing/mis-scoped.
- If step 3 succeeds, verify policy includes `allUsers` under `roles/run.invoker`.

Escalation payload for org admin:

- Project: `clanker-prod` (`54051268985`)
- Services: `stripewebhook`, `revenuecatwebhook`
- Tag attached: `1035311523842/allUsersIngress/True`
- Failing command: `gcloud run services add-iam-policy-binding <service> --member="allUsers" --role="roles/run.invoker"`
- Required fix: ensure effective `constraints/iam.allowedPolicyMemberDomains` policy includes conditional exception for tagged Cloud Run services.
