#!/usr/bin/env node
/**
 * Fails if tracked generator outputs are stale relative to their sources.
 * Regenerates the static pages, then fails if `git status --porcelain`
 * reports changes under landing/ or public/. Refuses to run (exit 2) when
 * those paths already have uncommitted changes, so local edits are never
 * overwritten.
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

const status = () =>
  execSync('git status --porcelain -- landing public', { cwd: ROOT, encoding: 'utf8' }).trim()

// Regenerating overwrites landing/ and public/ in place. If they already carry
// uncommitted edits, a regeneration that happens to match HEAD would erase
// them and still pass — so refuse instead of regenerating over local work.
const preexisting = status()
if (preexisting) {
  console.error(
    'check-generated: landing/ or public/ has uncommitted changes; commit or stash them first:',
  )
  console.error(preexisting)
  process.exit(2)
}

execSync('node scripts/generate-static-pages.js', { cwd: ROOT, stdio: 'inherit' })

const dirty = status()

if (dirty) {
  console.error('check-generated: tracked generated outputs are stale — regenerate and commit:')
  console.error(dirty)
  process.exit(1)
}
console.log('  ✓ tracked generated outputs are up-to-date')
