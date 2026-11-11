# LEDGER — clanker #859 jest-config hardening (lane 1 of the #859 split)

**In flight:** spec written, draft PR open; STOPPED at Kurt's spec-approval gate. No implementation tasks started. Plan is written after spec approval (clanker convention: plan.md is gitignored, lives on disk only).

- [ ] Task 1 — `jest-docblock`-based jsdom classification (RED→GREEN with a >512-byte header fixture)
- [ ] Task 2 — `IGNORED_DIRS` root-only scoping (RED→GREEN with a `src/probe/build/x.test.ts` fixture)
- [ ] Task 3 — `escape-string-regexp` on discovered paths (identity on current tree: `--listTests` diff vs base empty)
- [ ] Task 4 — direct `jest-environment-jsdom@30.5.2` devDependency
- [ ] Task 5 — `jest.shared.config.js` extraction + `jest.evals.config.js` fix (`--listTests` loads instead of throwing)
- [ ] Task 6 — full gates (typecheck / lint:check / test with suite-count parity / `--listTests` diff) + ledger evidence + PR flip
