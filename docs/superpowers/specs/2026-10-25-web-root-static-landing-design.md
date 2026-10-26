# Web root serves the static landing page; `/welcome` retired — Design

**Date:** 2026-10-25
**Status:** Implemented (this branch)
**Requested by:** Kurt VanDusen, 2026-10-25
**Scope:** web export and Firebase Hosting only. No native code paths change; the mobile
first screen (`app/index.tsx`) and the character deep links are untouched and re-verified.

## Problem

`https://clanker-ai.com/` served Expo's single-page shell: a 1.2 KB document titled
"Clanker" with an empty `<div id="root">`. The marketing page was rendered client-side by
`app/index.web.tsx` after the auth machine initialised, so crawlers and link previews saw
nothing at the brand's home URL. The real, crawlable landing page lived at `/welcome`
(`public/welcome/index.html`, generated from `src/config/landingConfig.ts`).

Because `firebase.json` rewrote every path to `/index.html`, every unknown URL
(including `/llms.txt`) also returned the shell with HTTP 200: soft 404s.

Expo's static rendering (`web.output: 'static'`) was tried earlier and abandoned: it
server-renders the auth machine and native modules.

## Design

Expo keeps owning the app. Firebase Hosting owns the root.

1. **Post-export swap** (`scripts/finalize-web-export.mjs`, last step of `predeploy`).
   After `expo export`, `dist/index.html` (the shell) is renamed to
   `dist/app-shell.html` and the generated landing page is copied to `dist/index.html`.
   The shell gets a descriptive `<title>`, a meta description and `robots: noindex`, so
   app-only routes stop appearing as "Clanker" in search and unknown paths are no longer
   indexed. The script refuses to run on anything that does not look like the Expo shell,
   and fails if the deep-link files are missing from `dist/.well-known`.
2. **Landing page generated outside `public/`.** `expo export` always writes its shell to
   `dist/index.html`, so a `public/index.html` would be ambiguous. The generator now writes
   `landing/index.html` (tracked, like the other marketing pages, so the marketing tests
   and git-based `lastmod` can read it) with canonical `https://clanker-ai.com/`.
3. **Signed-in visitors skip the marketing page.** Firebase Auth persists in IndexedDB,
   which an inline script cannot read before first paint. `src/utilities/signedInHint.web.ts`
   mirrors auth state into `localStorage['clanker:signedIn']` from the web auth seam
   (`firebaseConfig.web.ts`). A three-line inline script at the top of the landing page
   redirects to `/chat` when the flag is `'1'`. It is a hint: a stale value costs one hop
   to `/sign-in`. Crawlers never run it. Key and target path live in
   `src/config/siteConfig.js` so the generator, the app and the tests share them.
4. **`/welcome` retired.** `firebase.json` 301s `/welcome` → `/`. `public/welcome/` is
   deleted, every tracked marketing page and the generated legal footer link to `/`, the
   sitemap lists `/`, and `landingConfig.canonicalPath` is `/`.
5. **`app/index.web.tsx` and `src/components/LandingPage/` deleted.** A full page load of
   `/` never reaches the router any more. In-app navigations to `/` (checkout, terms,
   admin fallbacks) now hit `app/index.tsx` on every platform, which redirects to `/chat`
   or `/sign-in`. The seven landing-component tests go with the components;
   `__tests__/indexRedirect.test.tsx` covers the shared root route.
6. **`public/llms.txt`** is generated from the same config as the landing page. As a
   static file it wins over the rewrite.

### Firebase Hosting rules

| Rule         | Before        | After                                                                        |
| ------------ | ------------- | ---------------------------------------------------------------------------- |
| rewrite `**` | `/index.html` | `/app-shell.html`                                                            |
| redirect     | none          | `/welcome` → `/` (301)                                                       |
| header       | none          | `/.well-known/apple-app-site-association` → `Content-Type: application/json` |

Firebase evaluates redirects, then static files, then rewrites, so `/`, the pillar pages,
`llms.txt`, `robots.txt`, `sitemap.xml` and `.well-known/*` are served as files and every
other path still reaches the app.

## Deep links (verified 2026-10-25, before and after)

- **Android App Links:** `assetlinks.json` is tracked in `public/.well-known`; Google's
  Digital Asset Links API returns both signing fingerprints for
  `com.equationalapplications.clanker`. Intent filter: `https://clanker-ai.com/characters/shared/*`.
- **iOS Universal Links:** Apple's CDN (`app-site-association.cdn-apple.com/a/v1/clanker-ai.com`)
  serves the tracked file with `paths: ["/characters/shared/*"]`. Hosting served it as
  `text/plain`; Apple documents `application/json`, now set explicitly.
- **Web share route:** `/characters/shared/:id` is an app route and resolves through the
  rewrite to the shell exactly as before; `authRedirect.ts` already lists `/` as public and
  restores the deep link after sign-in.
- `finalize-web-export.mjs` fails the build if either `.well-known` file is missing or
  not JSON.

## Downstream

equationalapplications.com's `CLANKER_CANONICAL`, `llms.txt` and checks pinned
`clanker-ai.com/welcome`; they move to `clanker-ai.com/` in the same change set.
The 301 covers any remaining inbound links.

## Verification

- `npm run generate:static-pages`, `npx expo export --platform web --clear`,
  `node scripts/finalize-web-export.mjs`.
- Jest: `marketingBranding`, `marketingJsonLd`, `indexRedirect`, `signedInHint`.
- `npm run typecheck`, `npm run lint:check`.
- Firebase Hosting emulator against `dist/`: `/` is the landing page, `/welcome` is a
  301, `/sign-in` and `/characters/shared/x` return the noindex shell, `/llms.txt` is
  text, the AASA file is `application/json`.
