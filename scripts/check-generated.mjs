#!/usr/bin/env node
/**
 * Fails if tracked generator outputs are stale relative to their sources.
 * Regenerates the static pages, then fails if `git status --porcelain`
 * reports changes under landing/ or public/.
 *
 * Gitignored generator outputs (public/privacy/, public/terms/,
 * public/sitemap.xml, public/robots.txt, public/llms.txt) are invisible to
 * porcelain, so only tracked drift can fail this check.
 *
 * Requires FULL git history: generate-static-pages stamps sitemap lastmod
 * from `git log -1 -- <file>`; a shallow clone falls back to file mtime and
 * fabricates drift. Only run after a fetch-depth: 0 checkout
 * (staging-test.yml already checks out with fetch-depth: 0).
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

execSync('node scripts/generate-static-pages.js', { cwd: ROOT, stdio: 'inherit' })

const dirty = execSync('git status --porcelain -- landing public', {
  cwd: ROOT,
  encoding: 'utf8',
}).trim()

if (dirty) {
  console.error('check-generated: tracked generated outputs are stale — regenerate and commit:')
  console.error(dirty)
  process.exit(1)
}
console.log('  ✓ tracked generated outputs are up-to-date')
