# Dependency Security and Major Upgrades Design

**Date:** 2026-08-11
**Status:** Approved, not implemented
**Owner:** equationalapplications
**Supersedes:** the deferred-majors backlog recorded after PR #596

## Problem

Two dependency problems have converged into one effort:

1. **47 open Dependabot alerts** across root, `cloud-agent/`, and `functions/` — including `tar` at **critical** severity in both backends, and `@google/adk` as a **direct, high-severity** dependency in both.
2. **~30 deferred major version bumps.** PR #596 (Expo SDK 57, Node 24, minor/patch updates, released in 30.33.1) deliberately deferred every major to keep that PR reviewable. That deferral has now accumulated.

> **Breaking change reclassification (2026-08-11).** The Expo SDK 57 / Node 24 / minor-deps commit (`6cefac23`, PR #595) shipped as `chore(deps):` without a `BREAKING CHANGE:` footer, so semantic-release only bumped minor (to 30.33.1). The Expo SDK 56 → 57, React Native 0.85.3 → 0.86.2, and Node 22 → 24 runtime moves are breaking for mobile clients and backend runtimes and should have triggered a major version bump. A follow-up commit on PR #597 (`docs/security-and-dependency-specs`) carries a `BREAKING CHANGE:` footer reclassifying that work, so the next release surfaces the major bump that was missed in PR #596.

These are treated as one effort because they are the same work: most alerts live in transitive dependencies whose only clean resolution is upgrading the top-level package that pulls them in.

### The single most important constraint

> **`npm audit fix` is banned in this repository. Its recommendations here are downgrades.**

`npm audit` attributes a vulnerable *leaf* package up to the nearest top-level dependency. When the leaf cannot be bumped in place, it recommends reverting the parent to a pre-advisory version. Actual output from this repo on 2026-08-11:

| `npm audit` recommends | Currently on | Reality |
|---|---|---|
| `expo@53.0.27` | 57 | Downgrade — 4 majors backwards, undoes PR #596 |
| `react-native@0.72.17` | 0.86.2 | Downgrade — 14 minors backwards |
| `firebase-admin@10.3.0` | 13.x | Downgrade — 3 majors backwards |
| `drizzle-kit@0.18.1` | 0.31.10 | Downgrade |
| `semantic-release@24.2.9` | 25.0.7 | Downgrade |
| `firebase-functions-test@0.3.3` | 3.4.1 | Downgrade |

Running `npm audit fix --force` would revert the Expo 57 and Node 24 work that is already deployed and verified in production. **Every version in this effort is chosen by hand.** `npm audit` output is used only to enumerate which packages are affected, never to select a version.

### Fixed platform baseline — Expo SDK 57 and Node 24

**Expo SDK 57 and Node 24 are the platform baseline. Nothing in this effort moves backwards off either.**

- **Expo SDK 57** is the current SDK. It is what the app targets, and it stays.
- **Node 24** is the current Active LTS line (v24.19.0, "Krypton"). It is the deployed runtime everywhere: `node:24-slim` in the cloud-agent Dockerfile, `"runtime": "nodejs24"` in `firebase.json`.

Concretely:

- Any recommendation to move off Expo 57 or Node 24 — including every `npm audit` suggestion in the table above — is rejected outright.
- **Every version chosen in this effort must be compatible with Expo 57 and Node 24**, and that compatibility is the deciding criterion when a package offers several viable majors. Prefer the newest release that supports this baseline over the newest release overall.
- **`@types/node` tracks the runtime, not npm's `latest`.** `~24.x` in all three workspaces. `@types/node@26` must never be installed here — it types against a runtime that isn't deployed.
- **Expo-family packages track SDK 57**, not their own newest majors — hence `expo-age-range` → `^57.x` in Phase 3.

### Drift discovered while scoping

Reading the three `package.json` files surfaced inconsistencies not previously recorded. These are the reason Phase 0 exists:

| Package | root | cloud-agent | functions | Problem |
|---|---|---|---|---|
| `@equationalapplications/core-llm-tools` | `4.17.3` | `4.17.3` | `4.17.3` | Aligned (by commit `0320b1c7`), but pinned exactly — no patch uptake |
| `@equationalapplications/core-llm-wiki` | `^4.22.0` | `^4.17.0` | — | **Drifted 5 minors** |
| `@google/genai` | `^2.10.0` | `^1.50.1` | `^2.9.0` | **cloud-agent is a full major behind** |
| `@google/adk` | — | `^1.2.0` | `^1.1.0` | Drifted; both have high-severity alerts |
| `@types/node` | `^25.9.4` | `^22.19.17` | `^22.19.17` | **All three wrong** — runtime is Node 24 everywhere |

The `@types/node` row is the sharpest: root types against Node 25, backends type against Node 22, and the actual runtime is Node 24 (`node:24-slim` in the cloud-agent Dockerfile, `"runtime": "nodejs24"` in `firebase.json`). Root is typing against APIs the runtime does not have.

## Goals

- Resolve all Dependabot alerts that can be resolved without a downgrade.
- Land the deferred majors in independently shippable, independently revertable phases.
- Converge `@types/node` on `~24.x` across all three workspaces.
- Bring the four `@equationalapplications/*` packages back into lockstep.
- Fix `__tests__/avatarPicker.test.tsx` properly, replacing the timeout workaround.
- Leave every phase with a green `npm test` and a clean `npm run typecheck`.

## Non-Goals

- Migrating off `react-native-gifted-chat`. That has its own spec — see [2026-08-11 gifted-chat Migration](./2026-08-11-gifted-chat-fork-migration-design.md) — because it is API-surface work on the app's core screen, not a version bump.
- Resolving every alert to zero. Some transitive advisories have no non-downgrade fix; those are documented and accepted, not forced.
- Moving backwards off Expo SDK 57 or Node 24. Both are the fixed baseline — see "Fixed platform baseline" above. This includes React Native, whose version is determined by the Expo SDK.
- Addressing [issue #375](https://github.com/equationalapplications/clanker/issues/375) (librarian cost gating). Deferred; analysis recorded on the issue.

## Design

Five phases, each a separate PR targeting `staging`. Phases are ordered so that each one's failure mode is isolated and its rollback is a single revert.

### Phase 0 — internal package lockstep

**Why first:** every later phase compiles against these, and they are already drifted. Doing this last would mean re-running each phase's verification.

Move all four `@equationalapplications/*` packages to a single agreed version line across all three workspaces:

- `core-llm-tools`, `core-llm-wiki` — root, `cloud-agent/`, `functions/`
- `expo-llm-wiki`, `schema-org-llm-wiki` — root only

Re-derive the current published versions at implementation time; the 5.2.1 figure in the pre-PR-#596 notes is stale and must not be trusted. Decide deliberately whether to keep `core-llm-tools` pinned exactly (`4.17.3`) or move it to a caret range like its siblings — the exact pin is why it silently fell behind, and consistency across the four packages is the point of this phase.

**Verification:** `npm run typecheck` and `npm test` in all three workspaces. This phase is where breaking changes in the internal wiki/tools API surface will appear, so expect real code edits, not just manifest edits.

### Phase 1 — backend majors (`cloud-agent/` + `functions/`)

Highest value-to-risk ratio in the effort, and the only phase touching production runtime behavior.

**Lead with `@google/adk`.** It is the only *direct, high-severity* alert with a non-major fix available, and it is drifted between the two backends (`^1.2.0` vs `^1.1.0`). Align and upgrade both. Note that `@google/adk` transitively owns `@mikro-orm/sqlite`, `sqlite3`, `node-gyp`, `cacache`, and `make-fetch-happen` — several high-severity alerts resolve as a side effect, so re-run `npm audit` after this step before assuming later work is needed.

Then, in this order:

| Package | From | To | Notes |
|---|---|---|---|
| `@google/genai` | `^1.50.1` (cloud-agent) | align with root's `^2.x` | Major SDK rewrite; highest breakage risk here. Verify ADK integration still functions — see the edge/cloud-agent split constraints |
| `firebase-admin` | `^13.8.0` | `^14.x` | Both backends. `functions/` uses it heavily for Cloud SQL, Vertex AI, and the Stripe webhook |
| `express` + `@types/express` | `^4.x` | `^5.x` | cloud-agent only. **Upgrade as a pair** — `@types/express@5` against `express@4` is a type/runtime mismatch. Middleware ecosystem may lag; verify `cors`, rate limiting, and the `server.on('upgrade')` path |
| `typescript` | `~6.0.3` / `^6.0.3` | `^7.x` | All three workspaces; do it in the same phase everywhere to avoid cross-workspace type skew |
| `eslint` + `@eslint/js` | `^9.39.4` / `^9.17.0` | `^10.x` | `functions/` |
| `@types/node` | `^22.19.17` | `~24.x` | **Not 26.x.** Runtime is Node 24 |
| `@types/supertest` | `^6.0.2` | `^7.x` | Test-only |

**Deployment gate — non-negotiable.** Deploy `cloud-agent` and `functions` to staging and verify before promoting to production. This is the same gate PR #596 used for the Node 24 change, and the same production surface (Cloud Run + Firebase Functions, Cloud SQL, Vertex AI, Stripe webhook). A `firebase-admin` major touching the Stripe webhook path is exactly the kind of change that has caused a customer-facing incident here before.

### Phase 2 — root build and test tooling

No runtime impact on shipped app code; failures surface in CI rather than in production.

| Package | From | To |
|---|---|---|
| `jest` | `~29.7.0` | `^30.x` |
| `@types/jest` | `29.5.14` | `^30.x` |
| `@testing-library/react-native` | `^13.3.3` | `^14.x` |
| `eslint` | `^9.39.4` | `^10.x` |
| `typescript` | `~6.0.3` | `^7.x` |
| `@babel/core` | `^7.29.7` | `^8.x` |
| `@commitlint/cli` + `config-conventional` | `^20.5.3` | `^21.x` |
| `better-sqlite3` | `^12.11.1` | `^13.x` |
| `@types/node` | `^25.9.4` | `~24.x` |
| `semantic-release` chain | `^25.0.7` | current; **reject the 24.2.9 downgrade** |

**`__tests__/avatarPicker.test.tsx` is fixed in this phase**, not separately. `jest` 29→30 and RNTL 13→14 both change render and timer behavior, so fixing it in its own PR would mean doing the work twice.

*What is actually wrong:* the first `create()` in the file pays a one-off cold-render cost — rendering `AvatarPicker` lazily pulls in `FlatList`/`VirtualizedList` and the RN view tree. Roughly 600ms for test 1 against ~115ms for each subsequent test locally; on a contended CI runner that overran jest's 5s default and failed test 1. The other 8 failures were **collateral**: a test that times out mid-`act()` leaves react-test-renderer's act state broken, so every later `create()` returns an already-unmounted renderer (`Can't access .root on unmounted test renderer`). Do not chase that error — it is downstream of the first timeout.

*Current state:* passing only because of `jest.setTimeout(30_000)` (commit `f2baebbf`). That is a workaround, not a fix.

*The fix to attempt:* replace the real-time sleep in `renderPicker` with fake timers, advancing `FlatList`'s 50ms `updateCellsBatchingPeriod` deterministically instead of burning wall-clock time — approximately `jest.useFakeTimers()` plus `await act(async () => { jest.advanceTimersByTime(100) })`. Remove the 30s timeout once it passes.

*Do not repeat:* commits `700ffd64` (poll with `waitFor`) and `7786deb8` (burn a real 100ms timer under `act`) both targeted `renderPicker`'s *synchronisation*. Both were the wrong target and neither fixed CI.

*CI debugging note:* `.github/workflows/staging-test.yml` runs `npm run format` (prettier `--write`) **before** the test step, so stack-trace line numbers in CI logs sit ~28 lines below the committed file. This file also does not satisfy `prettier --check` on HEAD — pre-existing, self-corrects in CI.

### Phase 3 — root runtime and native

Highest blast radius: these ship inside the app binary and can break native builds.

| Package | From | To | Notes |
|---|---|---|---|
| `@react-native-firebase/*` (7 packages) | `^23.8.8` | `^26.x` | **All seven move together.** Mixed majors across this scope is unsupported |
| `react-native-gesture-handler` | `~2.32.0` | `^3.x` | Touch handling across every screen |
| `react-native-webview` | `13.16.1` | `^14.x` | |
| `react-native-error-boundary` | `^2.0.0` | `^3.x` | |
| `zod-validation-error` | `^4.0.2` | `^5.x` | |
| `react-native-reanimated` / `react-native-worklets` | current | current; **reject downgrade** | audit suggests reverting; verify the pair stays version-compatible |
| `expo-age-range` | `^56.0.5` | `^57.x` | **Regenerate `patches/expo-age-range+56.0.5.patch`.** It currently applies to 56.0.6 with a version-drift warning; the filename must match the new version |

**Requires native verification**, which CI does not cover: `cd ios && pod install` plus a real iOS build, and `./gradlew clean` plus a real Android build. Do not merge on a green `npm test` alone.

### Phase 4 — overrides sweep

Whatever alerts survive Phases 0–3 get pinned to safe versions via `overrides` in the relevant `package.json`. Expected residue, mostly inside the Expo/Metro and semantic-release toolchains:

`tar` (critical, both backends) · `@opentelemetry/*` (11 packages) · `cacache` · `node-gyp` · `make-fetch-happen` · `sqlite3` · `adm-zip` · `js-yaml` · `ip-address` · `image-size` · `undici` · `uuid` · `@tootallnate/once` · `esbuild` · `brace-expansion` · `html-minifier`

Rules for this phase:

1. **Re-enumerate first.** Phases 0–3 will have resolved a large share of these. Overriding a package that no longer needs it adds permanent maintenance cost for nothing.
2. **Every override carries an adjacent tracked-document rationale** naming the alert it addresses and the condition under which it can be removed. `package.json` is strict JSON and cannot carry comments, so the rationale lives in `docs/<workspace>/dependency-overrides.md` (or an equivalent tracked Markdown file colocated with the workspace) and the override's `package.json` entry carries a stable key that the document reads back. Un-annotated overrides become permanent by default.
3. **An override is a last resort**, used when no non-downgrade upgrade path exists. It forces a version the parent package did not test against.
4. **Root alerts are build-time.** The Expo/Metro/semantic-release alerts affect the build host, not the shipped app bundle. Weigh them accordingly against the risk of forcing a version Metro was not tested with.
5. **Document accepted residue.** Any alert left open at the end needs a recorded reason. "Still open" without a reason is indistinguishable from "overlooked".

## Testing

Per phase, before the PR is opened:

- `npm install` completes clean in each touched workspace
- `npm run typecheck` clean
- `npm test` green — root baseline is **150 suites / 1378 tests** (per PR #596); `cloud-agent/` baseline is **281 tests** (280 pass, 1 skipped)
- `npx expo install --fix` reports no changes (root phases)
- `npm audit` re-run and the delta recorded in the PR body
- Phase 1 additionally: staging deploy verified before production
- Phase 3 additionally: iOS and Android native builds succeed locally

Baselines shift as phases land. Each PR records its own post-change numbers so the next phase has an accurate starting point.

## Rollout

Sequential. Each phase merges to `staging`, is verified, and reaches production before the next begins. Phases are individually revertable — that isolation is the entire reason for the split, and it is lost if two are in flight at once.

Phase 1 is the only one that can cause a production incident on merge; Phase 3 is the only one that can break a release build. Both deserve their own release cycle rather than being batched.

## Open Questions

1. **`core-llm-tools` pinning.** Keep the exact pin (`4.17.3`) or move to a caret range matching its three siblings? Resolve in Phase 0. Recommendation: caret, since the exact pin is what allowed the drift.
2. **`@google/genai` v2 and ADK.** Whether the v2 SDK is compatible with the pinned `@google/adk` version is unverified. If it is not, `@google/genai` splits out of Phase 1 into its own PR.
3. **Residual alert tolerance.** No target count is set for alerts remaining after Phase 4. Set one once Phase 3's `npm audit` delta is known, rather than guessing now.

## Related

- [2026-08-11 cloud-agent CORS Hardening](./2026-08-11-cloud-agent-cors-hardening-design.md) — parallel security work, no shared files
- [2026-08-11 gifted-chat Migration](./2026-08-11-gifted-chat-fork-migration-design.md) — follows Phase 3
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, which is later promoted to `main`
