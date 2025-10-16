# Firebase Configuration for EAS Build

Since `google-services.json` and `GoogleService-Info.plist` are excluded from git for security reasons, EAS Build needs these files to be created during the build process using EAS Secrets.

## Setup Instructions

### 1. Store Firebase Config Files as EAS Secrets

First, you need to store the contents of your Firebase config files as EAS secrets.

**For google-services.json (Android):**

```bash
# Read the file and store it as a secret (make sure the file exists locally first)
npx eas-cli secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value "$(cat google-services.json)"
```

**For GoogleService-Info.plist (iOS):**

```bash
# Read the file and store it as a secret
npx eas-cli secret:create --scope project --name GOOGLE_SERVICE_INFO_PLIST --type file --value "$(cat GoogleService-Info.plist)"
```

### 2. Verify Secrets Are Set

```bash
npx eas-cli secret:list
```

You should see both secrets listed:
- `GOOGLE_SERVICES_JSON`
- `GOOGLE_SERVICE_INFO_PLIST`

### 3. Build Process

The `eas.json` configuration now includes a `prebuildCommand` that runs `scripts/setup-firebase-configs.sh` before each build. This script:

1. Reads the `GOOGLE_SERVICES_JSON` secret and creates `google-services.json`
2. Reads the `GOOGLE_SERVICE_INFO_PLIST` secret and creates `GoogleService-Info.plist`
3. Fails the build if either secret is missing

### 4. Local Development

For local development, keep your Firebase config files locally:

```bash
# Make sure these files exist locally (they're in .gitignore)
ls -la google-services.json GoogleService-Info.plist
```

If you need to recreate them:
1. Download from Firebase Console
2. Place in the root directory
3. They won't be committed to git (protected by .gitignore)

## How It Works

1. **`.gitignore`**: Excludes `google-services.json` and `GoogleService-Info.plist` from git
2. **EAS Secrets**: Stores the file contents securely in EAS
3. **`scripts/setup-firebase-configs.sh`**: Creates the files during build from secrets
4. **`eas.json`**: Runs the setup script as a `prebuildCommand` for all build profiles

## Troubleshooting

### Error: "google-services.json is missing"

This means the EAS secrets are not set or the setup script failed. Check:

1. Verify secrets exist: `eas secret:list`
2. Check build logs for script errors
3. Ensure the script is executable: `chmod +x scripts/setup-firebase-configs.sh`

### Error: "Secret not found"

You need to create the secrets first (see Setup Instructions above).

### Update Firebase Config

If you need to update the Firebase configuration:

```bash
# Delete old secret
eas secret:delete --name GOOGLE_SERVICES_JSON

# Create new secret with updated file
eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value "$(cat google-services.json)"
```

## Security Notes

- Firebase client-side API keys in these files are safe to use in mobile apps
- However, keeping them out of git prevents accidental exposure of project structure
- Security is enforced via Firebase Security Rules, not by hiding these keys
- EAS Secrets are encrypted and only accessible during builds
- The files are created temporarily during build and never committed to git

## Alternative Approach

If you prefer to commit the files to git (since they contain client-side keys), you can:

1. Remove them from `.gitignore`
2. Commit them to the repository
3. Remove the `prebuildCommand` from `eas.json`
4. Delete the EAS secrets

This is a valid approach since Firebase client-side keys are designed to be public, but keeping them out of git provides an extra layer of security for your project structure.
