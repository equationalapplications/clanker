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

Run the following commands using the `gcloud` CLI. Before running them, replace:

- `your_function_name` with the exact Cloud Run service name in lowercase (for example, `exchangetoken` or `stripewebhook`)
- `YOUR_PROJECT_NUMBER` with the Google Cloud project number that owns the Cloud Run service
- `YOUR_REGION` with the region where the function was deployed (for example, `us-central1`)

If you are working in an environment other than the shared `equationalapplications-com` project, do not reuse the hard-coded project/region values from another environment; make sure the full `--parent` resource path and the `--location` / `--region` flags all point to the same service.

```bash
# 1. Attach the tag to bypass the organization policy
gcloud resource-manager tags bindings create \
  --tag-value="1035311523842/allUsersIngress/True" \
  --parent="//run.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/YOUR_REGION/services/your_function_name" \
  --location=YOUR_REGION

# 2. Wait a few seconds, then grant public invocation access
gcloud run services add-iam-policy-binding your_function_name \
  --region=YOUR_REGION \
  --member="allUsers" \
  --role="roles/run.invoker"
```
*(Note: You may need to wait 10-15 seconds between attaching the tag and granting the IAM role for the policy exception to propagate).*
