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

### The OTA fence — why this effort promotes as one batch

`app.config.ts:37-39` derives the OTA runtime version from the package major alone:

```ts
const breakingChangeVersion = pkg.version.split('.')[0]
const runtimeVer = breakingChangeVersion + '.0.0'
```

An OTA update only reaches an installed binary whose `runtimeVersion` matches. So a **major** bump rolls `runtimeVersion` (30.0.0 → 31.0.0) and cuts every existing install off from further OTA updates until the user installs a new binary from the store. A minor or patch bump leaves the runtime version alone and reaches existing installs over the air.

Two facts make this a live constraint rather than background trivia:

1. **One rollover is already queued and unreleased.** `main` is at `30.33.1` (tag `v30.33.1`), so `runtimeVersion` is still `30.0.0`. The reclassifying `BREAKING CHANGE:` commit described above sits on `staging`, not `main`. The next promotion fires semantic-release, bumps to `31.0.0`, and rolls the runtime version once.
2. **Phase 3 cannot ship over the air at all.** `@react-native-firebase/*`, `react-native-gesture-handler`, `react-native-webview`, and `expo-age-range` change native code. They require a new binary by construction, regardless of what semantic-release decides.

Those two facts point the same direction. If Phase 3 promotes to `main` on its own release cycle *after* the queued rollover has already fired, it burns a **second** rollover (31 → 32) and forces users through a **second** store update for one dependency effort — with a population stranded on `31.0.0` in between, able to receive neither the 30-line nor the 32-line updates.

