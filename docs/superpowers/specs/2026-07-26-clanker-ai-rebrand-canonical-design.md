# Clanker AI Rebrand — Making clanker-ai.com the Canonical Home

**Date:** 2026-07-26
**Status:** Approved
**Scope:** `src/config/landingConfig.ts`, the hardcoded markup in `scripts/generate-static-pages.js`, and the hand-maintained marketing pages under `public/`. No app code, no backend.
**Companion spec:** `equationalapplications.com/docs/superpowers/specs/2026-07-26-clanker-ai-canonical-consolidation-design.md` — that site cedes search authority to this one. **Ship this spec first or alongside it.**

---

## Goal

Make `clanker-ai.com` the canonical, correctly-branded home of **Clanker AI**.

## Problem

The product was rebranded to "Clanker AI" on the business site in July 2026, but that spec explicitly excluded this repo. So the product's *own* domain still brands itself "Clanker" everywhere:

| URL | Current title |
|---|---|
| `/welcome` | `Clanker — AI Characters with Real-Time Voice & Google OKF Memory` |
| `/real-time-voice` | `Live Real-Time Voice Calls — Clanker` |
| `/advanced-memory` | `Advanced AI Memory That Learns — Clanker` |
| `/privacy-mode` | `Enhanced Privacy Mode — Keep AI Memory On Your Device — Clanker` |
| `/open-source` | `Clanker is Open Source — Clanker` |
| `/memory-export-with-okf` | `Import & Export AI Character Memory with Google's OKF — Clanker` |

Two problems follow. The brand is inconsistent across the two domains a user might land on. And `equationalapplications.com` is about to hand canonical authority for "Clanker AI" to pages that never use the phrase — which would concede the branded query rather than consolidate it.

There is also a positioning split: this site says *"AI Characters"*, the business site says *"personal AI assistant"*.

## Locked Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Brand | **"Clanker AI"** in all user-facing titles, headings, meta, and JSON-LD `name`. |
| 2 | Positioning | **Assistant-first** primary framing, matching the business site. "AI characters" and "AI companion" retained as secondary keyword equity — they carry real search volume and existing ranking. |
| 3 | Identifiers | Unchanged. Bundle IDs, package names, file paths, route slugs, config keys, the `Clanker` app title in the SPA. This is a marketing rebrand, not a rename. |
| 4 | Canonicals | Already correct and self-referential on every page. **No changes.** |
| 5 | URL slugs | Unchanged. No redirects; renaming paths would discard existing ranking for zero benefit. |
| 6 | `/open-source` title | **`Open Source — Clanker AI`.** Not `Clanker AI is Open Source — Clanker AI` — the doubled brand reads as keyword stuffing and as a template bug. Decided here, not at implementation time. |
| 7 | Old brand in schema | Preserve "Clanker" as `alternateName` on the `SoftwareApplication` entity so the rebrand reads as a rename of one entity rather than a new one. |

---

## 1. Two kinds of page, two editing paths

This trips people up, so it is worth stating before the work:

| Page | Source | How to change |
|---|---|---|
| `/welcome` | `src/config/landingConfig.ts` | Edit config, run `npm run generate:static-pages`. The generated `public/welcome/index.html` **is git-tracked**, so commit the regenerated output too. |
| `/real-time-voice`, `/advanced-memory`, `/privacy-mode`, `/open-source`, `/memory-export-with-okf`, `/support` | Hand-written HTML in `public/<slug>/index.html` | Edit the HTML directly. Not generated. |
| `/privacy`, `/terms` | `src/config/privacyConfig.ts`, `termsConfig.ts` | Generated **and gitignored** — never edit the HTML. Out of scope here. |

Do not hand-edit `public/welcome/index.html`; it is overwritten on the next generate.

## 2. `landingConfig.ts` — `/welcome`

- `SITE_META.title` → `Clanker AI — Personal AI Assistant with Real-Time Voice & OKF Memory`
- `SITE_META.description` → assistant-first: a personal AI assistant with a personality you design and a memory that never forgets; real-time voice, document understanding, live web search, OKF export. Keep "AI characters" in the body copy, not the lead.
- `JSONLD.softwareApplication.name` → `Clanker AI`
- `JSONLD.softwareApplication.alternateName` → **add** `Clanker`. This is the only place the old brand is deliberately retained; it tells search engines the entity was renamed rather than replaced.
- `JSONLD.softwareApplication.description` → match the new positioning.
- `JSONLD.videoObject.description` → replace bare "Clanker" where it reads as the product name.
- `HERO` headline and subhead → assistant-first, "Clanker AI" on first mention.
- `FEATURES_SECTION.title` and `FEATURES[]` → replace product-name "Clanker" with "Clanker AI" on first mention per section; leave later in-sentence uses if repetition reads badly.

`SITE_META.canonicalPath` stays `/welcome`.

### 2a. Image `alt` text lives in the generator, not the config

