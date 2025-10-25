#!/usr/bin/env node
/**
 * Script to clean up temporary Firebase configuration files after build
 */

const fs = require('fs')
const path = require('path')

const rootDir = path.join(__dirname, '..')
const googleServicesJsonPath = path.join(rootDir, 'google-services.json')
const googleServiceInfoPlist = path.join(rootDir, 'GoogleService-Info.plist')

console.log('🧹 Cleaning up Firebase configuration files...')

// Remove google-services.json
if (fs.existsSync(googleServicesJsonPath)) {
    fs.unlinkSync(googleServicesJsonPath)
    console.log('✅ google-services.json removed')
} else {
    console.log('ℹ️  google-services.json not found (already cleaned)')
}

// Remove GoogleService-Info.plist
if (fs.existsSync(googleServiceInfoPlist)) {
    fs.unlinkSync(googleServiceInfoPlist)
    console.log('✅ GoogleService-Info.plist removed')
} else {
    console.log('ℹ️  GoogleService-Info.plist not found (already cleaned)')
}

console.log('✅ Cleanup complete')
