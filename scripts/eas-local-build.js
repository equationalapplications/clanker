#!/usr/bin/env node
/**
 * Wrapper for local EAS builds.
 *
 * Loads .env so GOOGLE_SERVICES_JSON_BASE64 / GOOGLE_SERVICE_INFO_PLIST_BASE64
 * are available to the eas-cli subprocess. app.config.ts decodes them at
 * config-evaluation time — no separate setup/cleanup scripts needed.
 *
 * Usage (via npm scripts):
 *   npm run build:prod-a   # Android production
 *   npm run build:dev-a    # Android development
 *   npm run build:prod-i   # iOS production
 *   npm run build:dev-i    # iOS development
 *
 * Or directly:
 *   node scripts/eas-local-build.js --platform android --profile production
 */

require('dotenv').config()

const { spawnSync } = require('child_process')

const args = process.argv.slice(2)
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const result = spawnSync(cmd, ['eas-cli', 'build', '--local', ...args], {
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  console.error(`Failed to start ${cmd}: ${result.error.message}`)
  process.exit(1)
}

if (result.signal) {
  console.error(`${cmd} was terminated by signal ${result.signal}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