**Therefore this effort promotes to `main` once, as a batch, with Phase 3 inside it.** The queued rollover is a fence that opens exactly once; every native change in this effort goes through it together or waits for the next one. See [Rollout](#rollout).

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

- Migrating off `react-native-gifted-chat`. That has its own spec — see [2026-08-11 gifted-chat Removal](./2026-08-11-gifted-chat-removal-design.md) — because it is API-surface work on the app's core screen, not a version bump.
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
| `express` + `@types/express` | `^4.x` | `^5.x` | cloud-agent only. **Upgrade as a pair** — `@types/express@5` against `express@4` is a type/runtime mismatch. **Shares a surface with the CORS hardening — see below.** |
| `typescript` | `~6.0.3` / `^6.0.3` | `^7.x` | All three workspaces; do it in the same phase everywhere to avoid cross-workspace type skew |
| `eslint` + `@eslint/js` | `^9.39.4` / `^9.17.0` | `^10.x` | `functions/` |
| `@types/node` | `^22.19.17` | `~24.x` | **Not 26.x.** Runtime is Node 24 |
| `@types/supertest` | `^6.0.2` | `^7.x` | Test-only |

**⚠️ Express 5 lands on top of freshly-shipped security code.** The [CORS hardening](./2026-08-11-cloud-agent-cors-hardening-design.md) is already implemented and deployed, and it is built directly on Express/Node request internals that Express 5 is entitled to move:

- `req.socket.encrypted` — `selfOrigin()` reads it to pick the `https`/`http` scheme. If it becomes undefined behind an Express 5 request wrapper, every upgrade silently derives an `http://` self-origin, the production mobile app's synthesized `https://` origin stops matching, and **every WebSocket connection 403s**.
- `req.headers.origin` — the sole input to `isAllowedWsOrigin()`. Header casing or accessor changes break the allowlist match.
- `server.on('upgrade')` — registered on the raw `http.Server`, not the Express app. Express 5 changing how the app attaches to the server can leave the handler unregistered, which fails **open**, not closed: upgrades bypass origin checking entirely.

Note the asymmetry: the first two failures are loud (everything breaks), the third is silent (the security control quietly disappears). Do not treat a green smoke test as evidence for the third.

**Mandatory for this bump:** re-run the six WebSocket upgrade tests and the four CORS HTTP tests in `cloud-agent/src/index.test.ts` — including the case asserting a **403 for a non-allowlisted origin**, which is the one that detects a vanished handler — and confirm `cors` middleware behavior is unchanged. If Express 5 destabilizes any of them, **split it out of Phase 1 into its own PR** rather than debugging it alongside a `firebase-admin` major.

**Deployment gate — non-negotiable.** **There is no live staging environment.** The `staging` branch has no deployed backend; a `cloud-agent` or `functions` deploy lands **directly in production**. Treat the deploy itself as the gate, not a rehearsal for one:

1. Deploy, then verify against production immediately — `/health`, a chat turn, a Talk session, and a Stripe webhook delivery — before considering the phase done.
2. Keep the previous Cloud Run revision ready and roll traffic back (`gcloud run services update-traffic`) on any failure rather than fixing forward.
3. Verification is a **rollback gate**: the question is not "did it deploy" but "is production still correct, and can I revert within minutes if not".

This is the same production surface (Cloud Run + Firebase Functions, Cloud SQL, Vertex AI, Stripe webhook) that has produced customer-facing incidents twice — the Stripe webhook misconfiguration and the CORS deploy that 403'd the web client. A `firebase-admin` major touching the Stripe webhook path deserves the same suspicion.

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
- `npm test` green — root baseline is **150 suites / 1378 tests** (per PR #596); `cloud-agent/` baseline is **288 tests (287 pass, 1 skipped)**
- `npx expo install --fix` reports no changes (root phases)
- `npm audit` re-run and the delta recorded in the PR body
- Phase 1 additionally: production deploy verified as a rollback gate (see Phase 1)
- Phase 3 additionally: iOS and Android native builds succeed locally

The cloud-agent number was **measured on 2026-08-11**, not copied from a plan: the suite was run five times on this branch, and four runs returned 288/287/1 exactly. It supersedes the 281 figure, which predates the now-implemented CORS hardening.

⚠️ **One known flake, so it is not mistaken for a regression.** The fifth run failed `schedulerTriggerHandler.test.js:74` — *"returns 422 when no active device"* — asserting `401 !== 422`, i.e. the request was rejected as unauthenticated before it could reach the no-active-device branch. It passed on the four other runs of the identical command. This is pre-existing and unrelated to any dependency bump. If it fires during this effort, re-run before investigating; if it starts failing consistently, that is a real signal and worth its own fix.

Baselines shift as phases land. Each PR records its own post-change numbers so the next phase has an accurate starting point.

## Rollout

**Sequential on `staging`, batched into a single promotion to `main`.** The two halves of that sentence do different jobs and neither can be dropped.

### Sequential into `staging`

Each phase is its own PR to `staging`, merged and verified before the next begins. Phases stay individually revertable while they sit there — that isolation is the entire reason for the split, and it is lost if two are in flight at once. Verification per phase is local (`npm test`, `typecheck`, and for Phase 3 real iOS and Android builds), except for the backends.

### The backends are the exception

`cloud-agent` and `functions` deploys do **not** wait for promotion, because there is nowhere for them to wait — no staging environment exists. Phase 1 deploys straight to production when it merges to `staging`, gated as described in Phase 1. So by the time promotion happens, the backend majors have already been live and observed for however long the remaining phases took. That is a feature: it is the longest production soak available, and it is why Phase 1 is ordered early.

### Batched into `main`

Phases accumulate on `staging` and promote to `main` **once, together, after Phase 3**. The reason is the [OTA fence](#the-ota-fence--why-this-effort-promotes-as-one-batch): promotion fires semantic-release, the queued `BREAKING CHANGE:` bumps the major, and `runtimeVersion` rolls 30.0.0 → 31.0.0 — cutting every installed binary off from OTA until users update from the store.

That rollover is already queued and unreleased. Phase 3's native changes need a new binary anyway. Promoting Phase 3 on a later, separate cycle would burn a second rollover and force users through a second store update for one dependency effort. **One fence, one crossing, one forced update.**

Concretely, promotion is a single `staging` → `main` PR containing Phases 0–4, which produces one `31.0.0` release, one native build, and one store submission.

### What this costs, and why it is still right

Batching means the promotion PR is large and a post-promotion problem is harder to attribute than it would be after a single-phase release. Three things hold that risk down:

- Every phase was already verified independently on `staging`, so this is a batch of *verified* changes, not a batch of unknowns.
- The backend majors — the phase most likely to cause a production incident — have already been in production since Phase 1, and their rollback path (Cloud Run revision traffic-shift) does not involve promotion at all.
- What actually lands *at* promotion is the client bundle and the native build, and the pre-promotion gate for those is a real iOS and Android build off `staging`, not a green `npm test`.

The residual risk is a bad native build reaching the store. The mitigation is the same as for any release here: `staging` is buildable and verified before the promotion PR opens, and a bad binary is fixed by a follow-up release rather than a revert, because the store rollout cannot be un-shipped either way.

## Open Questions

1. **`core-llm-tools` pinning.** Keep the exact pin (`4.17.3`) or move to a caret range matching its three siblings? Resolve in Phase 0. Recommendation: caret, since the exact pin is what allowed the drift.
2. **`@google/genai` v2 and ADK.** Whether the v2 SDK is compatible with the pinned `@google/adk` version is unverified. If it is not, `@google/genai` splits out of Phase 1 into its own PR.
3. **Residual alert tolerance.** No target count is set for alerts remaining after Phase 4. Set one once Phase 3's `npm audit` delta is known, rather than guessing now.

## Related

- [2026-08-11 cloud-agent CORS Hardening](./2026-08-11-cloud-agent-cors-hardening-design.md) — already implemented and deployed. **Not independent of this effort:** Phase 1's Express 5 bump lands directly on the request internals that hardening is built from (`req.socket.encrypted`, `req.headers.origin`, `server.on('upgrade')`). See the Express 5 warning in Phase 1.
- [2026-08-11 gifted-chat Removal](./2026-08-11-gifted-chat-removal-design.md) — follows Phase 3
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, which is later promoted to `main`
