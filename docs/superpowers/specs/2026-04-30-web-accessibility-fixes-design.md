# Web (and Mobile) Accessibility Fixes — Design Spec

**Date:** 2026-04-30
**Status:** Approved
**Source audit:** `ACCESSIBILITY_AUDIT.md` (external/untracked source document)

## Goal & Scope

Bring the Clanker app into WCAG 2.1 Level A compliance for the 13 issues identified in the accessibility audit, plus opportunistic AA improvements (live regions, skip link). Fixes apply to both web and native because most affected components live in shared `.tsx` files; the web build is intended to mirror the mobile experience except where platform constraints force divergence.

**In scope**

- All 13 audit issues across the three phases (Critical, Important, Nice-to-Have).
- Direct in-place edits to existing components — no new abstractions or wrapper components.
- Jest unit tests asserting accessibility props on each modified component.
- New documentation file `docs/ACCESSIBILITY.md` plus a README link.
- Single feature branch `kv/a11y-fixes`, three commits (one per phase), one PR to `staging`.

**Out of scope**

- Visual redesign or theme changes.
- Color contrast adjustments (Material Design theme already passes AA).
- Keyboard-shortcut overhaul.
- Automated axe-core integration.
- Native-mobile-only audit beyond the issues already enumerated.

## Architecture & Conventions

No new modules. Each fix is a localized prop addition. The conventions below are the source of truth for label/role/state choices in this spec and going forward (also captured in `docs/ACCESSIBILITY.md`).

- Use React Native standard accessibility props: `accessible`, `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`, `accessibilityState`, `accessibilityValue`, `accessibilityLiveRegion` (Android only).
- `accessibilityLabel` describes WHAT the element is/says (e.g., `"Edit Frodo"`).
- `accessibilityHint` describes WHAT HAPPENS on activation. Only add when the action isn't obvious from the label.
- `accessibilityRole` matches semantic role: `"button"`, `"image"`, `"link"`, `"progressbar"`, `"status"`, `"header"`.
- For dynamic state, use `accessibilityState={{ busy, disabled, selected, expanded }}`.
- Decorative icons paired with visible labels (e.g., emoji inside a labeled `Pressable`) get `aria-hidden` on web or `importantForAccessibility="no-hide-descendants"` on native.
- For Android live announcements, pair `accessibilityRole="status"` with `accessibilityLiveRegion="polite"`. iOS handles status changes via VoiceOver detection of the same `role="status"`.

**Cross-platform handling**

- Where a component has both `Foo.tsx` and `Foo.web.tsx`, both files are updated identically.
- Principle: edit shared `.tsx` so both platforms benefit. Only split when a real platform constraint requires it (e.g., the skip-link is web-only).

## The 13 Fixes

### Commit 1 — Critical (Phase 1)

| # | File | Change |
|---|------|--------|
| 1 | `src/components/Logo.tsx` | Add `accessibilityLabel="Clanker logo"` and `accessibilityRole="image"` to `<Image>`. |
| 2 | `src/components/LandingPage/HeroSection.tsx` | Add `accessibilityLabel="Clanker application logo"` and `accessibilityRole="image"` to the hero `<Image>`. |
| 3 | `src/components/CreditCounterIcon.tsx` | Add `accessibilityRole="button"`, dynamic `accessibilityLabel` (`"Premium subscriber, unlimited credits"` vs `"{N} credits remaining"`), `accessibilityHint="Opens subscription management"` to the `Pressable`. Mark crown/infinity emoji as decorative (`importantForAccessibility="no-hide-descendants"`/`aria-hidden`). |

Also in this commit:
- Create `docs/ACCESSIBILITY.md` and link to it from `README.md`.

### Commit 2 — Important (Phase 2)

| # | File | Change |
|---|------|--------|
| 4 | `src/components/CharacterCard.tsx` | Edit button: add `accessibilityRole="button"`, `accessibilityLabel={\`Edit ${name}\`}`, `accessibilityHint="Opens character editor"`. |
| 5 | `src/components/CharacterCard.tsx` | Outer card `TouchableOpacity`: add `accessible`, `accessibilityRole="button"`, `accessibilityLabel={\`${name}, ${appearance ?? 'No description'}\`}`, `accessibilityHint="Opens chat with this character"`. |
| 6 | `src/components/CharacterAvatar.tsx` | All three avatar variants (`Avatar.Image`, `Avatar.Text`, `Avatar.Icon`): add `accessible` and `accessibilityLabel={\`${characterName} avatar\`}` (fallback `"Character avatar"` when name missing). |
| 7 | `src/components/LandingPage/FeaturesSection.tsx` | Feature icons: add `accessible`, `accessibilityRole="image"`, `accessibilityLabel={feat.title}`. |
| 8 | `src/components/admin/UserActionPanel.tsx` | Renewal date `TextInput`: add `accessibilityHint="Enter date in UTC ISO 8601 format (e.g., 2026-12-31T23:59:59Z). Leave blank to keep the current renewal date."` |

### Commit 3 — Nice-to-Have (Phase 3)

