#!/usr/bin/env node
/**
 * Script to create google-services.json and GoogleService-Info.plist from base64 environment variables
 * Used for local builds where EAS file secrets are not available
 * 
 * Note: This script is called by EAS prebuildCommand and may receive extra arguments like --platform
 * which we can safely ignore.
 */

const fs = require('fs')
const path = require('path')

// Load environment variables from .env
require('dotenv').config()

const rootDir = path.join(__dirname, '..')

// Check if running in EAS cloud build environment
// In EAS cloud, the files should be created from EAS Secrets automatically
if (process.env.EAS_BUILD === 'true' && !process.env.EAS_LOCAL_BUILD_WORKINGDIR) {
    console.log('ℹ️  Running in EAS cloud build - skipping file creation (using EAS Secrets)')
    process.exit(0)
}

console.log('🔧 Setting up Firebase configuration files from environment variables...')

// Decode and write google-services.json (Android)
if (process.env.GOOGLE_SERVICES_JSON) {
    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICES_JSON, 'base64').toString('utf-8')
        const targetPath = path.join(rootDir, 'google-services.json')
        fs.writeFileSync(targetPath, decoded, 'utf-8')
        console.log('✅ google-services.json created')
    } catch (error) {
        console.error('❌ ERROR: Failed to decode GOOGLE_SERVICES_JSON')
        console.error(error.message)
        process.exit(1)
    }
} else {
    console.error('❌ ERROR: GOOGLE_SERVICES_JSON not found in environment variables')
    process.exit(1)
}

// Decode and write GoogleService-Info.plist (iOS)
if (process.env.GOOGLE_SERVICE_INFO_PLIST) {
    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICE_INFO_PLIST, 'base64').toString('utf-8')
        const targetPath = path.join(rootDir, 'GoogleService-Info.plist')
        fs.writeFileSync(targetPath, decoded, 'utf-8')
        console.log('✅ GoogleService-Info.plist created')
    } catch (error) {
        console.error('⚠️  WARNING: Failed to decode GOOGLE_SERVICE_INFO_PLIST')
        console.error(error.message)
    }
} else {
    console.warn('⚠️  WARNING: GOOGLE_SERVICE_INFO_PLIST not found (iOS builds will fail)')
}

console.log('✅ Firebase configuration setup complete')
