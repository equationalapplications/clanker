# LEDGER — clanker #870 web/landing follow-ups

**In flight:** implemented on `chore/web-landing-followups`; all local gates green; PR #913 draft awaiting Kurt's review (not yet marked ready).

- [x] Task 1 — `requestIdleCallback` shim → `jest.setup.js`
      Evidence: RED first (`npx jest src/utilities/__tests__/okfSave.test.ts` → 2 failed, `requestIdleCallback` not a function); GREEN after polyfill (`2 suites / 8 tests passed` incl. `useExportCharacterOKF.integration.test.ts`); commit `120775a4`.
- [x] Task 2 — `patchShell()` throws; `main()` maps to `fail()`
      Evidence: RED first (2 guard tests failed with `status` 1 = `process.exit(1)`); GREEN after (3/3); real CLI run `node scripts/finalize-web-export.mjs` → `finalize-web-export: missing dist/index.html; run expo export first`, `exit=1` (CLI loud-fail preserved); commit `07cd7ffb`.
- [x] Task 3 — `check:generated` script + `staging-test.yml` step
      Evidence (both ways, real runs): clean tree → exit 0 `✓ tracked generated outputs are up-to-date`; hand-drift of OUTPUT auto-heals (generator deterministic, exit 0 — no false positives); SOURCE drift probe in `landingConfig.ts` → exit 1 listing `M landing/index.html`; reverted → exit 0, porcelain clean. CI step added after `🧪 Test with Jest` (fetch-depth: 0 checkout verified, so git-history lastmod is stable in CI).
- [x] Task 4 — `/` divergence docs
      Evidence: "Dev/prod divergence at `/` (accepted)" section appended to `docs/superpowers/specs/2026-10-25-web-root-static-landing-design.md`; `README.md` "Other Reference" bullet added; commit `e8a8420f`.
- [x] Task 5 — full local gates + PR flip
      Evidence: `npm run typecheck` exit 0; `npm run lint:check` exit 0 (`--max-warnings 0`); `npm run test` 179/179 suites, 1721/1721 tests passed (2 projects); `npm run check:generated` exit 0 on final tree. PR #913 body flipped `Refs #870` → `Fixes #870`.
