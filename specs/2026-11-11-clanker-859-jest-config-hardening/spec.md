# Spec: clanker #859 — jest infrastructure hardening (lane 1 of the #859 split)

**Date:** 2026-11-11 · **Status:** Draft (awaiting Kurt's spec approval) · **Issue:** #859 ·
**Repo:** clanker · **Base:** `origin/staging` (`c8c5891e`) · **Lane branch:** `chore/jest-config-hardening`

## Goal

Land the `jest.config.js` hardening items from #859 (plus the pre-existing
`jest.evals.config.js` config crash) as one reviewable PR. The remaining
#859 items (suite-level hardening) stay in the issue as follow-up PRs — see
Non-goals. This lane also absorbs #870's `escapeRegExp` item, so
`jest.config.js` gets exactly one owning PR (agreed in the #870 spec).

## Findings verified against `origin/staging` @ c8c5891e (2026-11-11)

1. **Docblock sniff reads only 512 bytes** (`jest.config.js:55-56`): a suite
   with `@jest-environment jsdom` past byte 512 silently lands in the
   `native` project and skips `jest.setup.dom.js`. CONFIRMED — the head read
   is a raw 512-byte window with a regex.
2. **`IGNORED_DIRS` skips at ANY depth** (`jest.config.js:46`): any directory
   named `build`, `dist`, `temp`, `coverage`, `ios`, `android`, … anywhere in
   the tree is pruned from jsdom-suite discovery, not just at the root.
   CONFIRMED — single flat `Set.has(entry.name)` check with no depth
   awareness.
3. **Discovered paths used unescaped** in `testMatch` globs and
   `testPathIgnorePatterns` regexes. CONFIRMED — `jsdomSuites` is spliced in
   raw (`<rootDir>/${f}`); zero escapes today. Latent only (current suite
   paths contain no metacharacters), per the issue.
4. **`jest-environment-jsdom` resolves only transitively** (via jest-expo →
   jest). CONFIRMED — absent from `package.json`, resolvable at
   `node_modules/jest-environment-jsdom` (30.5.2, Jest 30 line).
5. **`npm run edge-evals` crashes at config load** (PRE-EXISTING, not from
   the #855 ladder): `jest.evals.config.js:1` reads
   `require('./package.json').jest`, which does not exist. CONFIRMED — real
   run throws inside `jest-util/requireOrImportModule`. The evals config was
   written against a `jest` key in package.json that no longer exists (the
   config moved to `jest.config.js`'s projects layout).

Supporting fact: `jest-docblock` and `escape-string-regexp` are already
resolvable in `node_modules` (transitively) — but this lane adds them as
DIRECT devDependencies, mirroring item 4's rationale: config-critical
modules must not depend on transitive resolution.

## Changes

### 1. `jest.config.js` — docblock parsing via `jest-docblock`

- Replace the raw 512-byte regex sniff with: read the first **4096 bytes**
  (docblock pragmas live at the file top; 4 KiB covers any realistic header
  plus Star-of-Comments blocks), run `jest-docblock.extract()` then
  `.parse()`, and classify jsdom via `pragmas['jest-environment'] === 'jsdom'`
  (the pragma's canonical value; the regex fallback
  `/@jest-environment\s+jsdom/` on the same head stays as an OR-guard for
  non-docblock usages, which Jest itself does not support — belt and braces).
- `jest-docblock` added as a direct devDependency (pinned to the version
  already installed transitively by Jest 30 — implementation reads the
  installed version and pins exactly that).

### 2. `jest.config.js` — `IGNORED_DIRS` root-only scoping

- `findJsdomSuites` gains a depth parameter. `node_modules` and `.git` stay
  pruned at ANY depth (never meaningful suite homes); every other
  `IGNORED_DIRS` name is pruned only at depth 0 (repo root), so a deep
  `__tests__/` under something like `src/foo/build/`-named directories is
  no longer silently skipped.
- Comment updated to state the depth rule.

### 3. `jest.config.js` — escape discovered paths

- `escape-string-regexp` added as a direct devDependency (4.0.0, the version
  already present transitively).
- Discovered relative paths are escaped once at discovery
  (`jsdomSuites = raw.map(escapeStringRegexp)`) and used in BOTH
  `testMatch` globs and `testPathIgnorePatterns` — escaping regex-special
  characters also neutralizes the minimatch-special ones (`(){}[]`), so one
  escape serves both consumers. Verified non-breaking by the full suite run
  (current paths have no metacharacters, so output must be identical).

### 4. `package.json` — direct `jest-environment-jsdom` devDependency

- Added pinned to the Jest 30 line at the currently-resolved version
  (30.5.2) so removing jest-expo or a Jest major bump cannot silently drop
  the jsdom environment.

### 5. `jest.evals.config.js` — stop reading the nonexistent `package.json#jest`

- `jest.config.js` extracts its shared pieces (`common`, `TEST_MATCH`) into
  a new `jest.shared.config.js` (CJS, same `require` style); `jest.config.js`
  requires it (guard + discovery code stay put).
- `jest.evals.config.js` requires the same shared module and takes
  `preset: 'jest-expo'`, `setupFiles: ['<rootDir>/jest.setup.early.js',
'<rootDir>/jest.setup.js']` (what the dead package.json key used to carry,
  matching the `native` project's list minus the dom-only file),
  `transformIgnorePatterns` from `common`, and keeps its own
  `testPathIgnorePatterns` + `testRegex: '.*\.int\.test\.ts$'` exactly as
  today. Field selection is deliberately unchanged — the fix is the source
  of the values, not the evals config's shape.

## Non-goals (stay in #859 as follow-up PRs)

- Suite-level hardening: `File.write` deferred-promise fakes; floating RNTL
  promises; `useActiveCharacterId` act/waitFor; no-op `async` residue;
  drawerTermsGate mock surface; `useLiveAudioIO.web` `.not.toThrow()` no-op;
  ChatView conditional-type cast; `String(color)` in tabs layout.
- No changes to jest setup files, project split, or which suites run where
  (classification output must be IDENTICAL — see Test plan).
- Running the live edge-agent evals (manual-only, costs money, needs live
  credentials).

## Test plan

Fresh worktree: `npm ci --no-audit --no-fund` (done), then:

- `npm run typecheck && npm run lint:check` — exit 0
- `npm run test` — exit 0, **same suite count as base** (179 suites at
  c8c5891e): classification must not shift. Before/after comparison:
  `npx jest --listTests` sorted diff against base must be empty.
- Docblock fix proven RED→GREEN: temporarily append a 6 KB comment header in
  front of an existing jsdom suite's `@jest-environment jsdom` pragma — base
  config misclassifies it into `native` (suite fails), new config classifies
  it correctly; revert the fixture afterward.
- `IGNORED_DIRS` scoping proven: temporary `src/probe/build/x.test.ts` —
  base skips it (never collected), new config collects it; remove probe.
- `npm run edge-evals -- --listTests` — config loads and lists the
  `.int.test.ts` suites (or an empty list) instead of throwing. The evals
  themselves are NOT run (manual-only).
- `npm run edge-evals -- --listTests` on BASE for comparison — throws
  (already confirmed on staging: real crash captured 2026-11-11).

## Acceptance

- One PR, base `staging`, merge-commit only, PR template used, body says
  `Fixes #859` **partially** — actually `Refs #859 (jest-infra slice; suite
hardening items remain on the issue)`, so the issue stays open for the
  follow-up PRs.
- Ledger (`specs/2026-11-11-clanker-859-jest-config-hardening/LEDGER.md`)
  ticked with evidence before review.
