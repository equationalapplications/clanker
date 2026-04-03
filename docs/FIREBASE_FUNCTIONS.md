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
