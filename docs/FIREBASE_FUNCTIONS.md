# Firebase Cloud Functions

This document outlines the architecture and management of Firebase Cloud Functions within the `clanker` repository.

## Overview

`clanker` utilizes several backend services implemented as Firebase Cloud Functions. These functions are deployed to the shared `equationalapplications-com` Firebase project, which also serves other applications from Equational Applications.

The source code for these functions is located in the `/functions` directory at the root of this repository. This is a copy of the original functions from the private `account` repository, and may be customized for `clanker`'s specific needs over time.

## Multi-Codebase Deployment

To prevent conflicts with functions from other repositories deploying to the same Firebase project, `clanker` uses the `codebase` feature in `firebase.json`.

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

By setting `"codebase": "clanker"`, the Firebase CLI knows to only manage functions associated with this codebase. It will not delete or interfere with functions deployed from the `account` repository or any other app.

## Core Functions

### `exchangeToken`

- **Purpose**: Authenticates a Firebase user with the shared Supabase backend.
- **Process**:
    1. Verifies the user's Firebase Auth ID token.
    2. Finds the corresponding user in Supabase by email.
    3. If the user doesn't exist, it creates a new Supabase user.
    4. Generates and returns a valid Supabase session (access and refresh tokens).

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

The functions require several environment variables to connect to Supabase and Stripe. These are documented in `functions/.env.example`. For local development, you can create a `.env` file in the `functions` directory. For production, these are configured securely in the Google Cloud environment.

### Secrets vs params policy

`clanker` now keeps only true secrets in Firebase Secret Manager and uses Firebase params/env config for non-sensitive values.

- Keep in Secret Manager:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `REVENUECAT_WEBHOOK_SECRET`
- Use params/env config (non-sensitive):
  - `SUPABASE_URL`
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
- [ ] Fill non-sensitive values in `functions/.env`:
  - `SUPABASE_URL`
  - `STRIPE_MONTHLY_20_PRICE_ID`
  - `STRIPE_MONTHLY_50_PRICE_ID`
  - `STRIPE_CREDIT_PACK_PRICE_ID`
  - `STRIPE_SUCCESS_URL`
  - `STRIPE_CANCEL_URL`
- [ ] Ensure sensitive values exist in Firebase Secret Manager for the target project:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `REVENUECAT_WEBHOOK_SECRET`
- [ ] Validate locally from `functions/`:
  - `npm run lint`
  - `npm run build`

### Staging

- [ ] Confirm active project: `firebase use <staging-project-id-or-alias>`.
- [ ] Verify secrets are present in staging:
  - `firebase functions:secrets:get SUPABASE_SERVICE_ROLE_KEY`
  - `firebase functions:secrets:get STRIPE_SECRET_KEY`
  - `firebase functions:secrets:get STRIPE_WEBHOOK_SECRET`
  - `firebase functions:secrets:get REVENUECAT_WEBHOOK_SECRET`
- [ ] Deploy from `functions/`: `npm run deploy`.
- [ ] If prompted, enter missing non-sensitive param values once (CLI persists them for the staging project).
- [ ] Smoke test:
  - callable: `exchangeToken`, `spendCredits`, `purchasePackageStripe`
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
  - Stripe checkout callable returns a valid URL
  - Stripe/RevenueCat webhook deliveries return 2xx
  - `functions:log` shows no startup config errors

## Runbook: Rotate Stripe Secret

Use this when rotating `STRIPE_SECRET_KEY`.

1. Set the new secret version:
   - `printf '%s' '<new-sk-live-or-sk-test-value>' | firebase functions:secrets:set STRIPE_SECRET_KEY --project equationalapplications-com`
2. Verify versions:
   - `firebase functions:secrets:get STRIPE_SECRET_KEY --project equationalapplications-com`
3. Redeploy Stripe-dependent functions so they pick up the new secret version:
   - `firebase deploy --only functions:clanker:purchasePackageStripe,functions:clanker:stripeWebhook --project equationalapplications-com`
