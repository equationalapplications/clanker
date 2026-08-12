# Landing page content unification (`/` and `/welcome`)

**Status:** Implemented

## Problem

`/` (Expo Router SPA entry, `app/index.web.tsx` → `src/components/LandingPage/`) and `/welcome`
(hand-written static HTML at `public/welcome/index.html`, not currently touched by
`scripts/generate-static-pages.js`) both pitch the same product with independently maintained
copy. They have drifted:

- Static `/welcome` has a YouTube demo embed and an "Open Source" feature card; React
  `LandingPage` has neither.
- React `LandingPage` has a "Coming Soon" section; static has none.
- `LandingFooter.tsx` (React) links only Real-Time Voice / Terms / Privacy / Equational
  Applications LLC / Cookie Preferences; the static footer also links OKF Memory, Advanced
  Memory, Privacy Mode, Open Source, Support, and a self-link to `/welcome`.
- SEO meta tags (title, description, keywords, og:_, twitter:_) are hardcoded identically in
  both `app/index.web.tsx`'s `<Head>` and `public/welcome/index.html`'s `<head>` — copy-pasted,
  will silently drift on the next edit.
- JSON-LD (`SoftwareApplication` + `VideoObject`) exists only in the static page.

## Constraint (why routes don't change)

`/` must remain the Expo Router SPA entry — `expo export` generates the web bundle's boot HTML
at that path, and `app/index.web.tsx` does client-side auth routing (redirect signed-in users to
`/chat`, render `LandingPage` for signed-out users). Replacing it with static marketing HTML
would break app boot. `/welcome` is a deliberate static, JS-free page built for crawlers
(Firebase Hosting serves static files under `public/`/`dist/` before the SPA catch-all rewrite in
`firebase.json`). `/`'s canonical tag already points to `/welcome`, handing SEO authority there.
Both stay as-is — only the **content duplication** is fixed.

## Design

Follow the pattern already used for `/privacy` and `/terms`: content lives once in a config
module, read by both a static generator and an Expo Router screen.

### 1. `src/config/landingConfig.ts` (new)

Single source of truth:

- `SITE_META` — title, description, keywords, og/twitter fields, canonical path (`/welcome`,
  unchanged), absolute og-image URL + dimensions
- `JSONLD` — `SoftwareApplication` + `VideoObject` data (static-generator-only consumer, see
  below)
- `HERO` — announcement pill text/href, headline, tagline, CTA label (signed-in vs signed-out),
  sign-in button label
- `FEATURES[]` — `{ icon: string, emoji: string, title, body, learnMoreHref?,
isNew? }` — includes a new "Open Source" entry (`/open-source`) that today only exists in the
  static page
- `VIDEO` — YouTube video id, section heading, and iframe title
- `FOOTER_LINKS[]` — full link set: Real-Time Voice, OKF Memory, Advanced Memory, Privacy Mode,
  Open Source, Support, Terms, Privacy, `/welcome` (self-link, "About Clanker"), Equational
  Applications LLC (external)

Coming Soon content is **not** ported anywhere — dropped per decision below.

### 2. React side (`src/components/LandingPage/`)

- `HeroSection.tsx`, `FeaturesSection.tsx`, `LandingFooter.tsx` — read copy from
  `landingConfig.ts` instead of inline strings/arrays. Animation/style code unchanged.
- New `VideoSection.tsx` — renders the YouTube `<iframe>` directly (no `Platform.OS` guard
  needed — `LandingPage` and everything under it is only ever mounted from
  `app/index.web.tsx`, never on native; confirmed no other importer exists). Inserted between
  Hero and Features in `LandingPage/index.tsx`.
- Delete `ComingSoonSection.tsx` and its import/usage in `LandingPage/index.tsx`.
  `useFloatingCardAnimation` hook stays — still used by `FeaturesSection`.
- `app/index.web.tsx` — `<Head>` tags (title/description/keywords/og/twitter) pull from
  `SITE_META` instead of hardcoded duplicate strings. Canonical still points to `/welcome`
  (unchanged). **JSON-LD is not added here** — it doesn't exist on this page today, adding it
  provides no de-duplication benefit since canonical already defers to `/welcome`, and it would
  require `dangerouslySetInnerHTML` to avoid React's HTML-entity-escaping corrupting the
  embedded JSON on server-render. Out of scope.

### 3. Static side (`scripts/generate-static-pages.js`)

- New `generateWelcome()` function (same shape as `generatePrivacy`/`generateTerms`): builds
  `public/welcome/index.html` from `landingConfig.ts` (via the existing TS-transpile
  `loadTsModule` loader), including the `JSONLD` block. Existing hand-rolled CSS shell
  (`SHARED_CSS`-adjacent styles currently inline in the welcome page) stays as the template —
  only the content substituted into it changes.
- Called from `main()`.
- Sitemap generation is unchanged (already tracks `/welcome`'s file mtime for `<lastmod>`).

### 4. Checklist items (not full sub-designs, but must be verified during implementation)

- After adding the "Open Source" card and removing Coming Soon, confirm the static page's
  hardcoded `.grid`/`.card` CSS still lays out cleanly with the new card count (7 feature cards,
  not 6) and no leftover Coming Soon–specific styles/markup remain.
- Confirm `VideoSection.tsx` end-to-end: iframe loads, doesn't break scroll layout, accessible
  (aria-label / title on iframe, matches static page's `title="Clanker demo"`).

### 5. Tests

- Delete `__tests__/comingSoonSectionAccessibility.test.tsx`
- Update `__tests__/heroSectionAccessibility.test.tsx`,
  `__tests__/featuresSectionAccessibility.test.tsx`,
  `__tests__/landingFooterAccessibility.test.tsx`,
  `__tests__/landingHeroSectionWebNavigation.test.tsx`, `__tests__/skipToMainContent.test.tsx`
  for the new content/structure
- New test for `VideoSection.tsx`

### 6. Verification

- Typecheck + existing test suite
- Run `node scripts/generate-static-pages.js`, review regenerated `public/welcome/index.html`
  diff
- Launch web build (`run` skill), visually confirm `/` renders Hero → Video → Features (incl.
  Open Source card) → Footer (full link set) and `/welcome` matches
