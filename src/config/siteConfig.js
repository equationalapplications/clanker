// Single source of truth for the production web origin and the character
// share path. Consumed at build time by app.config.ts (iOS associatedDomains,
// Android app-link intentFilters) and scripts/generate-static-pages.js, and at
// runtime by share-link builders. Plain CommonJS because Expo's config loader
// only transpiles app.config.ts itself — nested imports resolve via plain
// Node require, which can't load .ts modules.
const SITE_BASE = 'https://clanker-ai.com'
const SITE_HOST = new URL(SITE_BASE).host
const CHARACTER_SHARE_PATH_PREFIX = '/characters/shared/'

module.exports = { SITE_BASE, SITE_HOST, CHARACTER_SHARE_PATH_PREFIX }
