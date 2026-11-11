# Spec: clanker #859 — jest infrastructure hardening (lane 1 of the #859 split)

**Date:** 2026-11-11 · **Status:** Reviewed (2026-11-10 review findings M1–M4, S1–S6
and nits folded in) · **Issue:** #859 · **Repo:** clanker · **Base:** `origin/staging`
(`c8c5891e`) · **Lane branch:** `chore/jest-config-hardening`

## Goal

Land the `jest.config.js` hardening items from #859 (plus the pre-existing
`jest.evals.config.js` config crash) as one reviewable PR. The remaining #859 items
(suite-level hardening) stay on the issue as follow-up PRs — see Non-goals. This lane
also absorbs #870's `escapeRegExp` item, so `jest.config.js` gets exactly one owning
PR (agreed in the #870 spec, lines 19-24).

## Findings verified against `origin/staging` @ c8c5891e

1. **Docblock sniff reads only 512 bytes** (`jest.config.js:55-56`): a suite whose
   `@jest-environment jsdom` pragma sits past byte 512 of its leading docblock lands
   in the `native` project and skips `jest.setup.dom.js`. CONFIRMED — with ~1 KB of
   padding inside the leading docblock of
   `src/utilities/__tests__/devConsoleFilters.web.test.ts`, base lists it under
   `native` and the suite fails (unmodified it passes 4/4).
2. **`IGNORED_DIRS` prunes at ANY depth** (`jest.config.js:46`): a directory named
   `build`, `dist`, `temp`, `coverage`, `ios`, `android`, … anywhere in the tree is
   pruned from jsdom-suite discovery. CONFIRMED. Note the effect: such a suite is
   NOT dropped — it is still collected by `native` (whose ignore list is
   root-anchored, `<rootDir>/build/`), so it runs in the wrong environment.
3. **Discovered paths are spliced in unescaped** (`jest.config.js:147`, `:158`) into
   the dom `testMatch` globs and the native `testPathIgnorePatterns` regexes.
   CONFIRMED, and not merely latent for every path shape: every path contains `.`
   (regex wildcard), and a jsdom suite under `app/(drawer)/(tabs)/characters/[id]/`
   is collected by BOTH projects on base (the ignore regex does not match the
   literal brackets/parens), i.e. it double-runs. Current jsdom suites happen to
   avoid these shapes.
4. **`jest-environment-jsdom` resolves only transitively** (`jest-expo@58.0.13`
   depends on `jest-environment-jsdom: ^30.0.0` directly). CONFIRMED — absent from
   `package.json`; resolved at `node_modules/jest-environment-jsdom` 30.5.2.
5. **`npm run edge-evals` crashes at config load** (pre-existing):
   `jest.evals.config.js:1` reads `require('./package.json').jest`, which is
   `undefined`; the throw is at `jest.evals.config.js:3` (`config.preset`).
   CONFIRMED. The removed key (`63a11ccd`) carried
   `setupFiles: ["<rootDir>/jest.setup.js"]` only.

Base classification: 179 suites, **7 dom / 172 native**. The dom set is exactly:

- `__tests__/useCharacterWiki.test.tsx`
- `src/auth/__tests__/appleSignin.web.test.ts`
- `src/auth/__tests__/AppleSignInButton.web.test.tsx`
- `src/auth/__tests__/googleSignin.web.test.ts`
- `src/auth/__tests__/GoogleSignInButton.web.test.tsx`
- `src/utilities/__tests__/devConsoleFilters.web.test.ts`
- `src/utils/__tests__/groundingShadowContent.test.ts`

## Changes

### 1. New `jest.shared.config.js` (behaviour-free extraction — first commit)

- CJS module at the repo root exporting:
  - `TRANSFORM_IGNORE_PATTERNS` — the array currently inline in `common`.
  - `findJsdomSuites(rootDir)` — discovery (moved from `jest.config.js`, changed in
    §2/§3 below), returns rootDir-relative POSIX paths, sorted.
  - `isJsdomSource(source)` — classification (§2).
  - `escapeRegExp(str)` — `str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`. Local
    one-liner, no dependency. It deliberately does NOT escape `-` or `/` (neither is
    special outside a character class, and `\-` is invalid under the `u` flag).
- `jest.config.js` requires it; the patch-package guard and the projects layout stay
  in `jest.config.js`. The first commit moves code only — `--listTests` per project
  must be unchanged after it.
- Update the comments that point at moved code (`jest.config.js:84-85`,
  `.github/workflows/staging-test.yml:118-120`) only if their referent moved; the
  `testPathIgnorePatterns` list itself stays in `jest.config.js`.

### 2. Docblock classification = Jest's own rule

- `isJsdomSource(source)` returns
  `parse(extract(source))['jest-environment'] === 'jsdom'` using `jest-docblock`.
  This is exactly what `jest-runner` does (`parse(extract(testSource))`), so a suite
  is classified dom iff Jest would run it under jsdom.
- Discovery reads the **whole file** (test files are small; no byte window).
- **No regex fallback.** A pragma outside the leading docblock is ignored by Jest, so
  classifying on it would run `jest.setup.dom.js` under the wrong environment. A
  file whose docblock says `node` but mentions `@jest-environment jsdom` elsewhere is
  classified native.
- A duplicated pragma parses to an array, which is `!== 'jsdom'` → native; Jest
  itself errors on such a file, so it fails loudly either way.
- `jest-docblock` becomes a direct devDependency (§5).

### 3. `IGNORED_DIRS` depth rule

- `node_modules`, `.git` and `.worktrees` are pruned at any depth; every other
  `IGNORED_DIRS` name is pruned only at the repo root (depth 0). Comment states the
  rule.
- Side effect: discovery now also walks e.g. `modules/expo-two-way-audio/{android,ios}`
  and `docs/{functions,cloud-agent}`. No test files there today; harmless.

### 4. Anchored, escaped project patterns

- dom project: replace `testMatch` with
  `testRegex: jsdomSuites.map((f) => '^' + escapeRegExp(path.join(__dirname, f)) + '$')`.
  (The jest-expo preset defines no `testMatch`, so there is no testMatch/testRegex
  conflict; do not set both.)
- native project: append the same anchored strings to `testPathIgnorePatterns`.
- `__dirname` is escaped as part of the joined path, so a checkout path containing
  `.`, `(`, `+` etc. is safe.
- Acceptance: a jsdom suite whose path contains `-`, `[id]` and `(tabs)` is listed
  under dom exactly once and under native zero times.

### 5. Dependencies

- Add `jest-docblock` `~30.5.0` and `jest-environment-jsdom` `~30.5.2` as
  devDependencies (tilde, matching `jest: ~30.5.2`, so they move with Jest).
- Add a root `jest` group to `.github/dependabot.yml` (`jest`, `jest-*`,
  `@jest/*`, `babel-jest`) so Jest bumps move the config classifier and the runner
  together.
- Install with `npm install --save-dev` at the already-resolved versions. Expected
  lockfile delta: the two lines in the root `packages[""].devDependencies` only —
  no new or changed package entries, so the release-age gate's delta is empty.
  `escape-string-regexp` is NOT added (local helper instead).

### 6. `jest.evals.config.js`

- Require `TRANSFORM_IGNORE_PATTERNS` from `jest.shared.config.js`; set
  `preset: 'jest-expo'` and
  `setupFiles: ['<rootDir>/jest.setup.early.js', '<rootDir>/jest.setup.js']`
  (the `native` project's list; the old key only had `jest.setup.js`, but
  `jest.setup.early.js` is now required by the shared setup). Keep its own
  `testPathIgnorePatterns` and `testRegex: '.*\\.int\\.test\\.ts$'` unchanged.

### 7. Durable regression guard

- `__tests__/jestSharedConfig.test.ts` (runs in `native`) builds tmpdir fixture trees
  and asserts `findJsdomSuites` / `isJsdomSource` / `escapeRegExp`:
  - pragma at byte >512 inside the leading docblock → dom;
  - pragma only in a second (non-leading) comment → native;
  - `@jest-environment node` docblock that mentions jsdom later → native;
  - `src/x/build/__tests__/a.test.ts` with jsdom pragma → found; root `build/` and
    nested `node_modules/` → not found;
  - paths with `-`, `[id]`, `(tabs)`: the anchored regex built per §4 matches the
    absolute path exactly and does not match a sibling path.
- Precedent for tmpdir fixtures: `__tests__/checkReleaseAge.test.ts`.

## Non-goals (stay in #859 as follow-up PRs)

- Suite-level hardening: `File.write` deferred-promise fakes; floating RNTL promises;
  `useActiveCharacterId` act/waitFor; no-op `async` residue; drawerTermsGate mock
  surface; `useLiveAudioIO.web` `.not.toThrow()` no-op; ChatView conditional-type
  cast; `String(color)` in tabs layout.
- No changes to jest setup files or the project split. Classification of the current
  tree must be IDENTICAL (see Test plan).
- Running the live edge-agent evals with credentials.

## Test plan

Fresh worktree, `npm ci --no-audit --no-fund`, then:

- `npm run typecheck && npm run lint:check && npm run format:check && npm run check:generated` — exit 0.
- `npm run test` — exit 0, 180 suites (179 + the new guard suite).
- **Classification gate (per project, rootDir-relative):**
  `npx jest --listTests --selectProjects dom` lists exactly the 7 suites above;
  `npx jest --listTests --selectProjects native` lists 173 (172 + guard suite).
  Compare relativised, sorted lists against base — not the de-duplicated union.
- **Docblock RED→GREEN:** ~1 KB padding INSIDE the leading docblock of
  `devConsoleFilters.web.test.ts` before its pragma — base: listed under native, suite
  fails; new: listed under dom, passes. Revert.
- **Depth RED→GREEN:** temporary `src/probe/build/x.test.ts` carrying
  `/** @jest-environment jsdom */` — base: native only; new: dom only. Remove.
- **Escape RED→GREEN:** temporary `app/(drawer)/(tabs)/characters/[id]/__tests__/br.test.tsx`
  and `src/probe-hy/__tests__/hy.test.ts`, both jsdom — base: `br` in both projects;
  new: each in dom once, native zero. Remove.
- **Evals:** `npm run edge-evals -- --listTests` lists exactly
  `src/services/__tests__/edgeAgentEvals.int.test.ts` (base: throws). Then
  `env -u GOOGLE_GENAI_API_KEY -u GOOGLE_GENAI_USE_VERTEXAI npm run edge-evals` —
  the suite loads and its tests fail at the credential guard ("Set
  GOOGLE_GENAI_API_KEY…") before any client is created, proving transform + setup
  work. No live evals are run.

## Acceptance

- One PR, base `staging`, merge-commit only, PR template used, body says
  `Refs #859` (jest-infra slice; suite-hardening items remain on the issue).
- Commit types: `refactor(test):` for the extraction, `test:` for config logic and
  the guard suite, `build(deps-dev):` for devDependencies, `ci:` for dependabot.
  No `fix:`/`feat:` (no app release needed).
- Lockfile delta limited to the root entry's devDependencies.
- Ledger (`LEDGER.md` beside this spec) ticked with evidence before review.