| # | File | Change |
|---|------|--------|
| 9 | `app/(drawer)/(tabs)/_layout.tsx` | For each `Tabs.Screen`, add `tabBarAccessibilityLabel` derived from the tab title. |
| 10 | `app/(drawer)/(tabs)/talk/index.tsx` | Wrap voice status text in a `<View accessibilityRole="status" accessibilityLiveRegion="polite">` so state changes (Ready/Listening/Processing) announce to screen readers. |
| 11 | `src/components/ConfirmationModal.tsx` and `src/components/admin/ConfirmationModal.tsx` | Verify Paper `Dialog` props for accessibility; add explicit `accessibilityLabel` to dialog title where missing; document any gaps. No focus-trapping JS — rely on Paper. |
| 12 | `src/components/LandingPage/LandingFooter.tsx` | External link: enhance `accessibilityLabel` to include destination and `"opens external website"`. |
| 13 | Landing root component | Add a web-only "Skip to main content" link as the first focusable element, anchored to the main content `nativeID="main-content"`. Hidden offscreen until focused. Web-only via `Platform.OS === 'web'`. |

## Testing & Verification

**Unit tests (Jest + React Native Testing Library)**

Pattern: render component, query by `accessibilityLabel`/`accessibilityRole`, assert prop values.

| Test file | Asserts |
|-----------|---------|
| `__tests__/logo.test.tsx` (new) | Logo image has `accessibilityLabel="Clanker logo"` and `accessibilityRole="image"`. |
| `__tests__/heroSectionAccessibility.test.tsx` (new) | Hero image has accessibility label and role. |
| `__tests__/creditCounterIconPlanLoading.test.tsx` (extend) | Subscriber announces `"Premium subscriber, unlimited credits"`; non-subscriber announces `"{N} credits remaining"`; pressable has `accessibilityRole="button"`. |
| `__tests__/characterCardAccessibility.test.tsx` (new) | Card has button role + label including character name; edit button has its own label/hint. |
| `__tests__/characterAvatarAccessibility.test.tsx` (new) | Each variant has accessibility label including character name; fallback when name missing. |
| `__tests__/featuresSectionAccessibility.test.tsx` (new) | Each feature icon has `accessibilityRole="image"` + label matching feature title. |
| `__tests__/userActionPanelAccessibility.test.tsx` (new) | Renewal date input has `accessibilityHint` containing the format example. |
| `__tests__/tabsLayoutAccessibility.test.tsx` (new) | Each tab screen passes a `tabBarAccessibilityLabel`. |
| `__tests__/talkScreenStatusLiveRegion.test.tsx` (new) | Voice-status container has `accessibilityRole="status"` and `accessibilityLiveRegion="polite"`. |
| `__tests__/landingFooterAccessibility.test.tsx` (new) | External link label includes `"opens in new window"`. |
| `__tests__/skipToMainContent.test.tsx` (new) | Web-only: skip link rendered as first focusable element on landing page when `Platform.OS === 'web'`. |

ConfirmationModal coverage: rely on existing tests; the change is verification + minor prop addition.

**Existing CI checks (must all pass before PR merge)**

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `cd functions && npm run typecheck && npm run lint && npm run test` if functions touched (none expected).

**Manual smoke (recommended, not blocking)**

One pass with VoiceOver on macOS Safari against the deployed staging build to confirm critical flows announce correctly. Documented as follow-up if time-constrained, not gating.

## Branch, Commits & PR

- **Branch:** `kv/a11y-fixes` off `staging`.
- **Commits:**
  1. `fix(a11y): add labels and roles for critical images and credit counter`
  2. `fix(a11y): add labels and hints for character cards, avatars, features, admin renewal`
  3. `feat(a11y): add tab labels, status live region, modal/footer enhancements, skip link`
- **PR:** opened against `staging`, uses `.github/pull_request_template.md`, body links to `ACCESSIBILITY_AUDIT.md` and this spec.

## Documentation

- **`docs/ACCESSIBILITY.md`** — Conventions used in the codebase: prop choices, role mappings, label/hint patterns, the "web mirrors mobile" principle, the testing approach, and a link to React Native's accessibility docs. Created in Commit 1.
- **`README.md`** — Add a 1–2 sentence summary and link under the appropriate "Documentation Deep Dives" section. Per `AGENTS.md`.

## Risks & Open Questions

**Risks**

- React Native Paper components (`Avatar.Image`, `Dialog`, `IconButton`) may forward accessibility props to a wrapping `View` rather than the visible element. Mitigation: tests query by accessible name; if a prop doesn't surface, wrap the Paper component in a `View` with the props.
- The skip-link pattern on React Native Web requires careful focus styling. Mitigation: minimal `position: absolute; top: -9999px;` with focus style that brings it on-screen. Web-only.
- `accessibilityLiveRegion` is Android-only; on iOS the equivalent comes from `accessibilityRole="status"` plus content updates being detected by VoiceOver. Set both.

**Open questions (none blocking)**

- CharacterCard label falls back to `"No description"` if `appearance` is missing. Acceptable.
- Tab labels derived from existing `title` strings on each `Tabs.Screen`. If absent, route name title-cased.
