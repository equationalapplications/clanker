import fs from 'fs'
import path from 'path'

/**
 * firebase.json no longer has a `**` catch-all to the app shell: unknown paths
 * must fall through to public/404.html with a real 404 status, so Search
 * Console stops seeing every crawled path as a 200 soft 404. That means every
 * Expo Router screen needs an explicit rewrite, or deep links to it break on
 * web. This test walks app/ and fails when a route has no matching rewrite.
 */

const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'app')

type Rewrite = { source: string; destination: string }

function loadRewrites(): Rewrite[] {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'))
  return config.hosting.rewrites
}

/** Minimal Firebase-style glob match: `**` spans segments, `*` stays in one. */
function globMatches(glob: string, urlPath: string): boolean {
  const pattern = glob
    .split('/')
    .map((part) => {
      if (part === '**') return '\u0000'
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    })
    .join('/')
    .replace(/\/\u0000/g, '(?:/.*)?')
  return new RegExp(`^${pattern}$`).test(urlPath)
}

/** Every screen file in app/ as the URL Expo Router serves it on web. */
function appRoutes(dir = APP_DIR): string[] {
  const routes: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      routes.push(...appRoutes(full))
      continue
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.startsWith('_')) continue
    const rel = path.relative(APP_DIR, full).replace(/\.tsx?$/, '')
    const segments = rel
      .split(path.sep)
      .filter((s) => !/^\(.*\)$/.test(s)) // route groups are not in the URL
      .map((s) => s.replace(/^\[.*\]$/, 'sample-id'))
    if (segments[segments.length - 1] === 'index') segments.pop()
    routes.push('/' + segments.join('/'))
  }
  return routes
}

describe('firebase.json hosting rewrites', () => {
  const rewrites = loadRewrites()

  it('has no catch-all rewrite, so unknown paths get a real 404', () => {
    for (const r of rewrites) {
      expect(globMatches(r.source, '/blog')).toBe(false)
      expect(globMatches(r.source, '/some/unknown/path')).toBe(false)
    }
  })

  it('ships a 404 page for Firebase to serve', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', '404.html'), 'utf8')
    expect(html).toContain('<meta name="robots" content="noindex" />')
  })

  it.each(appRoutes().filter((r) => r !== '/'))('rewrites app route %s to the shell', (route) => {
    const hit = rewrites.find((r) => globMatches(r.source, route))
    expect(hit?.destination).toBe('/app-shell.html')
  })
})
