# LEDGER — clanker #859 jest-config hardening (lane 1 of the #859 split)

**In flight:** implementation complete; awaiting review.

- [x] Task 1 — extract `jest.shared.config.js` (`f4a240dc`). Per-project `--listTests` identical to
      base (dom 7 / native 172).
- [x] Task 2 — Jest-accurate docblock classification, root-only `IGNORED_DIRS`, `escapeRegExp`,
      `jsdomSuitePattern` + guard suite `__tests__/jestSharedConfig.test.ts` (`c3569991`,
      `df8dfc5d`). RED 5/5 failing (missing exports), GREEN 5/5. Lockfile delta: the two root
      `packages[""].devDependencies` lines only.
- [x] Task 3 — anchored, escaped dom `testRegex` / native ignore patterns (`09e77bf5`). Probe RED on
      the pre-Task-3 config: `app/(drawer)/(tabs)/characters/[id]/__tests__/br.test.tsx` listed in
      BOTH projects. GREEN: `br`, `src/probe-hy/__tests__/hy.test.ts` and
      `src/probe/build/x.test.ts` each in dom once, native zero. (The `build/` depth RED is pinned by
      the Task 2 unit test; the Task 2 commit already fixed it before this probe ran.) Docblock
      padded with 17 lines before the pragma in `devConsoleFilters.web.test.ts`: listed under dom,
      4/4 pass; reverted.
- [x] Task 4 — `jest.evals.config.js` loads (`0ee6caf4`): base threw
      `Cannot read properties of undefined (reading 'preset')`; now `--listTests` lists exactly
      `src/services/__tests__/edgeAgentEvals.int.test.ts`; with credentials unset the suite loads
      and fails 3/3 at the credential guard. Dependabot `jest` group (`a232e5ae`). Extra:
      `edge-evals` script dropped the first forwarded CLI arg (`slice(2)` under `node -e`), so
      `npm run edge-evals -- --listTests` ran the suite; fixed to `slice(1)`.
- [x] Task 5 — gates: `npm run typecheck`, `lint:check`, `format:check`, `check:generated` all
      exit 0. `npm run test`: 180 suites, 1726/1727 — the one failure was the known
      `avatarPicker` load timeout, 10/10 when re-run alone. Per-project lists: dom 7 (identical to
      base), native 173 (base + guard suite).
- [x] Implementation review — `108aa280` (realpath root; never-matching dom `testRegex` when
      no jsdom suite exists, with guard tests), `3045ce4d` (dependabot group excludes
      `jest-expo`), `1ae3e60f` (`test` / `test:watch` forward the first CLI arg). Gates
      re-run: 180/180 suites, 1729/1729 tests; CI green at `1ae3e60f`.
