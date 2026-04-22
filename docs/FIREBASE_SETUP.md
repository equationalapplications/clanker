# Firebase Configuration Setup

This guide explains how to set up Firebase configuration files for both **EAS Cloud Builds** and **Local Development Builds**.

## Overview

The app requires two Firebase configuration files that are **NOT** committed to the repository for security reasons:

1.  `google-services.json` (Android)
2.  `GoogleService-Info.plist` (iOS)

If you are migrating projects, always re-download both files from the target Firebase project (`clanker-prod` for current production) before updating EAS env vars or local base64 values.

The method for providing these files differs depending on your build environment.

---

## 1. EAS Cloud Builds (Production & Preview)

For builds running on Expo Application Services (EAS), we use **File Environment Variables**. This is the modern, recommended approach.

### How it Works

1.  You upload your secret files to EAS.
2.  During the cloud build, EAS makes the path to these files available as environment variables (`process.env.GOOGLE_SERVICES_JSON` and `process.env.GOOGLE_SERVICE_INFO_PLIST`).
3.  Our `app.config.ts` is already configured to read these environment variables and configure the build.

### Setup Steps

First, download your `google-services.json` and `GoogleService-Info.plist` files from the Firebase Console.

Then, run the following commands from the project root to create the file environment variables on EAS. You only need to do this once per project.

**For Android:**
```bash
eas env:create --name GOOGLE_SERVICES_JSON --type file --file ./google-services.json --environment production,staging,preview,development
```

**For iOS:**
```bash
eas env:create --name GOOGLE_SERVICE_INFO_PLIST --type file --file ./GoogleService-Info.plist --environment production,staging,preview,development
```

That's it! Your cloud builds are now configured.

---

## 2. Local Development Builds

For local builds (`eas build --local`), EAS does not inject cloud secrets into your local shell. Instead, store the Firebase config files as base64 strings in a local `.env` file. The `scripts/eas-local-build.js` wrapper loads `.env` and passes the vars into the `eas-cli` subprocess, where `app.config.ts` decodes them at config-evaluation time.

### How it Works

1.  You download the Firebase config files and encode them as base64.
2.  You store the base64 strings in a local `.env` file.
3.  You run one of the `npm run build:*` scripts.
4.  `scripts/eas-local-build.js` loads `.env` and spawns `eas-cli build --local`.
5.  Inside the build, `app.config.ts` decodes `GOOGLE_SERVICES_JSON_BASE64` into `./temp/google-services.json` and returns that path.

### Setup Steps

1.  **Download Config Files**: Get `google-services.json` and `GoogleService-Info.plist` from your Firebase Console.

2.  **Convert to Base64** (single-line output for `.env` values):

    *On macOS (BSD base64):*
    ```bash
    base64 -i google-services.json | tr -d '\n'
    base64 -i GoogleService-Info.plist | tr -d '\n'
    ```

    *On Linux (GNU base64):*
    ```bash
    base64 -w 0 google-services.json
    base64 -w 0 GoogleService-Info.plist
    ```

    Copy each output string.

3.  **Create `.env`** in the project root:

    ```env
    # .env - For local builds only. DO NOT COMMIT THIS FILE.

    # IMPORTANT: Use the *_BASE64 names — GOOGLE_SERVICES_JSON and
    # GOOGLE_SERVICE_INFO_PLIST (without suffix) are reserved for EAS cloud file env vars.
    GOOGLE_SERVICES_JSON_BASE64="<base64-of-google-services.json>"
    GOOGLE_SERVICE_INFO_PLIST_BASE64="<base64-of-GoogleService-Info.plist>"
    ```

4.  **Run a local build** via the npm scripts:

    ```bash
    # Android
    npm run build:prod-a
    npm run build:dev-a

    # iOS
    npm run build:prod-i
    npm run build:dev-i
    ```

    These call `scripts/eas-local-build.js`, which loads `.env` and invokes
    `eas-cli build --local --profile <profile> --platform <platform>`.

    Alternatively, export `.env` yourself and run `eas-cli` directly:

    ```bash
    set -o allexport; source .env; set +o allexport
    npx eas-cli build --platform android --profile production --local
    ```

Do not define `GOOGLE_SERVICES_JSON` or `GOOGLE_SERVICE_INFO_PLIST` in your local `.env`. Those names are reserved for EAS file environment variables.

---

## Syncing Non-Secret Environment Variables

EAS provides a convenient way to keep your other, non-secret environment variables (like API keys) in sync for local development.

Run the following command to pull variables from the `development` environment on EAS into a local `.env` file:

```bash
eas env:pull --environment development
```

**Note**: This command **will not** download the contents of your secret Firebase files. It will add placeholders for them, which is why the manual base64 process for local builds is necessary.

## Important Security Notes

⚠️ **NEVER commit your `.env` file to git!**

*   This file is already listed in `.gitignore` to prevent accidental commits.
*   It contains sensitive API keys and credentials.
*   Each developer needs to create their own `.env` file.
