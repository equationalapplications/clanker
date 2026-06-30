#!/usr/bin/env node
'use strict'

/**
 * Generates SEO-friendly static HTML for the public legal pages (/privacy, /terms)
 * plus sitemap.xml and robots.txt, writing them into public/ so `expo export`
 * copies them into dist/. Firebase `cleanUrls` serves these static files before
 * the SPA catch-all rewrite (see firebase.json).
 *
 * Single source of truth: src/config/privacyConfig.ts and src/config/termsConfig.ts.
 * Content is read by transpiling those TS modules in-memory (TypeScript compiler)
 * with a stubbed `react-native` so interpolations like ${APPLE_EULA_URL} resolve
 * without hardcoding. Generated outputs are gitignored; if this script is skipped,
 * the Expo Router screens still render the same pages as a graceful fallback.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const SITE = 'https://clanker-ai.com'

// ---------------------------------------------------------------------------
// Minimal TS module loader (transpile + evaluate) with native-dep stubs.
// ---------------------------------------------------------------------------

const moduleCache = new Map()

function reactNativeStub() {
  return {
    Platform: {
      OS: 'web',
      select: (spec) => (spec && (spec.web ?? spec.native ?? spec.default)) ?? undefined,
    },
  }
}

function loadTsModule(file) {
  const resolved = resolveTs(file)
  if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports

  const source = fs.readFileSync(resolved, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: resolved,
  })

  const moduleObj = { exports: {} }
  moduleCache.set(resolved, moduleObj)

  const dir = path.dirname(resolved)
  const localRequire = (request) => {
    if (request === 'react-native') return reactNativeStub()
    if (request.startsWith('~/')) return loadTsModule(path.join(ROOT, 'src', request.slice(2)))
    if (request.startsWith('.')) return loadTsModule(path.join(dir, request))
    return require(request)
  }

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
  fn(moduleObj.exports, localRequire, moduleObj, resolved, dir)
  return moduleObj.exports
}

function resolveTs(file) {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  for (const ext of ['.ts', '.tsx', '.js']) {
    if (fs.existsSync(file + ext)) return file + ext
  }
  const indexed = path.join(file, 'index.ts')
  if (fs.existsSync(indexed)) return indexed
  throw new Error(`Cannot resolve module: ${file}`)
}

// ---------------------------------------------------------------------------
// Plain-text (config) → HTML conversion.
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineFormat(value) {
  let out = escapeHtml(value)
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(
    /(https?:\/\/[^\s<>()]+)/g,
    '<a href="$1" rel="noopener noreferrer">$1</a>',
  )
  out = out.replace(
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '<a href="mailto:$1">$1</a>',
  )
  return out
}

function isHeadingLine(line) {
  const l = line.trim()
  if (l.length === 0 || l.length > 56) return false
  if (/[.;:,]$/.test(l)) return false
  if (/^[-•]/.test(l)) return false
  return /^[A-Z0-9]/.test(l)
}

function renderBullets(lines) {
  const items = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (/^[-•]\s+/.test(line)) {
      items.push(line.replace(/^[-•]\s+/, ''))
    } else if (items.length > 0) {
      items[items.length - 1] += ' ' + line
    }
  }
  return `<ul>${items.map((i) => `<li>${inlineFormat(i)}</li>`).join('')}</ul>`
}

function textToHtml(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim()
  const blocks = text.split(/\n\s*\n/)
  const out = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) continue

    if (/^[-•]\s+/.test(lines[0].trim())) {
      out.push(renderBullets(lines))
      continue
    }

    const first = lines[0].trim()

    if (/^##\s+/.test(first)) {
      out.push(`<h2>${inlineFormat(first.replace(/^##\s+/, ''))}</h2>`)
      const rest = lines.slice(1)
      if (rest.length) out.push(`<p>${inlineFormat(rest.join(' '))}</p>`)
      continue
    }

    const numbered = /^\d{1,2}\.\s+\S/.test(first)
    if (numbered || isHeadingLine(first)) {
      out.push(`<h3>${inlineFormat(first)}</h3>`)
      const rest = lines.slice(1)
      if (rest.length) out.push(`<p>${inlineFormat(rest.join(' '))}</p>`)
      continue
    }

    out.push(`<p>${inlineFormat(lines.join(' '))}</p>`)
  }

  return out.join('\n        ')
}

// ---------------------------------------------------------------------------
// Shared styling + page shell.
// ---------------------------------------------------------------------------

const SHARED_CSS = `
      :root {
        --primary: #835400;
        --background: #fffbff;
        --on-background: #1f1b16;
        --surface-variant: #f0e0d0;
        --on-surface-variant: #4f4539;
        --outline: #817568;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--background);
        color: var(--on-background);
        line-height: 1.6;
      }
      a { color: var(--primary); }
      .skip-link {
        position: absolute; top: -9999px; left: 0; padding: 8px 16px;
        background: #fff; color: #000; font-weight: bold; text-decoration: none;
        border-radius: 4px; z-index: 9999;
      }
      .skip-link:focus { top: 8px; left: 8px; }
      main { max-width: 760px; margin: 0 auto; padding: 24px; }
      .back-link { display: inline-block; margin-bottom: 16px; font-size: 14px; }
      .doc-meta { color: var(--on-surface-variant); font-size: 0.85rem; margin: 0 0 24px; }
      h1 { color: var(--primary); font-size: clamp(1.75rem, 4vw, 2.25rem); margin: 0 0 8px; }
      h2 { font-size: 1.35rem; margin: 32px 0 8px; }
      h3 { font-size: 1.1rem; margin: 24px 0 6px; }
      p, li { color: var(--on-surface-variant); }
      ul { padding-left: 1.25rem; }
      .eula-btn {
        display: inline-block; margin: 16px 0; padding: 10px 18px;
        border: 1px solid var(--primary); border-radius: 999px;
        color: var(--primary); text-decoration: none; font-weight: 600;
      }
      footer {
        padding: 24px 16px; text-align: center; font-size: 0.875rem;
        color: var(--outline); border-top: 1px solid var(--surface-variant); margin-top: 48px;
      }
      footer a { color: var(--outline); }
      footer span { margin: 0 4px; }`

const FOOTER = `
    <footer>
      <a href="/welcome">About Clanker</a>
      <span>·</span>
      <a href="/real-time-voice">Real-Time Voice</a>
      <span>·</span>
      <a href="/terms">Terms and Conditions</a>
      <span>·</span>
      <a href="/privacy">Privacy Policy</a>
      <span>·</span>
      <a href="https://equationalapplications.com/" rel="noopener noreferrer">Equational Applications LLC</a>
    </footer>`

function renderDocPage({ slug, pageTitle, h1, description, version, lastUpdated, bodyHtml, extraHtml }) {
  const canonical = `${SITE}/${slug}`
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${pageTitle}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${SITE}/og-image.png" />
    <style>${SHARED_CSS}
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <main id="main-content">
      <a class="back-link" href="/">← Back to Clanker</a>
      <h1>${h1}</h1>
      <p class="doc-meta">Version ${version} • Last updated ${lastUpdated}</p>
        ${bodyHtml}${extraHtml || ''}
    </main>${FOOTER}
  </body>
</html>
`
}

// ---------------------------------------------------------------------------
// Generation.
// ---------------------------------------------------------------------------

function writeFile(relPath, contents) {
  const full = path.join(PUBLIC_DIR, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, contents)
  console.log(`  ✓ public/${relPath}`)
}

function toIsoDate(humanDate) {
  const parsed = new Date(humanDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function generatePrivacy() {
  const { PRIVACY } = loadTsModule(path.join(ROOT, 'src/config/privacyConfig.ts'))
  const html = renderDocPage({
    slug: 'privacy',
    pageTitle: 'Privacy Policy — Clanker',
    h1: 'Privacy Policy',
    description:
      'How Clanker by Equational Applications LLC collects, uses, and protects your information, including AI chat processing and browser extension data usage.',
    version: PRIVACY.version,
    lastUpdated: PRIVACY.lastUpdated,
    bodyHtml: textToHtml(PRIVACY.privacy),
  })
  writeFile('privacy/index.html', html)
  return PRIVACY
}

function generateTerms() {
  const { TERMS } = loadTsModule(path.join(ROOT, 'src/config/termsConfig.ts'))
  const eulaButton =
    '\n        <a class="eula-btn" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" rel="noopener noreferrer">View Apple Standard EULA</a>'
  const html = renderDocPage({
    slug: 'terms',
    pageTitle: 'Terms and Conditions — Clanker',
    h1: 'Terms and Conditions',
    description:
      'The terms and conditions governing your use of Clanker by Equational Applications LLC, including AI characters, billing, credits, and legal terms.',
    version: TERMS.version,
    lastUpdated: TERMS.lastUpdated,
    bodyHtml: textToHtml(TERMS.terms),
    extraHtml: eulaButton,
  })
  writeFile('terms/index.html', html)
  return TERMS
}

function generateSitemap({ privacy, terms }) {
  const pages = [
    { loc: '/', priority: '1.0' },
    { loc: '/welcome', priority: '0.9' },
    { loc: '/real-time-voice', priority: '0.8' },
    { loc: '/privacy', priority: '0.4', lastmod: toIsoDate(privacy.lastUpdated) },
    { loc: '/terms', priority: '0.4', lastmod: toIsoDate(terms.lastUpdated) },
    { loc: '/support', priority: '0.5' },
  ]

  const urls = pages
    .map((page) => {
      const lastmod = page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : ''
      return `  <url>
    <loc>${SITE}${page.loc}</loc>${lastmod}
    <priority>${page.priority}</priority>
  </url>`
    })
    .join('\n')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
  writeFile('sitemap.xml', sitemap)

  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`
  writeFile('robots.txt', robots)
}

function copyStaticAssets() {
  const iconSrc = path.join(ROOT, 'assets/icon.png')
  const iconDest = path.join(PUBLIC_DIR, 'clanker-icon.png')
  if (!fs.existsSync(iconSrc)) {
    throw new Error(`Missing app icon for static pages: ${iconSrc}`)
  }
  fs.copyFileSync(iconSrc, iconDest)
  console.log('Copied assets/icon.png → public/clanker-icon.png')
}

function main() {
  console.log('Generating static public pages…')
  copyStaticAssets()
  const privacy = generatePrivacy()
  const terms = generateTerms()
  generateSitemap({ privacy, terms })
  console.log('Done.')
}

main()
