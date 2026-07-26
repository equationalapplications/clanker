# Clanker AI Rebrand (Marketing Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `clanker-ai.com` brand itself "Clanker AI" with assistant-first positioning across every marketing page, so it holds canonical search authority for the product entity.

**Architecture:** Two editing paths. `/welcome` is generated from `src/config/landingConfig.ts` by `scripts/generate-static-pages.js` into the git-tracked `public/welcome/index.html` — edit config + script, then regenerate and commit the output. The six pillar pages (`/real-time-voice`, `/advanced-memory`, `/privacy-mode`, `/open-source`, `/memory-export-with-okf`, `/support`) are hand-written HTML edited in place. A new Jest regression test reads the built `public/` HTML and asserts the spec's acceptance criteria per page, so each task has a red→green gate.

**Tech Stack:** TypeScript config modules, a Node HTML generator (`scripts/generate-static-pages.js`), static HTML, JSON-LD schema.org, Jest (`npm test`).

**Spec:** `docs/superpowers/specs/2026-07-26-clanker-ai-rebrand-canonical-design.md`

---

## Ground Rules (read before any task)

1. **Never hand-edit `public/welcome/index.html`.** It is overwritten by `npm run generate:static-pages`. Change `src/config/landingConfig.ts` and/or `scripts/generate-static-pages.js`, then regenerate.
2. **Never touch these** — locked by spec decisions 3, 4, 5 and Out of Scope:
   - `<link rel="canonical">`, `og:url`, any URL, slug, or directory name.
   - `public/privacy/`, `public/terms/` (gitignored generated output) and the `renderDocPage` / `FOOTER` template in `scripts/generate-static-pages.js` around lines 214–285 that produces them. The `About Clanker` string at `scripts/generate-static-pages.js:217` and `og:site_name` at `:249` belong to that template — **leave them.**
   - Bundle IDs, package names, app config, SPA `<title>`, `assets/`, `clanker-icon.png` filename.
3. **Product-name rule for the six pillar pages:** replace every occurrence of the product name `Clanker` with `Clanker AI`, *except* where it would produce a doubled brand in a `<title>` (see the `/open-source` and `/support` tasks, where the leading brand is dropped instead). Never produce `Clanker AI AI`. Do not touch `clanker-ai.com`, `clanker-icon.png`, or repo/URL strings.
4. **Do not rewrite meta descriptions that are already accurate** just to insert the word "Clanker AI" (spec §3).
5. **Reading the edit tables:** where a `keywords` row is abbreviated with a leading `...`, the `...` stands for the untouched prefix of that comma-separated list. Only the quoted tail changes — leave the rest of the list byte-for-byte identical.
6. `sitemap.xml`, `robots.txt`, `public/privacy/`, `public/terms/`, `public/clanker-icon.png` are all gitignored. Only `public/welcome/index.html` is a tracked generator output — commit that one.

---

## File Structure

| File | Change | Owning task |
|---|---|---|
| `__tests__/marketingBranding.test.ts` | **Create** — per-page acceptance test over `public/` | 2 |
| `src/config/landingConfig.ts` | Modify — titles, meta, JSON-LD, hero, features, footer label | 3 |
| `scripts/generate-static-pages.js` | Modify — `alternateName` in the `/welcome` JSON-LD builder (`:485`ish), hero `alt` (`:560`) | 3 |
| `public/welcome/index.html` | Regenerated + committed | 3 |
| `public/real-time-voice/index.html` | Modify in place | 4 |
| `public/advanced-memory/index.html` | Modify in place | 5 |
| `public/privacy-mode/index.html` | Modify in place | 6 |
| `public/open-source/index.html` | Modify in place | 7 |
| `public/memory-export-with-okf/index.html` | Modify in place | 8 |
| `public/support/index.html` | Modify in place | 9 |
| `docs/superpowers/plans/2026-07-26-clanker-ai-rebrand.md` | This plan (already written) | 1 |

Line numbers below are from the pre-change files. If an earlier edit shifts them, match on the quoted string, not the number.

---

## Task 1: Create the feature branch

**Files:** none (git only)

- [ ] **Step 1: Fetch and branch from `origin/staging`**

`origin/staging` is ahead of the current `docs/clanker-ai-rebrand-spec` branch, so branch fresh from staging and bring the approved spec commit along. That way one PR carries spec + plan + implementation.

```bash
git fetch origin
git checkout -b feat/clanker-ai-rebrand origin/staging
git cherry-pick 8ec6e656
```

Expected: cherry-pick succeeds cleanly (the spec file is new, no conflict). If it reports "nothing to commit", the spec is already on staging — continue.

- [ ] **Step 2: Verify the spec and plan are present**

```bash
ls docs/superpowers/specs/2026-07-26-clanker-ai-rebrand-canonical-design.md
ls docs/superpowers/plans/2026-07-26-clanker-ai-rebrand.md
```

