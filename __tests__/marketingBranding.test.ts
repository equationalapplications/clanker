import fs from 'fs'
import path from 'path'

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public')

/**
 * Marketing-page branding regression test.
 *
 * Encodes the acceptance criteria of
 * docs/superpowers/specs/2026-07-26-clanker-ai-rebrand-canonical-design.md.
 *
 * /privacy and /terms are deliberately excluded: they are gitignored generated
 * output and are out of scope for the rebrand.
 */
const PAGES = [
  { slug: 'welcome', title: 'Clanker AI — Personal AI Assistant with Real-Time Voice & OKF Memory' },
  { slug: 'real-time-voice', title: 'Live Real-Time Voice Calls — Clanker AI' },
  { slug: 'advanced-memory', title: 'Advanced AI Memory That Learns — Clanker AI' },
  {
    slug: 'privacy-mode',
    title: 'Enhanced Privacy Mode — Keep AI Memory On Your Device — Clanker AI',
  },
  { slug: 'open-source', title: 'Open Source — Clanker AI' },
  {
    slug: 'memory-export-with-okf',
    title: "Import & Export AI Character Memory with Google's OKF — Clanker AI",
  },
  { slug: 'support', title: 'Support & FAQ — Clanker AI' },
] as const

function readPage(slug: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, slug, 'index.html'), 'utf8')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/)
  if (!match) throw new Error('no <title> found')
  return decodeEntities(match[1].trim())
}

function extractMeta(html: string, attr: 'name' | 'property', key: string): string | null {
  const pattern = new RegExp(
    `<meta\\s+${attr}="${key}"\\s+content="([\\s\\S]*?)"\\s*/>`,
    'i'
  )
  const match = html.match(pattern)
  return match ? decodeEntities(match[1].trim()) : null
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(JSON.parse(decodeEntities(match[1])))
  }
  return blocks
}

/** Flattens a JSON-LD document (including `@graph`) into a list of nodes. */
function flattenNodes(value: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenNodes(item, acc))
    return acc
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    if (typeof node['@type'] === 'string') acc.push(node)
    Object.values(node).forEach((child) => flattenNodes(child, acc))
  }
  return acc
}

function allNodes(html: string): Record<string, unknown>[] {
  return extractJsonLdBlocks(html).flatMap((block) => flattenNodes(block))
}

describe.each(PAGES)('marketing page /$slug', ({ slug, title }) => {
  const html = readPage(slug)

  it('has the expected <title>', () => {
    expect(extractTitle(html)).toBe(title)
  })

  it('names the brand "Clanker AI" exactly once in the <title>', () => {
    const occurrences = extractTitle(html).split('Clanker AI').length - 1
    expect(occurrences).toBe(1)
  })

  it('has no bare "— Clanker" brand suffix anywhere', () => {
    expect(html).not.toMatch(/—\s*Clanker(?!\s*AI)/)
  })

  it('sets og:site_name to "Clanker AI"', () => {
    expect(extractMeta(html, 'property', 'og:site_name')).toBe('Clanker AI')
  })

  it('has a self-referential canonical and og:url', () => {
    expect(html).toContain(`<link rel="canonical" href="https://clanker-ai.com/${slug}" />`)
    expect(extractMeta(html, 'property', 'og:url')).toBe(
      `https://clanker-ai.com/${slug}`
    )
  })

  it('has valid JSON-LD with no bare-brand product text', () => {
    // Organization is the publisher (Equational Applications LLC), not the product.
    // VideoObject `name` is the literal title of a published YouTube video; renaming
    // it here would desync the schema from the actual video, so it is exempt.
    const exempt = new Set(['Organization', 'VideoObject'])
    const nodes = allNodes(html)
    expect(nodes.length).toBeGreaterThan(0)
    nodes.forEach((node) => {
      for (const field of ['name', 'description', 'text'] as const) {
        const value = node[field]
        const exemptName = field === 'name' && exempt.has(node['@type'] as string)
        if (typeof value === 'string' && !exemptName) {
          expect(value).not.toMatch(/\bClanker\b(?!\s*AI)/)
        }
      }
    })
  })

  it('names Equational Applications LLC on every Organization node', () => {
    allNodes(html)
      .filter((node) => node['@type'] === 'Organization')
      .forEach((node) => {
        expect(node.name).toBe('Equational Applications LLC')
      })
  })
})

describe('marketing pages as a whole', () => {
  const all = PAGES.map(({ slug }) => ({ slug, html: readPage(slug) }))

  it('declares exactly one SoftwareApplication, named "Clanker AI" with alternateName "Clanker"', () => {
    const apps = all.flatMap(({ html }) =>
      allNodes(html).filter((node) => node['@type'] === 'SoftwareApplication')
    )
    expect(apps).toHaveLength(1)
    expect(apps[0].name).toBe('Clanker AI')
    expect(apps[0].alternateName).toBe('Clanker')
  })

  it('has exactly one image alt attribute, reading "Clanker AI logo"', () => {
    const alts = all.flatMap(({ html }) => Array.from(html.matchAll(/alt="([^"]*)"/g), (m) => m[1]))
    expect(alts).toEqual(['Clanker AI logo'])
  })

  it('keeps the generator template and public/welcome in agreement on the hero alt', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'generate-static-pages.js'),
      'utf8'
    )
    expect(script).toContain('alt="Clanker AI logo"')
  })
})