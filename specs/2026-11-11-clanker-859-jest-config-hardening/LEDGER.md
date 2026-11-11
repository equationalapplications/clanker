# LEDGER — clanker #859 jest-config hardening (lane 1 of the #859 split)

**In flight:** spec reviewed (findings M1–M4, S1–S6 folded in); plan written (`plan.md`,
gitignored); implementation starting.

- [ ] Task 1 — extract `jest.shared.config.js` (behaviour-free; per-project `--listTests` unchanged)
- [ ] Task 2 — Jest-accurate docblock classification, root-only `IGNORED_DIRS`, `escapeRegExp` - guard suite `__tests__/jestSharedConfig.test.ts`; direct devDeps `jest-docblock`,
      `jest-environment-jsdom` (lockfile delta: root entry only)
- [ ] Task 3 — anchored, escaped dom `testRegex` / native ignore patterns (probe RED→GREEN)
- [ ] Task 4 — `jest.evals.config.js` loads (`--listTests` lists the one `.int.test.ts`);
      dependabot `jest` group
- [ ] Task 5 — full gates (typecheck / lint:check / format:check / check:generated / test) + evidence