Expected: both paths print. If the plan file is missing (it was written on the old branch), copy it in from `docs/clanker-ai-rebrand-spec` before continuing:

```bash
git checkout docs/clanker-ai-rebrand-spec -- docs/superpowers/plans/2026-07-26-clanker-ai-rebrand.md
```

- [ ] **Step 3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-07-26-clanker-ai-rebrand.md
git commit -m "docs(seo): add implementation plan for Clanker AI marketing rebrand"
```

---

## Task 2: Write the failing acceptance test

**Files:**
- Create: `__tests__/marketingBranding.test.ts`

This test encodes the spec's Testing/Acceptance section. It is parameterized per page via `describe.each` so later tasks can run just their own page with `-t`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/marketingBranding.test.ts`:

```ts
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

  it('has a self-referential canonical', () => {
    expect(html).toContain(`<link rel="canonical" href="https://clanker-ai.com/${slug}" />`)
  })

  it('has valid JSON-LD with no bare-brand product name', () => {
    // Organization is the publisher (Equational Applications LLC), not the product.
    // VideoObject `name` is the literal title of a published YouTube video; renaming
    // it here would desync the schema from the actual video, so it is exempt.
    const exempt = new Set(['Organization', 'VideoObject'])
    const nodes = allNodes(html)
    expect(nodes.length).toBeGreaterThan(0)
    nodes.forEach((node) => {
      const name = node.name
      if (typeof name === 'string' && !exempt.has(node['@type'] as string)) {
        expect(name).not.toMatch(/\bClanker\b(?!\s*AI)/)
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- marketingBranding`

Expected: FAIL. Most `<title>` assertions fail with the current bare-`Clanker` titles, the `SoftwareApplication` assertion fails on `name: "Clanker"`, and the `alt` assertion fails on `alt="Clanker"`.

- [ ] **Step 3: Commit the failing test**

```bash
git add __tests__/marketingBranding.test.ts
git commit -m "test(seo): add marketing-page branding acceptance test"
```

---

## Task 3: `/welcome` — landingConfig, generator, regenerate

**Files:**
- Modify: `src/config/landingConfig.ts`
- Modify: `scripts/generate-static-pages.js:485`ish (JSON-LD builder), `scripts/generate-static-pages.js:560` (hero `alt`)
- Regenerate: `public/welcome/index.html`

- [ ] **Step 1: Update `SITE_META` in `src/config/landingConfig.ts`**

Replace lines 7–18 with:

```ts
export const SITE_META = {
  title: 'Clanker AI — Personal AI Assistant with Real-Time Voice & OKF Memory',
  description:
    "Clanker AI is a personal AI assistant with a personality you design and a memory that never forgets — real-time voice calls, document understanding, live web search, and OKF memory you own and export.",
  keywords:
    'personal AI assistant, Clanker AI, real-time voice AI, AI voice chat, Open Knowledge Format, OKF, Google OKF, AI memory, Obsidian AI, AI characters, export AI character, AI companion, voice assistant',
  canonicalPath: '/welcome',
  ogImage: `${SITE_BASE}/og-image.png`,
  ogImageWidth: 1024,
  ogImageHeight: 500,
  siteName: 'Clanker AI',
} as const
```

`canonicalPath` is unchanged (spec decision 4). "AI characters" and "AI companion" stay in `keywords` — demoted, not dropped (spec Risks).

- [ ] **Step 2: Update `JSONLD` in `src/config/landingConfig.ts`**

Replace lines 20–26 (the opening of `softwareApplication` through its `description`) with:

```ts
export const JSONLD = {
  softwareApplication: {
    name: 'Clanker AI',
    alternateName: 'Clanker',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'iOS, Android, Web',
    description:
      "A personal AI assistant with a personality you design and a memory that never forgets. Talk to it in real time with natural, human-like voice, and it learns from your conversations, documents, and live web search. Own your assistant's memory with Google's Open Knowledge Format (OKF), editable in Obsidian.",
```

`applicationCategory` stays `LifestyleApplication` — it must match the business site (spec §5). `featureList` and `offers` are unchanged.

Then replace line 43 (the `videoObject.description`) with:

```ts
      'See how Clanker AI combines real-time voice, OKF memory export, and advanced learning in one open-source personal AI assistant.',
```

Leave `videoObject.name` (line 41) alone — it is the literal title of the published YouTube video, and changing the schema without changing the video would desync them.

- [ ] **Step 3: Update `HERO`, `FEATURES`, `VIDEO`, and `FOOTER_LINKS`**

In `src/config/landingConfig.ts`:

Line 61–62:

```ts
  headline: 'Clanker AI',
  tagline: 'A personal AI assistant you design — chat, call, and share your own AI characters',
```

Line 116 (the "Completely Open Source" feature body):

