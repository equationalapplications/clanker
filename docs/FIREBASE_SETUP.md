# Firebase Configuration Setup

This guide explains how to set up Firebase configuration files for Yours Brightly AI.

## Overview

The app requires two Firebase configuration files that are **NOT** included in the repository for security reasons:

1. `google-services.json` (Android)
2. `GoogleService-Info.plist` (iOS)

These files contain API keys and project identifiers and must be downloaded from your Firebase Console.

## Steps to Configure Firebase

### 1. Create or Access Your Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable **Authentication** and configure sign-in methods (Email/Password, Google, etc.)

### 2. Download Android Configuration

1. In Firebase Console, go to **Project Settings**
2. Scroll to **Your apps** section
3. Click on the Android app (or add a new Android app)
4. Package name should be: `com.equationalapplications.yoursbrightlyai`
5. Download `google-services.json`
6. Place it in the **root directory** of this project

### 3. Download iOS Configuration

1. In Firebase Console, go to **Project Settings**
2. Scroll to **Your apps** section
3. Click on the iOS app (or add a new iOS app)
4. Bundle ID should be: `com.equationalapplications.yoursbrightlyai`
5. Download `GoogleService-Info.plist`
6. Place it in the **root directory** of this project

### 4. Verify File Placement

Your project root should look like this:

```
yoursbrightlyai/
├── google-services.json          ← Android config
├── GoogleService-Info.plist      ← iOS config
├── .env                          ← Your environment variables
├── package.json
├── app.config.ts
└── ...
```

## Important Security Notes

⚠️ **NEVER commit these files to git!**

- These files are already listed in `.gitignore`
- They contain sensitive API keys
- Each developer needs their own copies
- For production, use different Firebase projects for development/staging/production

## Environment Variables

In addition to the config files, you need to set up your `.env` file:

```bash
cp .env.example .env
```

Then fill in your Firebase credentials in `.env`:

```env
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

You can find these values in Firebase Console → Project Settings → General → Your apps

## Troubleshooting

### "Google Play services out of date" (Android)

Update Google Play Services in your emulator or device.

### "No Firebase App '[DEFAULT]' has been created" (iOS)

Make sure `GoogleService-Info.plist` is in the root directory and rebuild the app.

### Build Errors

If you get build errors after adding the config files:

```bash
# Clear cache and rebuild
npm run start:clear

# For iOS
cd ios && pod install && cd ..

# For Android
cd android && ./gradlew clean && cd ..
```

## Alternative: Using Your Own Firebase Project

If you want to use your own Firebase project (recommended for development):

1. Create a new Firebase project in the Firebase Console
2. Set up Authentication with your preferred sign-in methods
3. Download the configuration files as described above
4. Update your `.env` file with your project's credentials
5. (Optional) Set up Firebase Cloud Functions for the `exchangeToken` function

## Next Steps

After setting up Firebase:

1. Set up Supabase (see main README.md)
2. Configure Google Cloud Vertex AI
3. Set up RevenueCat for subscriptions (optional for development)

For more details, see the main [README.md](../README.md) and [docs/AUTH_FLOW.md](../docs/AUTH_FLOW.md).
