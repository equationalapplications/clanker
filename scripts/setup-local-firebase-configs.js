#!/usr/bin/env node
/**
 * Script to create google-services.json and GoogleService-Info.plist from base64 environment variables
 * Used for local builds where EAS file secrets are not available
 *
 * Outputs files into ./temp to avoid tracking by Metro and git.
 *
 * Note: This script is called by EAS prebuildCommand and may receive extra arguments like --platform
 * which we can safely ignore.
 */

const fs = require('fs')
const path = require('path')

// Load environment variables from .env
require('dotenv').config()

const rootDir = path.join(process.cwd(), '.')
const tempDir = path.join(rootDir, 'temp')

// Check if running in EAS cloud build environment
// In EAS cloud, the files should be created from EAS Secrets automatically
if (process.env.EAS_BUILD === 'true' && !process.env.EAS_LOCAL_BUILD_WORKINGDIR) {
    console.log('ℹ️  Running in EAS cloud build - skipping file creation (using EAS Secrets)')
    process.exit(0)
}

console.log('🔧 Setting up Firebase configuration files from environment variables...')

// Ensure ./temp exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
}

/* global Buffer */
// Decode and write google-services.json (Android)
if (process.env.GOOGLE_SERVICES_JSON_BASE64) {
    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICES_JSON_BASE64, 'base64').toString('utf-8')
        const targetPath = path.join(tempDir, 'google-services.json')
        fs.writeFileSync(targetPath, decoded, 'utf-8')
        console.log('✅ google-services.json created')
    } catch (error) {
        console.error('❌ ERROR: Failed to decode GOOGLE_SERVICES_JSON_BASE64')
        console.error(error.message)
        process.exit(1)
    }
} else {
    console.error('❌ ERROR: GOOGLE_SERVICES_JSON_BASE64 not found in environment variables')
    process.exit(1)
}

// Decode and write GoogleService-Info.plist (iOS)
if (process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64) {
    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64, 'base64').toString('utf-8')
        const targetPath = path.join(tempDir, 'GoogleService-Info.plist')
        fs.writeFileSync(targetPath, decoded, 'utf-8')
        console.log('✅ GoogleService-Info.plist created')
    } catch (error) {
        console.error('⚠️  WARNING: Failed to decode GOOGLE_SERVICE_INFO_PLIST_BASE64')
        console.error(error.message)
    }
} else {
    console.warn('⚠️  WARNING: GOOGLE_SERVICE_INFO_PLIST_BASE64 not found (iOS builds will fail)')
}

console.log('✅ Firebase configuration setup complete')