```ts
    body: "Clanker AI's code is public on GitHub. Verify how your data is handled, suggest features, or contribute — built by and for its users.",
```

Line 129 (the "Real AI Conversations" feature body):

```ts
    body: 'Chat with characters that actually remember their personality. Long conversation memory is automatically summarized so your assistant stays in character.',
```

Lines 141–142:

```ts
  heading: 'See Clanker AI in action',
  iframeTitle: 'Clanker AI demo',
```

Line 161:

```ts
  { label: 'About Clanker AI', href: '/welcome' },
```

`FEATURES_SECTION.title` and `staticTitle` contain no product name — leave both unchanged.

- [ ] **Step 4: Emit `alternateName` from the generator**

`scripts/generate-static-pages.js` builds the `/welcome` JSON-LD field-by-field, so a new config key is dropped unless the builder reads it. In `generateWelcome`, inside the `SoftwareApplication` object, add the `alternateName` line directly after `name`:

```js
      {
        '@type': 'SoftwareApplication',
        name: JSONLD.softwareApplication.name,
        alternateName: JSONLD.softwareApplication.alternateName,
        applicationCategory: JSONLD.softwareApplication.applicationCategory,
```

- [ ] **Step 5: Fix the hero image alt text in the generator**

`scripts/generate-static-pages.js:560` — the alt is hardcoded in the template, not driven by config. Replace:

```js
          <img src="/clanker-icon.png" alt="Clanker" width="120" height="120" />
```

with:

```js
          <img src="/clanker-icon.png" alt="Clanker AI logo" width="120" height="120" />
```

There is exactly one other `alt="Clanker"` occurrence in the script family — the one at `:560` is the `/welcome` hero. Do **not** change anything in the `renderDocPage` template (privacy/terms, out of scope).

- [ ] **Step 6: Regenerate the static pages**

```bash
npm run generate:static-pages
```

Expected: exits 0, prints `✓ public/welcome/index.html`, `✓ public/privacy/index.html`, `✓ public/terms/index.html`, `✓ public/sitemap.xml`, `✓ public/robots.txt`, and `Copied assets/icon.png → public/clanker-icon.png`.

- [ ] **Step 7: Verify the sitemap URL set is unchanged**

```bash
grep -c '<loc>' public/sitemap.xml
grep -o '<loc>[^<]*</loc>' public/sitemap.xml
```

Expected: 9 `<loc>` entries, covering `/welcome`, `/real-time-voice`, `/memory-export-with-okf`, `/advanced-memory`, `/open-source`, `/privacy-mode`, `/privacy`, `/terms`, `/support` — the same set as before. No slug changed.

- [ ] **Step 8: Run the welcome page tests**

Run: `npm test -- marketingBranding -t "welcome"`

Expected: the `/welcome` describe block PASSES (title, single-brand, no bare suffix, og:site_name, canonical, JSON-LD, Organization). Other pages still fail — that is expected until Tasks 4–9.

- [ ] **Step 9: Confirm the existing landing tests still pass**

The React landing page reads the same `HERO` and `FOOTER_LINKS` constants.

Run: `npm test -- landingFooterAccessibility landingHeroSectionWebNavigation`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/config/landingConfig.ts scripts/generate-static-pages.js public/welcome/index.html
git commit -m "feat(seo): rebrand /welcome to Clanker AI with assistant-first positioning"
```

Note: `public/sitemap.xml`, `public/robots.txt`, `public/privacy/`, `public/terms/`, and `public/clanker-icon.png` are gitignored and will not appear in the commit. That is correct.

---

## Task 4: `/real-time-voice`

**Files:**
- Modify: `public/real-time-voice/index.html`

- [ ] **Step 1: Update the head metadata**

In `public/real-time-voice/index.html`, apply these exact replacements:

| Line | Old | New |
|---|---|---|
| 6 | `<title>Live Real-Time Voice Calls — Clanker</title>` | `<title>Live Real-Time Voice Calls — Clanker AI</title>` |
| 13 | `... live voice assistant, Clanker"` | `... live voice assistant, Clanker AI, Clanker"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 20 | `<meta property="og:title" content="Clanker — Live Real-Time Voice Calls" />` | `<meta property="og:title" content="Clanker AI — Live Real-Time Voice Calls" />` |
| 30 | `<meta name="twitter:title" content="Clanker — Live Real-Time Voice Calls" />` | `<meta name="twitter:title" content="Clanker AI — Live Real-Time Voice Calls" />` |

The `keywords` retains the bare `Clanker` as a trailing term — that is deliberate old-brand query equity, and the test only forbids a bare `— Clanker` suffix.

