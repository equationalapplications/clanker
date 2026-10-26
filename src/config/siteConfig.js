// Single source of truth for the production web origin and the character
// share path. Consumed at build time by app.config.ts (iOS associatedDomains,
// Android app-link intentFilters), scripts/generate-static-pages.js and
// scripts/finalize-web-export.mjs, and at runtime by share-link builders and
// the signed-in hint. Plain CommonJS because Expo's config loader only
// transpiles app.config.ts itself — nested imports resolve via plain Node
// require, which can't load .ts modules.
const SITE_BASE = 'https://clanker-ai.com'
const SITE_HOST = new URL(SITE_BASE).host
const CHARACTER_SHARE_PATH_PREFIX = '/characters/shared/'

// Where a signed-in visitor lands when they open the web root. The static
// landing page at `/` redirects there when SIGNED_IN_HINT_KEY is set.
const APP_HOME_PATH = '/chat'

// localStorage key, written by the web auth seam on every auth state change
// and read by the inline script at the top of landing/index.html. It is a
// hint, not an auth check: a stale "1" only costs one extra hop to /sign-in.
const SIGNED_IN_HINT_KEY = 'clanker:signedIn'

// File name the Expo single-page shell is renamed to after `expo export`, so
// the static landing page can own dist/index.html. firebase.json rewrites
// every non-file path to this shell.
const APP_SHELL_FILE = 'app-shell.html'

module.exports = {
  SITE_BASE,
  SITE_HOST,
  CHARACTER_SHARE_PATH_PREFIX,
  APP_HOME_PATH,
  SIGNED_IN_HINT_KEY,
  APP_SHELL_FILE,
}
