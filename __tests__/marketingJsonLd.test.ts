import fs from 'fs'
import path from 'path'

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public')

// /privacy and /terms are gitignored generated output, matching
// marketingBranding.test.ts.
const EXCLUDED_DIRS = new Set(['privacy', 'terms'])

function findHtmlFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) files.push(...findHtmlFiles(fullPath))
    } else if (entry.name.endsWith('.html')) {
      files.push(fullPath)
    }
  }
  return files
}

const PAGES = findHtmlFiles(PUBLIC_DIR).map((file) => ({
  relativePath: path.relative(PUBLIC_DIR, file),
  file,
}))

function extractJsonLdBlocks(html: string): string[] {
  return Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    (match) => match[1],
  )
}

/**
 * PR #639 shipped a trailing comma that made the /image-generation JSON-LD block
 * unparsable, silently dropping every rich result on the page. Every ld+json
 * block on every checked-in marketing page must be valid JSON.
 */
describe.each(PAGES)('marketing page $relativePath', ({ file }) => {
  const html = fs.readFileSync(file, 'utf8')

  it('has only JSON-LD blocks that parse as valid JSON', () => {
    extractJsonLdBlocks(html).forEach((block, index) => {
      try {
        JSON.parse(block)
      } catch (error) {
        throw new Error(`JSON-LD block ${index} is invalid JSON: ${(error as Error).message}`)
      }
    })
  })

  // Every checked-in marketing page ships JSON-LD; if the extractor stops
  // matching (e.g. the <script> tag gains an attribute), the parse check above
  // would silently pass over zero blocks instead of failing.
  it('yields at least one JSON-LD block so the parse check cannot silently skip', () => {
    expect(extractJsonLdBlocks(html).length).toBeGreaterThan(0)
  })
})

describe('marketing page JSON-LD discovery', () => {
  // Exact set (not arrayContaining): adding or removing a checked-in page
  // must force a conscious edit here, so a renamed or deleted page fails
  // loudly instead of silently dropping out of the parse checks above.
  it('finds exactly the checked-in pages so the parse checks cannot silently skip', () => {
    const relativePaths = PAGES.map(({ relativePath }) => relativePath).sort()
    expect(relativePaths).toEqual(
      [
        'advanced-memory',
        'image-generation',
        'memory-export-with-okf',
        'open-source',
        'privacy-mode',
        'real-time-voice',
        'support',
        'welcome',
      ].map((slug) => path.join(slug, 'index.html')),
    )
  })
})