Leave `<meta name="description">`, `og:description`, and `twitter:description` unchanged — they are accurate and contain no product name (spec §3: do not rewrite an accurate description just to insert the word). Leave `canonical` and `og:url` alone.

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 43 | `"name": "Clanker — Live Real-Time Voice Calls",` | `"name": "Clanker AI — Live Real-Time Voice Calls",` |
| 48 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |
| 54 | `"name": "Converse naturally with Clanker from Equational Applications LLC",` | `"name": "Converse naturally with Clanker AI from Equational Applications LLC",` |
| 55 | `"description": "See Clanker's live real-time voice calls — natural phone-call conversations with hands-free speakerphone and live tools.",` | `"description": "See Clanker AI's live real-time voice calls — natural phone-call conversations with hands-free speakerphone and live tools.",` |

Leave the `"@type": "Organization"` node at line 61 completely alone — it is the publisher, `Equational Applications LLC` (spec §5).

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 327 | `<a class="back-link" href="/">← Back to Clanker</a>` | `<a class="back-link" href="/">← Back to Clanker AI</a>` |
| 343 | `title="Clanker real-time voice demo"` | `title="Clanker AI real-time voice demo"` |
| 407 | `Clanker's code is public on GitHub. Verify privacy claims, suggest features, or` | `Clanker AI's code is public on GitHub. Verify privacy claims, suggest features, or` |
| 421 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

- [ ] **Step 4: Verify no bare product name remains**

```bash
grep -n 'Clanker' public/real-time-voice/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com' | grep -v 'clanker-icon'
```

Expected: exactly one line — the trailing `Clanker` term in the line 13 `keywords` list. Nothing else.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "real-time-voice"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/real-time-voice/index.html
git commit -m "feat(seo): rebrand /real-time-voice to Clanker AI"
```

---

## Task 5: `/advanced-memory`

**Files:**
- Modify: `public/advanced-memory/index.html`

- [ ] **Step 1: Update the head metadata**

| Line | Old | New |
|---|---|---|
| 6 | `<title>Advanced AI Memory That Learns — Clanker</title>` | `<title>Advanced AI Memory That Learns — Clanker AI</title>` |
| 13 | `... Open Knowledge Format, OKF, Clanker"` | `... Open Knowledge Format, OKF, Clanker AI, Clanker"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 20 | `<meta property="og:title" content="Clanker — Advanced AI Memory That Learns" />` | `<meta property="og:title" content="Clanker AI — Advanced AI Memory That Learns" />` |
| 30 | `<meta name="twitter:title" content="Clanker — Advanced AI Memory That Learns" />` | `<meta name="twitter:title" content="Clanker AI — Advanced AI Memory That Learns" />` |

Descriptions contain no product name and are accurate — leave them. Leave `canonical` and `og:url`.

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 41 | `"name": "Clanker — Advanced AI Memory That Learns",` | `"name": "Clanker AI — Advanced AI Memory That Learns",` |
| 46 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 269 | `<a class="back-link" href="/welcome">← Back to Clanker</a>` | `<a class="back-link" href="/welcome">← Back to Clanker AI</a>` |
| 272 | `Your Clanker characters don't just chat — they remember. Every conversation, uploaded` | `Your Clanker AI characters don't just chat — they remember. Every conversation, uploaded` |
| 318 | `prompt with a wall of pasted history. Clanker is different. Its local-first` | `prompt with a wall of pasted history. Clanker AI is different. Its local-first` |
| 339 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

- [ ] **Step 4: Verify no bare product name remains**

```bash
grep -n 'Clanker' public/advanced-memory/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com'
```

Expected: exactly one line — the trailing `Clanker` keyword on line 13.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "advanced-memory"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/advanced-memory/index.html
git commit -m "feat(seo): rebrand /advanced-memory to Clanker AI"
```

---

## Task 6: `/privacy-mode`

**Files:**
- Modify: `public/privacy-mode/index.html`

Note: this page is `/privacy-mode`, a hand-maintained pillar page. It is **not** `/privacy`, which is generated and out of scope. Do not confuse them.

- [ ] **Step 1: Update the head metadata**

| Line | Old | New |
|---|---|---|
| 6 | `<title>Enhanced Privacy Mode — Keep AI Memory On Your Device — Clanker</title>` | `<title>Enhanced Privacy Mode — Keep AI Memory On Your Device — Clanker AI</title>` |
| 9 | `... never stored in Clanker's cloud database."` | `... never stored in Clanker AI's cloud database."` |
| 13 | `... local-first AI, Clanker"` | `... local-first AI, Clanker AI, Clanker"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 20 | `<meta property="og:title" content="Clanker — Enhanced Privacy Mode (On-Device AI Memory)" />` | `<meta property="og:title" content="Clanker AI — Enhanced Privacy Mode (On-Device AI Memory)" />` |
| 23 | `... never stored in Clanker's cloud database."` (og:description) | `... never stored in Clanker AI's cloud database."` |
| 30 | `<meta name="twitter:title" content="Clanker — Enhanced Privacy Mode (On-Device AI Memory)" />` | `<meta name="twitter:title" content="Clanker AI — Enhanced Privacy Mode (On-Device AI Memory)" />` |
| 33 | `... never stored in Clanker's cloud database."` (twitter:description) | `... never stored in Clanker AI's cloud database."` |

