#!/usr/bin/env node

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env'), quiet: true })

const required = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID',
]

const recommended = ['EXPO_PUBLIC_VAPID_PUBLIC_KEY']

const missing = required.filter((key) => !process.env[key]?.trim())
const missingRecommended = recommended.filter((key) => !process.env[key]?.trim())

if (missing.length > 0) {
  console.error('Web export blocked — missing required env vars:')
  for (const key of missing) console.error(`  - ${key}`)
  process.exit(1)
}

if (missingRecommended.length > 0) {
  console.warn('Web export warning — optional env vars not set (web push will not work):')
  for (const key of missingRecommended) console.warn(`  - ${key}`)
}
