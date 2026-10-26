#!/usr/bin/env node
/**
 * Runs after `expo export --platform web`. Expo's single-page export always
 * writes its shell to dist/index.html, which is what crawlers saw at `/`
 * (an empty document titled "Clanker"). This step:
 *
 *   1. renames the shell to dist/<APP_SHELL_FILE>, which firebase.json's
 *      catch-all rewrite points at, so every app route keeps working;
 *   2. copies the generated marketing page (landing/index.html, see
 *      scripts/generate-static-pages.js) to dist/index.html so `/` is real
 *      content;
 *   3. gives the shell a descriptive <title> and a noindex robots meta, so
 *      app-only routes (/sign-in, /chat, …) stop appearing as "Clanker" in
 *      search and unknown paths are not indexed as soft 404s;
 *   4. sanity-checks the files mobile deep links depend on.
 *
 * Fails loudly: a half-finalized dist must never be deployed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { APP_SHELL_FILE } = require(path.join(ROOT, 'src/config/siteConfig.js'))

const DIST = path.join(ROOT, 'dist')
const SHELL_SRC = path.join(DIST, 'index.html')
const SHELL_DEST = path.join(DIST, APP_SHELL_FILE)
const LANDING_SRC = path.join(ROOT, 'landing', 'index.html')
const LANDING_DEST = path.join(DIST, 'index.html')

const SHELL_TITLE = 'Clanker AI'
const SHELL_DESCRIPTION =
  'The Clanker AI web app. Sign in to chat with, call, and share your own AI characters.'

function fail(message) {
  console.error(`finalize-web-export: ${message}`)
  process.exit(1)
}

function isExpoShell(html) {
  return html.includes('<div id="root"></div>') && html.includes('/_expo/static/js/web/')
}

export function patchShell(html) {
  if (!/<title>[^<]*<\/title>/.test(html)) fail('shell has no <title> to patch')
  if (html.includes('name="robots"')) fail('shell already carries a robots meta')
  return html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${SHELL_TITLE}</title>\n` +
      `    <meta name="description" content="${SHELL_DESCRIPTION}" />\n` +
      `    <meta name="robots" content="noindex" />`,
  )
}

function main() {
  if (!fs.existsSync(SHELL_SRC)) fail(`missing ${path.relative(ROOT, SHELL_SRC)}; run expo export first`)
  if (!fs.existsSync(LANDING_SRC)) {
    fail(`missing ${path.relative(ROOT, LANDING_SRC)}; run npm run generate:static-pages first`)
  }

  const shell = fs.readFileSync(SHELL_SRC, 'utf8')
  if (!isExpoShell(shell)) {
    fail(`${path.relative(ROOT, SHELL_SRC)} does not look like the Expo shell; refusing to overwrite it`)
  }

  const landing = fs.readFileSync(LANDING_SRC, 'utf8')
  if (!landing.includes('<link rel="canonical" href="https://clanker-ai.com/" />')) {
    fail('landing/index.html does not canonicalize to the site root; regenerate it')
  }

  fs.writeFileSync(SHELL_DEST, patchShell(shell))
  fs.writeFileSync(LANDING_DEST, landing)
  console.log(`  ✓ dist/${APP_SHELL_FILE} (Expo shell, noindex)`)
  console.log('  ✓ dist/index.html (landing page)')

  // /welcome is a 301 to / in firebase.json; a stale copy here would be unreachable
  // but is still a sign the export directory was not clean.
  const staleWelcome = path.join(DIST, 'welcome')
  if (fs.existsSync(staleWelcome)) {
    fs.rmSync(staleWelcome, { recursive: true })
    console.log('  ✓ removed stale dist/welcome')
  }

  // Mobile deep links (iOS Universal Links, Android App Links) are verified from
  // these two files. They are tracked in public/.well-known and copied by expo
  // export; a deploy without them silently breaks /characters/shared/* on mobile.
  for (const file of ['apple-app-site-association', 'assetlinks.json']) {
    const full = path.join(DIST, '.well-known', file)
    if (!fs.existsSync(full)) fail(`missing dist/.well-known/${file}`)
    try {
      JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (error) {
      fail(`dist/.well-known/${file} is not valid JSON: ${error.message}`)
    }
  }
  console.log('  ✓ dist/.well-known deep-link files present and valid')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