Lines 9, 23, and 33 are identical strings in three different meta tags — all three change. Here the description *does* name the product, so it is rewritten (it is not the "already accurate, don't touch" case).

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 41 | `"name": "Clanker — Enhanced Privacy Mode",` | `"name": "Clanker AI — Enhanced Privacy Mode",` |
| 42 | `"description": "Run your AI character with cloud sync off so its memories and chat history stay strictly on your device and are never stored in Clanker's cloud database.",` | `"description": "Run your AI character with cloud sync off so its memories and chat history stay strictly on your device and are never stored in Clanker AI's cloud database.",` |
| 46 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 287 | `<a class="back-link" href="/welcome">← Back to Clanker</a>` | `<a class="back-link" href="/welcome">← Back to Clanker AI</a>` |
| 292 | `in Clanker's cloud database. Your character, your data, your device.` | `in Clanker AI's cloud database. Your character, your data, your device.` |
| 335 | `Every Clanker character has a <strong>Save to Cloud</strong> switch in its settings. Leave` | `Every Clanker AI character has a <strong>Save to Cloud</strong> switch in its settings. Leave` |
| 337 | `to your device's local storage, and are never copied into Clanker's cloud database or` | `to your device's local storage, and are never copied into Clanker AI's cloud database or` |
| 352 | `<strong>processed, not persisted</strong>: it is not saved to Clanker's cloud database,` | `<strong>processed, not persisted</strong>: it is not saved to Clanker AI's cloud database,` |
| 370 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

- [ ] **Step 4: Verify no bare product name remains**

```bash
grep -n 'Clanker' public/privacy-mode/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com'
```

Expected: exactly one line — the trailing `Clanker` keyword on line 13.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "privacy-mode"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/privacy-mode/index.html
git commit -m "feat(seo): rebrand /privacy-mode to Clanker AI"
```

---

## Task 7: `/open-source` (title collision)

**Files:**
- Modify: `public/open-source/index.html`

Spec decision 6 is locked: the `<title>` becomes **`Open Source — Clanker AI`**, dropping the leading brand. `Clanker AI is Open Source — Clanker AI` would read as keyword stuffing. The `<h1>` keeps the leading brand.

- [ ] **Step 1: Update the head metadata**

| Line | Old | New |
|---|---|---|
| 6 | `<title>Clanker is Open Source — Clanker</title>` | `<title>Open Source — Clanker AI</title>` |
| 9 | `content="Clanker is open source. Verify our privacy claims, join the community, and help shape the future of AI character interactions."` | `content="Clanker AI is open source. Verify our privacy claims, join the community, and help shape the future of AI character interactions."` |
| 13 | `content="open source AI, open source AI app, Clanker GitHub, AI character open source, transparent AI, self-hosted AI, community-driven AI, Clanker"` | `content="open source AI, open source AI app, Clanker AI GitHub, AI character open source, transparent AI, self-hosted AI, community-driven AI, Clanker AI, Clanker"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 20 | `<meta property="og:title" content="Clanker is Open Source" />` | `<meta property="og:title" content="Clanker AI is Open Source" />` |
| 30 | `<meta name="twitter:title" content="Clanker is Open Source" />` | `<meta name="twitter:title" content="Clanker AI is Open Source" />` |

The OG/Twitter titles keep the leading brand because they carry no `— Clanker AI` suffix, so there is no doubling. `og:description` and `twitter:description` name no product — leave them.

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 41 | `"name": "Clanker is Open Source",` | `"name": "Clanker AI is Open Source",` |
| 42 | `"description": "Clanker is completely open source — built in the open so users can verify privacy, trust longevity, and join the community shaping AI character interactions.",` | `"description": "Clanker AI is completely open source — built in the open so users can verify privacy, trust longevity, and join the community shaping AI character interactions.",` |
| 46 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 350 | `<a class="back-link" href="/welcome">← Back to Clanker</a>` | `<a class="back-link" href="/welcome">← Back to Clanker AI</a>` |
| 351 | `<h1 id="page-title">Clanker is Open Source</h1>` | `<h1 id="page-title">Clanker AI is Open Source</h1>` |
| 397 | `Suggest features, report bugs, or even contribute code. Clanker is built by and` | `Suggest features, report bugs, or even contribute code. Clanker AI is built by and` |
| 405 | `Open source means Clanker can never truly disappear. The code belongs to the` | `Open source means Clanker AI can never truly disappear. The code belongs to the` |
| 417 | `and run your own local instance of Clanker.` | `and run your own local instance of Clanker AI.` |
| 428 | `privacy and data handling without ever seeing what happens behind the scenes. Clanker` | `privacy and data handling without ever seeing what happens behind the scenes. Clanker AI` |
| 446 | `>. It helps others discover Clanker and tells us you're excited about what we're` | `>. It helps others discover Clanker AI and tells us you're excited about what we're` |
| 476 | `how Clanker works.` | `how Clanker AI works.` |
| 514 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

