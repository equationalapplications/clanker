import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const PROD_CLOUD_AGENT_URL = 'https://clanker-cloud-agent-zbvqu57cca-uc.a.run.app'

function loadDotEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDotEnv(resolve(repoRoot, '.env'))
loadDotEnv(resolve(repoRoot, '.env.development.local'))

function pick(envKey, fallback = '') {
  const value = process.env[envKey]?.trim()
  return value || fallback
}

function normalizeCloudBaseUrl(rawUrl) {
  return rawUrl
    .trim()
    .replace(/\/agent\/(run|stream|live|browser)\/?$/i, '')
    .replace(/\/$/, '')
}

const cloudBase = normalizeCloudBaseUrl(
  pick('EXPO_PUBLIC_CLOUD_AGENT_URL', PROD_CLOUD_AGENT_URL),
)
const cloudWs = cloudBase.replace(/^http/i, 'ws') + '/agent/browser'

const extensionEnv = {
  FIREBASE_API_KEY: pick('EXPO_PUBLIC_FIREBASE_API_KEY', 'REPLACE_FIREBASE_API_KEY'),
  FIREBASE_AUTH_DOMAIN: pick('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'REPLACE.firebaseapp.com'),
  FIREBASE_PROJECT_ID: pick('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'REPLACE'),
  FIREBASE_APP_ID: pick('EXPO_PUBLIC_FIREBASE_APP_ID', 'REPLACE'),
  FIREBASE_SENDER_ID: pick('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'REPLACE_FCM_SENDER_ID'),
  CLOUD_BASE_URL: cloudBase,
  CLOUD_WS_URL: cloudWs,
}

const esmEntries = {
  'background/service-worker': 'src/background/service-worker.ts',
  'offscreen/auth': 'src/offscreen/auth.ts',
  'ui/side-panel/panel': 'src/ui/side-panel/panel.ts',
  'ui/popup/popup': 'src/ui/popup/popup.ts',
}

mkdirSync('dist', { recursive: true })

const sharedBuildOpts = {
  outdir: 'dist',
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  define: { __EXTENSION_ENV__: JSON.stringify(extensionEnv) },
}

await build({ ...sharedBuildOpts, entryPoints: esmEntries, format: 'esm' })

// Content script injected via files — must be IIFE (not ES module) so Chrome can inject
// it into the page's isolated world and the message listener runs immediately.
await build({
  ...sharedBuildOpts,
  entryPoints: { 'content/executor': 'src/content/bridge-listener.ts' },
  format: 'iife',
})

for (const f of ['manifest.json']) cpSync(f, `dist/${f}`)
cpSync('icons', 'dist/icons', { recursive: true })
cpSync('src/offscreen/auth.html', 'dist/offscreen/auth.html')
cpSync('src/ui/side-panel/index.html', 'dist/ui/side-panel/index.html')
cpSync('src/ui/popup/index.html', 'dist/ui/popup/index.html')
console.log('extension built → dist/')
