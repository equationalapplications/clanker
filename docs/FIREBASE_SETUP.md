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

For local builds (i.e., running `eas build --local ...`), you cannot pull the secret files from EAS. Instead, we use a local `.env` file and scripts to manage them.

### How it Works

1.  You download the Firebase config files.
2.  You convert their contents into `base64` strings.
3.  You store these strings in a local `.env` file.
4.  When you run a local build script (like `npm run build:...`), a setup script decodes the base64 string and creates the necessary files under `./temp/`.
5.  A cleanup script automatically removes the files after the build is complete.

### Setup Steps

1.  **Download Config Files**: Get `google-services.json` and `GoogleService-Info.plist` from your Firebase Console.

2.  **Convert to Base64**: Open your terminal and run the following commands on the downloaded files.

    *On macOS & Linux:*
    ```bash
    # For Android
    base64 -i google-services.json

    # For iOS
    base64 -i GoogleService-Info.plist
    ```
    Copy the output string from each command.

3.  **Create `.env` file**: In the project root, create a file named `.env`.

4.  **Add to `.env`**: Add the copied base64 strings to your `.env` file. The file should look like this:

    ```env
    # .env - For local builds only. DO NOT COMMIT THIS FILE.

    # IMPORTANT: Use the *_BASE64 names locally to avoid collisions with EAS file env vars
    GOOGLE_SERVICES_JSON_BASE64="<paste-your-base64-string-for-google-services.json-here>"
    GOOGLE_SERVICE_INFO_PLIST_BASE64="<paste-your-base64-string-for-GoogleService-Info.plist-here>"
    ```

Your local builds are now configured. The scripts in `package.json` will handle the rest automatically.

### Why the temp directory?

- Our `app.config.ts` first looks for EAS-provided file paths (`GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`).
- If those are not present (local builds), it falls back to `./temp/google-services.json` and `./temp/GoogleService-Info.plist`.
- The `./temp/` folder is ignored by git and kept out of Metro's module graph to avoid accidental tracking or caching issues during development.

Do not define `GOOGLE_SERVICES_JSON` or `GOOGLE_SERVICE_INFO_PLIST` in your local `.env`. Those names are reserved for EAS file environment variables.

---

## Auth Provider Checklist

Use this checklist for whichever Firebase project and app identifiers you are using. In this repository, examples may reference the current production project (`clanker-prod`) and bundle/package ID (`com.equationalapplications.clanker`), but you should substitute your own values when cloning or reusing the app.

### Google Sign-In

1. In Firebase Console, open **Authentication -> Sign-in method -> Google** and enable it.
2. In **Project settings -> Your apps**, confirm your iOS bundle ID and Android package name are registered in the target Firebase project.
    Example for this repo: `com.equationalapplications.clanker`.
3. Re-download fresh `GoogleService-Info.plist` and `google-services.json` after enabling Google auth.
4. Confirm `GoogleService-Info.plist` includes `CLIENT_ID` and `REVERSED_CLIENT_ID`.
5. Confirm `google-services.json` has non-empty `client[0].oauth_client` entries.
6. Set/update OAuth env vars in EAS and local `.env`:
    - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
    - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
    - Optional: `GOOGLE_IOS_URL_SCHEME` (if you need to override plist-derived value)
7. Re-run local setup if needed to refresh temp files:

```bash
npm run prebuild:setup
```

### Apple Sign-In

1. In Firebase Console, open **Authentication -> Sign-in method -> Apple** and enable it.
2. Configure Apple provider credentials for the target Firebase project:
    - Apple Team ID
    - Key ID
    - Services ID
    - Private key (`.p8`)
3. In Apple Developer, ensure the **Sign in with Apple** capability is enabled for your app's iOS bundle ID.
    Example for this repo: `com.equationalapplications.clanker`.
4. Confirm your app build enables Apple Sign-In in Expo/native config.
    Example for this repo: `usesAppleSignIn: true` is already set in `app.config.ts`.

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