- [ ] **Step 4: Verify the title and that no bare product name remains**

```bash
grep -n '<title>' public/open-source/index.html
grep -n 'Clanker' public/open-source/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com'
```

Expected: the title line reads exactly `<title>Open Source — Clanker AI</title>`, and the second grep returns exactly one line — the trailing `Clanker` keyword on line 13.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "open-source"`

Expected: PASS, including the "exactly once in the <title>" assertion.

- [ ] **Step 6: Commit**

```bash
git add public/open-source/index.html
git commit -m "feat(seo): rebrand /open-source to Clanker AI and fix title collision"
```

---

## Task 8: `/memory-export-with-okf`

**Files:**
- Modify: `public/memory-export-with-okf/index.html`

- [ ] **Step 1: Update the head metadata**

| Line | Old | New |
|---|---|---|
| 6 | `<title>Import &amp; Export AI Character Memory with Google's OKF — Clanker</title>` | `<title>Import &amp; Export AI Character Memory with Google's OKF — Clanker AI</title>` |
| 9 | `content="Export and restore your Clanker character's memory with Google's OKF — portable Markdown you can back up, edit in Obsidian, and clone."` | `content="Export and restore your Clanker AI character's memory with Google's OKF — portable Markdown you can back up, edit in Obsidian, and clone."` |
| 13 | `... portable AI knowledge, Clanker"` | `... portable AI knowledge, Clanker AI, Clanker"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 23 | `content="Export and restore your Clanker character's memory with Google's OKF — portable Markdown you can back up, edit in Obsidian, and clone."` (og:description) | `content="Export and restore your Clanker AI character's memory with Google's OKF — portable Markdown you can back up, edit in Obsidian, and clone."` |
| 33 | same string again (twitter:description) | same replacement — lines 9, 23, and 33 are three copies of one sentence; all three change |

`og:title` and `twitter:title` on this page read `Import &amp; Export AI Character Memory with Google's OKF` with no brand suffix — since only the suffix changed on the `<title>`, leave both as they are.

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 44 | `"description": "How to back up, restore, clone, and edit your Clanker AI character's memory using OKF ..."` | **unchanged** — already reads `Clanker AI` |
| 48 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |
| 54 | `"name": "Portable AI Brains through Open Knowledge Format (OKF) and Clanker by Equational Applications LLC",` | `"name": "Portable AI Brains through Open Knowledge Format (OKF) and Clanker AI by Equational Applications LLC",` |
| 55 | `"description": "See how Clanker uses Google's Open Knowledge Format (OKF) to export, edit, and restore your AI character's memory as portable Markdown.",` | `"description": "See how Clanker AI uses Google's Open Knowledge Format (OKF) to export, edit, and restore your AI character's memory as portable Markdown.",` |

Leave the `"@type": "Organization"` publisher node at line 61 alone.

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 328 | `<a class="back-link" href="/welcome">← Back to Clanker</a>` | `<a class="back-link" href="/welcome">← Back to Clanker AI</a>` |
| 343 | `title="Portable AI Brains through Open Knowledge Format (OKF) and Clanker by Equational Applications LLC"` | `title="Portable AI Brains through Open Knowledge Format (OKF) and Clanker AI by Equational Applications LLC"` |
| 404 | `and AI agents without any proprietary account, SDK, or translation layer. Clanker` | `and AI agents without any proprietary account, SDK, or translation layer. Clanker AI` |
| 422 | `summaries from other OKF tools survive a round-trip through Clanker.` | `summaries from other OKF tools survive a round-trip through Clanker AI.` |
| 444 | `Clanker to apply your changes. Unzip and open the files in:` | `Clanker AI to apply your changes. Unzip and open the files in:` |
| 471 | `Bring a bundle back into Clanker two ways: <strong>restore</strong> it into` | `Bring a bundle back into Clanker AI two ways: <strong>restore</strong> it into` |
| 508 | `Clanker's code is public on GitHub. Verify privacy claims, suggest features, or` | `Clanker AI's code is public on GitHub. Verify privacy claims, suggest features, or` |
| 522 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

- [ ] **Step 4: Verify no bare product name remains**

```bash
grep -n 'Clanker' public/memory-export-with-okf/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com'
```

