#!/bin/bash
# Script to create google-services.json and GoogleService-Info.plist from EAS file environment variables

set -e

echo "🔧 Setting up Firebase configuration files from EAS environment variables..."

# EAS automatically writes file environment variables to the specified paths
# We just need to verify they exist

# Check if google-services.json exists (Android)
if [ -f "google-services.json" ]; then
  echo "✅ google-services.json found"
else
  echo "❌ ERROR: google-services.json not found"
  echo "Make sure GOOGLE_SERVICES_JSON is set as a file environment variable in EAS"
  exit 1
fi

# Check if GoogleService-Info.plist exists (iOS)
if [ -f "GoogleService-Info.plist" ]; then
  echo "✅ GoogleService-Info.plist found"
else
  echo "⚠️  WARNING: GoogleService-Info.plist not found (iOS builds will fail)"
  echo "Set GOOGLE_SERVICE_INFO_PLIST as a file environment variable in EAS when ready for iOS"
fi

echo "✅ Firebase configuration check complete"