`/welcome`'s hero icon is hardcoded in the template, not driven by `landingConfig.ts`:

- `scripts/generate-static-pages.js:560` — `<img src="/clanker-icon.png" alt="Clanker" …>` → `alt="Clanker AI logo"`.

Editing only `public/welcome/index.html:124` will be reverted by the next `generate:static-pages` run. Change the script, then regenerate. This is the single `alt` attribute across all marketing pages — the hand-maintained pillar pages contain no `<img>` tags at all, so there is no per-page alt sweep to do.

## 3. Hand-maintained pillar pages

For each of `/real-time-voice`, `/advanced-memory`, `/privacy-mode`, `/open-source`, `/memory-export-with-okf`, `/support`:

- `<title>` → suffix becomes **`— Clanker AI`** rather than `— Clanker`.
- `<meta name="description">` → "Clanker AI" on first mention; assistant-first phrasing where the sentence already needs rewriting. Do not rewrite descriptions that are already accurate just to insert the word.
- JSON-LD `name` / `description` fields naming the product → `Clanker AI`.
- OpenGraph and Twitter `title` / `description` → follow the `<title>`.
- Visible `<h1>` and nav/footer product references → `Clanker AI` on first mention.

Leave `canonical`, `og:url`, and all slugs alone.

## 4. `/open-source` title collision

`Clanker is Open Source — Clanker` reads as a duplication artifact. Mechanically appending the new brand would give `Clanker AI is Open Source — Clanker AI`, which is worse — the doubled brand reads as keyword stuffing.

**Ship `Open Source — Clanker AI`.** Locked (decision 6), not a judgment call at implementation time. The `<h1>` may still read `Clanker AI is Open Source`; only the `<title>` drops the leading brand.

## 5. Cross-domain consistency

After this ships, `clanker-ai.com` and `equationalapplications.com` should agree on:

- Product name: **Clanker AI**
- Primary framing: **personal AI assistant**
- `applicationCategory`: `LifestyleApplication` — already matching on both. Do not change it on one side alone.

The business site's `SoftwareApplication` schema is being **removed** by the companion spec, leaving this site's as the only declaration of the product entity. Verify after both deploy.

**On the `Organization` nodes:** every page's `Organization` JSON-LD is the *publisher* — `Equational Applications LLC`, `https://equationalapplications.com/`. It never names the product, so nothing in it changes and no `alternateName` belongs there. The product entity is the `SoftwareApplication` in `/welcome`, and that is where `alternateName: "Clanker"` goes (decision 7, §2). Do not add product branding to the publisher node.

## Risks

- **Short ranking movement** while titles re-index. Expected; the slugs and canonicals are unchanged, so nothing is being discarded.
- **Do not drop "AI character" / "AI companion" entirely.** Those terms carry existing ranking and real volume. Demote them from the lead, keep them in body copy and keywords.
- **`public/welcome/index.html` drift.** If the config is edited without regenerating, or the HTML is hand-edited, the tracked file and the config disagree. Regenerate and commit in the same change.
- **Sequencing.** If the companion spec ships first, "Clanker AI" authority passes to pages still titled "Clanker" — the exact problem this spec exists to prevent.

## Testing / Acceptance

- `npm run generate:static-pages` succeeds; `public/welcome/index.html` regenerates and is committed.
- Every marketing page's `<title>` contains **"Clanker AI"**; grep for `— Clanker<` finds no remaining bare-brand suffix.
- Exactly one `"@type": "SoftwareApplication"` across `public/`, with `"name": "Clanker AI"` and `"alternateName": "Clanker"`.
- `grep -rn 'alt="' public/` returns exactly one hit: `alt="Clanker AI logo"` in `public/welcome/index.html`, matching `scripts/generate-static-pages.js`.
- Every `"@type": "Organization"` node still reads `Equational Applications LLC` — unchanged by this work.
- `/open-source` `<title>` is exactly `Open Source — Clanker AI`; no page title contains `Clanker AI` twice.
- Canonicals unchanged: each page still self-references its own `https://clanker-ai.com/<slug>`.
- `public/sitemap.xml` regenerates with the same URL set — no slug changed.
- JSON-LD validates (Rich Results) for SoftwareApplication, VideoObject, Organization.
- Spot-check `/welcome` and two pillar pages rendered — no doubled "Clanker AI AI", no orphaned "Clanker" as a product name in a heading.

## Out of Scope

- App/SPA UI strings, the `Clanker` SPA `<title>`, store listing copy, bundle IDs, package names, route slugs.
- `/privacy` and `/terms` (generated from their own configs).
- **Web manifest.** There is no `manifest.json` or `site.webmanifest` under `public/`, and no marketing page's `<head>` links one — nothing to rename. The Expo app manifest is generated at build time from `app.json` and falls under the identifiers-unchanged rule (decision 3).
- Any change in the `equationalapplications.com` repo — covered by the companion spec.
- Redirects and URL restructuring.