Expected: exactly one line — the trailing `Clanker` keyword on line 13.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "memory-export-with-okf"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/memory-export-with-okf/index.html
git commit -m "feat(seo): rebrand /memory-export-with-okf to Clanker AI"
```

---

## Task 9: `/support`

**Files:**
- Modify: `public/support/index.html`

`Clanker Support & FAQ — Clanker` has the same doubled-brand problem as `/open-source`. Applying decision 6's rule, the `<title>` drops the leading brand: **`Support &amp; FAQ — Clanker AI`**. The `<h1>` keeps the brand.

- [ ] **Step 1: Update the head metadata**

| Line | Old | New |
|---|---|---|
| 6 | `<title>Clanker Support &amp; FAQ — Clanker</title>` | `<title>Support &amp; FAQ — Clanker AI</title>` |
| 9 | `content="Clanker support and FAQ: credits, subscriptions, voice replies, sign-in, account deletion, and exporting character memory with OKF."` | `content="Clanker AI support and FAQ: credits, subscriptions, voice replies, sign-in, account deletion, and exporting character memory with OKF."` |
| 13 | `content="Clanker support, Clanker FAQ, AI app credits, Clanker subscription, export AI memory, OKF backup, Clanker help"` | `content="Clanker AI support, Clanker AI FAQ, AI app credits, Clanker AI subscription, export AI memory, OKF backup, Clanker help"` |
| 18 | `<meta property="og:site_name" content="Clanker" />` | `<meta property="og:site_name" content="Clanker AI" />` |
| 20 | `<meta property="og:title" content="Clanker Support &amp; FAQ" />` | `<meta property="og:title" content="Clanker AI Support &amp; FAQ" />` |
| 30 | `<meta name="twitter:title" content="Clanker Support &amp; FAQ" />` | `<meta name="twitter:title" content="Clanker AI Support &amp; FAQ" />` |

Line 13 keeps a single trailing bare `Clanker help` term for old-brand query equity. `og:description` / `twitter:description` name no product — leave them.

- [ ] **Step 2: Update the JSON-LD**

| Line | Old | New |
|---|---|---|
| 41 | `"name": "Clanker Support & FAQ",` | `"name": "Clanker AI Support & FAQ",` |
| 42 | `"description": "Frequently asked questions about Clanker credits, subscriptions, voice, sign-in, and OKF memory export.",` | `"description": "Frequently asked questions about Clanker AI credits, subscriptions, voice, sign-in, and OKF memory export.",` |
| 46 | `"name": "Clanker",` (inside `"@type": "WebSite"`) | `"name": "Clanker AI",` |
| 87 | `"text": "Open Clanker and choose Google or Apple sign-in. Use the same provider each time so your account data loads correctly."` | `"text": "Open Clanker AI and choose Google or Apple sign-in. Use the same provider each time so your account data loads correctly."` |

- [ ] **Step 3: Update the visible copy**

| Line | Old | New |
|---|---|---|
| 257 | `<a class="back-link" href="/welcome">← Back to Clanker</a>` | `<a class="back-link" href="/welcome">← Back to Clanker AI</a>` |
| 258 | `<h1 id="page-title">Clanker Support</h1>` | `<h1 id="page-title">Clanker AI Support</h1>` |
| 306 | `Open Clanker and choose Google or Apple sign-in. Use the same provider each time so your` | `Open Clanker AI and choose Google or Apple sign-in. Use the same provider each time so your` |
| 326 | `<a href="/welcome">About Clanker</a>` | `<a href="/welcome">About Clanker AI</a>` |

The FAQ answer at line 306 and the JSON-LD `answerText` at line 87 must stay in sync — change both.

- [ ] **Step 4: Verify the title and that no bare product name remains**

```bash
grep -n '<title>' public/support/index.html
grep -n 'Clanker' public/support/index.html | grep -v 'Clanker AI' | grep -v 'clanker-ai.com'
```

Expected: the title reads exactly `<title>Support &amp; FAQ — Clanker AI</title>`, and the second grep returns exactly one line — the `Clanker help` keyword on line 13.

- [ ] **Step 5: Run the page test**

Run: `npm test -- marketingBranding -t "support"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/support/index.html
git commit -m "feat(seo): rebrand /support to Clanker AI and fix title collision"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the generator output is still in sync**

The config was edited in Task 3; re-run the generator to prove `public/welcome/index.html` has no drift.

```bash
npm run generate:static-pages
git diff --stat public/welcome/index.html
```

Expected: exits 0, and `git diff --stat` prints **nothing** — the committed file already matches the generator output. If it prints a diff, commit the regenerated file before continuing.

- [ ] **Step 2: Run the full branding test suite**

Run: `npm test -- marketingBranding`

Expected: PASS, all describe blocks, including the three whole-site assertions (one `SoftwareApplication` named `Clanker AI` with `alternateName: "Clanker"`; exactly one `alt="Clanker AI logo"`; generator script agrees on the alt).