4. (Optional) Disable old versions after validation:
   - `firebase functions:secrets:destroy STRIPE_SECRET_KEY@<old-version> --project equationalapplications-com`

Important:
- In this repo, targeted deploy filters must include the codebase prefix (`functions:clanker:<name>`), otherwise Firebase can report "No function matches given --only filters".

## Deployment

To deploy the functions, navigate to the `functions` directory and use the `deploy` script:

```bash
cd functions
npm run deploy
```

This script is defined in `functions/package.json` and is configured to deploy to the `equationalapplications-com` project.

```json
"scripts": {
  "deploy": "firebase deploy --only functions -P equationalapplications-com"
}
```

## Post-Deployment: The `allUsersIngress` Tag

Due to a strict Google Cloud Organization policy ("Domain Restricted Sharing"), Cloud Run services (which power Firebase Gen 2 functions) are blocked from being publicly accessible by default. However, Firebase `onCall` functions and webhooks *must* be accessible by `allUsers` at the infrastructure layer so that the SDKs and external services can reach them.

To resolve this, an organization policy exception is configured using a custom tag: `1035311523842/allUsersIngress/True`. 

When you deploy a **new** Firebase function, the Firebase CLI will log a warning that it failed to set the invoker permissions, and the deployed function will be inaccessible (returning `403 Forbidden` errors). You must manually attach this tag to the underlying Cloud Run service and grant the invoker role.

### Reference values

| Value | Description |
|---|---|
| **Project ID** | `equationalapplications-com` |
| **Project Number** | `790870307455` |
| **Region** | `us-central1` |
| **Org ID** | `1035311523842` |
| **Tag** | `1035311523842/allUsersIngress/True` |

### Tagged services

All callable and webhook Cloud Run services must have the tag. Current list:

- `exchangetoken`
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

### Commands

Replace `FUNCTION_NAME` with the lowercase Cloud Run service name (e.g. `adminlistusers`).
The commands below are production-specific for `equationalapplications-com`; if you are running in a different project/region, replace project number and region first.

Use these discovery commands before running tag or IAM updates in non-production environments:

```bash
gcloud config get-value project
gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)'
gcloud run services list --platform=managed --format='table(metadata.name,metadata.labels.location)'
```

```bash
# 1. Attach the tag to bypass the organization policy
gcloud resource-manager tags bindings create \
  --tag-value="1035311523842/allUsersIngress/True" \
  --parent="//run.googleapis.com/projects/790870307455/locations/us-central1/services/FUNCTION_NAME" \
  --location=us-central1

# 2. Wait ~15 seconds, then grant public invocation access
gcloud run services add-iam-policy-binding FUNCTION_NAME \
  --project=equationalapplications-com \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

To tag and grant access to **all services at once**:

```bash
for fn in exchangetoken purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser; do
  echo "=== $fn ==="
  gcloud resource-manager tags bindings create \
    --tag-value="1035311523842/allUsersIngress/True" \
    --parent="//run.googleapis.com/projects/790870307455/locations/us-central1/services/$fn" \
    --location=us-central1
done

# Wait ~15 seconds for tag propagation, then:

for fn in exchangetoken purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser; do
  echo "=== $fn ==="
  gcloud run services add-iam-policy-binding "$fn" \
    --project=equationalapplications-com \
    --region=us-central1 \
    --member="allUsers" \
    --role="roles/run.invoker"
done
```

To **verify** which services have the tag:

```bash
for fn in exchangetoken purchasepackagestripe spendcredits stripewebhook revenuecatwebhook \
  adminlistusers adminsetusercredits adminsetusersubscription admincleartermsacceptance \
  adminresetuserstate admindeleteuser; do
  echo "=== $fn ==="
  gcloud resource-manager tags bindings list \
    --parent="//run.googleapis.com/projects/790870307455/locations/us-central1/services/$fn" \
    --location=us-central1 2>&1
done
```

*(Note: You may need to wait 10-15 seconds between attaching the tag and granting the IAM role for the policy exception to propagate. Services that already have the tag will return an ALREADY_EXISTS error — this is safe to ignore.)*