- [ ] **Step 3: Run the acceptance greps from the spec**

```bash
grep -rn '— Clanker<' public/ ; echo "exit=$?"
grep -rn 'alt="' public/
grep -rno '<title>[^<]*</title>' public/*/index.html
```

Expected:
- The first grep prints nothing and reports `exit=1` (no matches) — no bare-brand title suffix remains.
- The second returns exactly one hit: `public/welcome/index.html:...: <img src="/clanker-icon.png" alt="Clanker AI logo" ... />`.
- Every title printed contains `Clanker AI` exactly once. `/privacy` and `/terms` titles still read `— Clanker`; that is expected and out of scope.

- [ ] **Step 4: Confirm canonicals are untouched**

```bash
git diff origin/staging -- public/ | grep -E '^[+-].*(canonical|og:url)'
```

Expected: prints nothing. No canonical or `og:url` line changed.

- [ ] **Step 5: Validate the JSON-LD**

The test already parses every block, but the Rich Results check catches schema-level problems the parser cannot.

Paste the `<script type="application/ld+json">` contents of `public/welcome/index.html`, `public/real-time-voice/index.html`, and `public/support/index.html` into https://search.google.com/test/rich-results (Code tab).

Expected: `SoftwareApplication`, `VideoObject`, `FAQPage`, and `Organization` are all detected with no errors.

- [ ] **Step 6: Spot-check three pages visually**

```bash
npx serve public -l 4321
```

Open `http://localhost:4321/welcome`, `/open-source`, and `/support`. Confirm: no doubled `Clanker AI AI`, no leftover bare `Clanker` used as a product name in an `<h1>` or nav/footer link, and the hero logo still renders on `/welcome`.

Stop the server with Ctrl-C when done.

- [ ] **Step 7: Run the broader test suite for regressions**

Run: `npm test -- landingFooterAccessibility landingHeroSectionWebNavigation marketingBranding`

Expected: PASS. These are the tests that read `landingConfig.ts`.

---

## Task 11: Open the PR into `staging`

**Files:** none (git only)

Per `docs/GIT_WORKFLOW.md`, PRs target `staging`, not `main`.

- [ ] **Step 1: Review the full diff**

```bash
git diff origin/staging --stat
```

Expected files: the spec, this plan, `__tests__/marketingBranding.test.ts`, `src/config/landingConfig.ts`, `scripts/generate-static-pages.js`, and seven `public/*/index.html` files. Nothing under `public/privacy/`, `public/terms/`, `public/sitemap.xml`, or `public/robots.txt` — those are gitignored.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/clanker-ai-rebrand
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base staging --title "feat(seo): rebrand marketing pages to Clanker AI" --body "$(cat <<'EOF'
Implements `docs/superpowers/specs/2026-07-26-clanker-ai-rebrand-canonical-design.md`.

Makes `clanker-ai.com` the canonical, correctly-branded home of **Clanker AI**, with assistant-first positioning matching the business site.

## What changed
- `/welcome`: `landingConfig.ts` titles, description, keywords, JSON-LD, hero, feature copy, footer label; generator now emits `alternateName: "Clanker"` on the `SoftwareApplication` and the hero `alt` reads `Clanker AI logo`. `public/welcome/index.html` regenerated and committed.
- Six hand-maintained pillar pages rebranded: titles, OG/Twitter meta, JSON-LD `name`/`description`, visible headings, nav and footer.
- `/open-source` and `/support` drop the leading brand from `<title>` rather than doubling it (spec decision 6): `Open Source — Clanker AI`, `Support & FAQ — Clanker AI`.
- New `__tests__/marketingBranding.test.ts` locks the acceptance criteria in as a regression test.

## Deliberately unchanged
Canonicals, `og:url`, all slugs, bundle IDs, package names, the SPA title, `/privacy` and `/terms` (generated, out of scope), and the `Organization` publisher nodes.

## Sequencing
Ship this **before or alongside** the companion spec in `equationalapplications.com`, which cedes "Clanker AI" search authority to these pages.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm CI is green**

```bash
gh pr checks --watch
```

Expected: all checks pass. If a check fails, fix on this branch and push — do not merge red.

- [ ] **Step 5: Merge once approved**

```bash
gh pr merge --squash
```

Do not merge without the user's go-ahead.

---

## Post-merge follow-ups (not part of this PR)

- The published YouTube video titles still say "Clanker" (`Clanker vs. The Rest: The Ultimate Hybrid AI Architecture`, `Converse naturally with Clanker from Equational Applications LLC`). The JSON-LD on `/real-time-voice` now says "Clanker AI" while the video title does not. Renaming on YouTube is a manual step outside this repo.
- After the companion `equationalapplications.com` spec deploys, verify that exactly one `SoftwareApplication` entity exists across both domains — this repo's (spec §5).
