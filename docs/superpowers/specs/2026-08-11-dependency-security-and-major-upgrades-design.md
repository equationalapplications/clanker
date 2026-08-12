# Dependency Security and Major Upgrades Design

**Date:** 2026-08-11
**Revised:** 2026-08-12 — every version target below re-verified against the npm registry and the three `package.json` files. See [Revision log](#revision-log-2026-08-12).
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

Those two facts point the same direction. If Phase 3 promotes to `main` on its own release cycle _after_ the queued rollover has already fired, it burns a **second** rollover (31 → 32) and forces users through a **second** store update for one dependency effort — with a population stranded on `31.0.0` in between, able to receive neither the 30-line nor the 32-line updates.

**Therefore this effort promotes to `main` once, as a batch, with Phase 3 inside it.** The queued rollover is a fence that opens exactly once; every native change in this effort goes through it together or waits for the next one. See [Rollout](#rollout).

### The single most important constraint

> **`npm audit fix` is banned in this repository. Its recommendations here are downgrades.**

`npm audit` attributes a vulnerable _leaf_ package up to the nearest top-level dependency. When the leaf cannot be bumped in place, it recommends reverting the parent to a pre-advisory version. Actual output from this repo on 2026-08-11:

| `npm audit` recommends          | Currently on | Reality                                        |
| ------------------------------- | ------------ | ---------------------------------------------- |
| `expo@53.0.27`                  | 57           | Downgrade — 4 majors backwards, undoes PR #596 |
| `react-native@0.72.17`          | 0.86.2       | Downgrade — 14 minors backwards                |
| `firebase-admin@10.3.0`         | 13.x         | Downgrade — 3 majors backwards                 |
| `drizzle-kit@0.18.1`            | 0.31.10      | Downgrade                                      |
| `semantic-release@24.2.9`       | 25.0.7       | Downgrade                                      |
| `firebase-functions-test@0.3.3` | 3.4.1        | Downgrade                                      |

Running `npm audit fix --force` would revert the Expo 57 and Node 24 work that is already deployed and verified in production. **Every version in this effort is chosen by hand.** `npm audit` output is used only to enumerate which packages are affected, never to select a version.

### Fixed platform baseline — Expo SDK 57, Node 24, TypeScript 6

**Expo SDK 57, Node 24, and TypeScript 6 are the platform baseline. Nothing in this effort moves off any of them — backwards or forwards.**

- **Expo SDK 57** is the current SDK. It is what the app targets, and it stays.
- **Node 24** is the current Active LTS line (v24.19.0, "Krypton"). It is the deployed runtime everywhere: `node:24-slim` in the cloud-agent Dockerfile, `"runtime": "nodejs24"` in `firebase.json`.
- **TypeScript 6** (`6.0.3`, the head of the 6 line) stays in all three workspaces. TypeScript 7 is explicitly **out of scope** — see below.

Concretely:

- Any recommendation to move off Expo 57 or Node 24 — including every `npm audit` suggestion in the table above — is rejected outright.
- **Every version chosen in this effort must be compatible with Expo 57, Node 24, and TypeScript 6**, and that compatibility is the deciding criterion when a package offers several viable majors. Prefer the newest release that supports this baseline over the newest release overall.
- **`@types/node` tracks the runtime, not npm's `latest`.** `~24.x` in all three workspaces — currently `24.13.3`. `@types/node@25` (root today) and `@types/node@26` (npm `latest`) must both stay out — they type against runtimes that aren't deployed.
- **Expo-family packages track SDK 57**, not their own newest majors — hence `expo-age-range` → `^57.x` in Phase 3.

#### Why TypeScript 7 is excluded

`typescript@7.0.2` is npm `latest`, and the original draft of this spec moved all three workspaces onto it. That is reversed. TypeScript 7 is the **native (Go) port**, not an incremental major, and four facts rule it out of a dependency-security effort:

1. **The published package confirms the rewrite.** `typescript@6.0.3` ships `bin: { tsc, tsserver }`. `typescript@7.0.2` ships `bin: { tsc }` — the language-service binary is gone. Anything consuming the compiler API or shelling out to `tsserver` is on untested ground.
2. **`typescript-eslint` cannot follow.** `functions/` depends on `typescript-eslint@^8.58.2`. Its peer range is `typescript: >=4.8.4 <6.1.0` — and that is still true at `8.67.0`, the current latest. **No released version of typescript-eslint accepts TypeScript 7.** Moving `functions/` to TS 7 means deleting its type-aware lint setup (`functions/eslint.config.js`, `npm run lint`).
3. **It closes zero Dependabot alerts.** TS 7 is a compile-speed change. This effort exists to resolve security alerts and unblock deferred majors; it is neither.
4. **TypeScript 6 is not stale.** `6.0.3` is the head of the 6 line and the version already installed.

Point 2 is the hard blocker; points 1, 3, and 4 are why it isn't worth working around. **TypeScript 7 gets its own effort**, whose entry condition is a `typescript-eslint` release supporting it, and whose scope includes auditing every tool that touches the compiler API.

`typescript-eslint` itself stays at `^8.x` in `functions/` for the same reason — 8 is the current line, not a deferred major.

### Drift discovered while scoping

Reading the three `package.json` files surfaced inconsistencies not previously recorded. These are the reason Phase 0 exists:

| Package                                  | root      | cloud-agent | functions   | Problem                                                                                                                            |
| ---------------------------------------- | --------- | ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@equationalapplications/core-llm-tools` | `4.17.3`  | `4.17.3`    | `4.17.3`    | Aligned (by commit `0320b1c7`), but pinned exactly — no patch uptake                                                               |
| `@equationalapplications/core-llm-wiki`  | `^4.22.0` | `^4.17.0`   | —           | **Drifted 5 minors**                                                                                                               |
| `@google/genai`                          | `^2.10.0` | `^1.50.1`   | `^2.9.0`    | **cloud-agent is a full major behind**                                                                                             |
| `@google/adk`                            | —         | `^1.2.0`    | `^1.1.0`    | Drifted; both have high-severity alerts                                                                                            |
| `@types/node`                            | `^25.9.4` | `^22.19.17` | `^22.19.17` | **All three wrong** — runtime is Node 24 everywhere                                                                                |
| `expo-speech-recognition`                | `~56.0.1` | —           | —           | **Dead JS dependency** left on SDK 56 — no imports anywhere since `c695ab0e`. Its config plugin is still load-bearing; see Phase 3 |

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
- Moving off Expo SDK 57, Node 24, or TypeScript 6. All three are the fixed baseline — see "Fixed platform baseline" above. This includes React Native, whose version is determined by the Expo SDK.
- **Upgrading to TypeScript 7.** Blocked by `typescript-eslint`, and a native-port rewrite rather than an incremental major. It gets its own effort — see [Why TypeScript 7 is excluded](#why-typescript-7-is-excluded).
- Addressing [issue #375](https://github.com/equationalapplications/clanker/issues/375) (librarian cost gating). Deferred; analysis recorded on the issue.

## Design

Five phases, each a separate PR targeting `staging`. Phases are ordered so that each one's failure mode is isolated and its rollback is a single revert.

### Phase 0 — internal package lockstep (and a 4.x → 5.x major)

**Why first:** every later phase compiles against these, and they are already drifted. Doing this last would mean re-running each phase's verification.

**This is not a cheap warm-up phase.** The original draft told the implementer that "the 5.2.1 figure in the pre-PR-#596 notes is stale and must not be trusted." That was wrong, and the instruction is withdrawn. As verified on 2026-08-12, `5.2.1` is the **current `latest` for all four packages**:

| Package               | in repo                                    | latest 4.x | latest  |
| --------------------- | ------------------------------------------ | ---------- | ------- |
| `core-llm-tools`      | `4.17.3` (exact, all 3 workspaces)         | `4.23.1`   | `5.2.1` |
| `core-llm-wiki`       | `^4.22.0` (root) / `^4.17.0` (cloud-agent) | `4.23.1`   | `5.2.1` |
| `expo-llm-wiki`       | `^4.22.0` (root)                           | `4.23.1`   | `5.2.1` |
| `schema-org-llm-wiki` | `^4.22.0` (root)                           | `4.23.1`   | `5.2.1` |

So Phase 0 is a **major bump of the packages every later phase compiles against**, not a version-string alignment. `core-llm-wiki@5.2.1` also introduces a new transitive dependency, `@equationalapplications/core-okf@5.2.1`, which did not exist in the 4.x line.

Workspace scope — note this is **two** workspaces for the wiki packages, not three:

- `core-llm-tools` — root, `cloud-agent/`, `functions/`
- `core-llm-wiki` — root, `cloud-agent/` (**`functions/` does not depend on it**)
- `expo-llm-wiki`, `schema-org-llm-wiki` — root only

**Two decisions to make at implementation time:**

1. **5.x or 4.23.1?** Aligning on `4.23.1` fixes the drift with no API migration and is a legitimate answer if the 5.x changelog is large. Aligning on `5.2.1` is the better end state but makes this the riskiest phase in the effort rather than the safest. Read the 5.0.0 release notes before choosing; do not default to `latest` because it is `latest`. If 5.x is chosen, all four packages move together — mixed 4.x/5.x across the internal packages is not a supported configuration.
2. **Keep `core-llm-tools` pinned exactly (`4.17.3`) or move it to a caret range like its siblings?** Recommendation: caret, since the exact pin is what allowed the drift. Consistency across the four packages is the point of this phase.

**Compatibility note:** `expo-llm-wiki@5.2.1` peers `expo-sqlite: ^14 || ^15 || ^55 || ^56 || ^57` and the repo is on `~57.0.1`, so the SDK 57 baseline is safe on the 5.x line. `core-llm-wiki@5.2.1` declares `engines: { node: ">=20" }` — compatible with Node 24.

**Verification:** `npm run typecheck` and `npm test` in all three workspaces. This phase is where breaking changes in the internal wiki/tools API surface will appear, so expect real code edits, not just manifest edits — and expect substantially more of them if 5.x is chosen.

### Phase 1 — backend majors (`cloud-agent/` + `functions/`)

Highest value-to-risk ratio in the effort, and the only phase touching production runtime behavior.

**Lead with `@google/adk` — and understand that it drags `@google/genai` with it.** ADK is the only _direct, high-severity_ alert with a non-major fix available, and it is drifted between the two backends (`^1.2.0` vs `^1.1.0`). Align and upgrade both.

**`@google/adk` and `@google/genai` are one step, not two.** Verified 2026-08-12:

- `@google/adk@1.2.0` depends on `@google/genai@^1.37.0` — which is _why_ cloud-agent sits on genai `^1.50.1`.
- `@google/adk@1.6.0` (current latest) depends on `@google/genai@^2.9.0`.

So bumping ADK **forces** genai v2 in cloud-agent. There is no configuration where they move separately, and the original "if genai v2 is incompatible with ADK, split it into its own PR" escape hatch does not exist — genai v2 is what current ADK requires. Plan them as a single change with a single rollback.

**⚠️ Do not assume the ADK bump clears the sqlite3 alert chain.** The original draft claimed `@mikro-orm/sqlite`, `sqlite3`, `node-gyp`, `cacache`, and `make-fetch-happen` "resolve as a side effect." Verified against the registry, that is unlikely: both `@google/adk@1.2.0` and `@google/adk@1.6.0` declare the same five `@mikro-orm/*` drivers as **non-optional `peerDependencies` with no `peerDependenciesMeta`**, so npm auto-installs all of them — including `@mikro-orm/sqlite` and its `sqlite3` → `node-gyp` → `cacache` → `make-fetch-happen` chain — both before and after the bump. That residue is **Phase 4 `overrides` work**, not a Phase 1 freebie. Re-run `npm audit` after this step and record the actual delta rather than the expected one.

**`functions/package.json` already carries a scoped override on this exact package**, verified 2026-08-12:

```json
"overrides": {
  "@google/adk": { "js-yaml": "4.3.0" }
}
```

Check whether the upgrade makes it removable; if so, remove it here rather than leaving it for Phase 4 (Phase 4 rule 1 — an override that is no longer needed is permanent maintenance cost for nothing). `functions/` also carries three other un-annotated overrides at the top level — `ws: 8.21.1`, `uuid: ^11.1.1`, `protobufjs: 7.6.5` — which belong in the same Phase 4 audit as root's `@babel/core`/`postcss` pair.

Then, in this order:

| Package                         | From                                                 | To                                                  | Notes                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@google/adk` + `@google/genai` | adk `^1.2.0`/`^1.1.0`, genai `^1.50.1` (cloud-agent) | adk `^1.6.x` both backends; genai `^2.x` everywhere | **One step** — current ADK requires genai `^2.9.0`. Major SDK rewrite on the genai side; highest breakage risk in this phase. Verify ADK integration still functions — see the edge/cloud-agent split constraints |
| `firebase-admin`                | `^13.8.0`                                            | `^14.x`                                             | Both backends. `functions/` uses it heavily for Cloud SQL, Vertex AI, and the Stripe webhook                                                                                                                      |
| `express` + `@types/express`    | `^4.x`                                               | `^5.x`                                              | cloud-agent only. **Upgrade as a pair** — `@types/express@5` against `express@4` is a type/runtime mismatch. **Shares a surface with the CORS hardening — see below.**                                            |
| `eslint` + `@eslint/js`         | `^9.39.4` / `^9.17.0`                                | `^10.x`                                             | `functions/`. `typescript-eslint@^8.x` already peers `eslint: ^8.57                                                                                                                                               |     | ^9  |     | ^10`, so it does not block this |
| `@types/node`                   | `^22.19.17`                                          | `~24.x` (currently `24.13.3`)                       | **Not 25.x, not 26.x.** Runtime is Node 24                                                                                                                                                                        |
| `@types/supertest`              | `^6.0.2`                                             | `^7.x`                                              | Test-only                                                                                                                                                                                                         |
| ~~`typescript`~~                | `^6.0.3`                                             | **no change**                                       | **Removed from this effort.** TS 7 is the native Go port and `typescript-eslint` has no release supporting it — see [Why TypeScript 7 is excluded](#why-typescript-7-is-excluded)                                 |

**Express 5 leaves a second Express in the cloud-agent tree.** `@google/adk@1.6.0` depends on `express@^4.22.1`, so after the Phase 1 bump the tree carries both express 5 (direct) and express 4 (under ADK). This is tolerable — they are separate instances and ADK does not share a router with the app — but it has one hard consequence: **do not add an `overrides` entry forcing express 5 tree-wide in Phase 4.** That would hand ADK a major it was not built against.

#### Shared surface with the CORS hardening

The [cloud-agent CORS Hardening](./2026-08-11-cloud-agent-cors-hardening-design.md) spec is implemented and merged (`853ccbdd`). It landed security logic in `cloud-agent/src/index.ts` directly on the Express/Node request internals that this phase's `express` 4 → 5 bump is entitled to move. **These two specs are no longer file-independent.** Before merging the express bump, verify each of these, current as of 2026-08-12:

- **`req.socket.encrypted`** — `selfOrigin()` (`index.ts:204`) reads it to pick the `https`/`http` scheme. If it becomes undefined behind an Express 5 request wrapper, every upgrade silently derives an `http://` self-origin, the production mobile app's synthesized `https://` origin stops matching, and **every WebSocket connection 403s**.
- **`req.headers.origin`** — the sole input to `isAllowedWsOrigin()`. Header casing or accessor changes break the allowlist match.
- **`server.on('upgrade')`** in `attachWebSocketRoutes` (`index.ts:605`) — registered on the raw `http.Server`, not the Express app. Express 5 does not own that handler directly, but it does own the `http.Server` the handler is attached to; a change in how the app attaches to the server can leave the handler unregistered, which fails **open**, not closed — upgrades bypass origin checking entirely.
- **`cors@2.8.6` against express 5.** The middleware is express-4-era. The hardening depends on `origin: false` meaning _omit `Access-Control-Allow-Origin`_, not _reject the request_ — non-browser callers must stay unaffected. Confirm that semantic survives the upgrade, and bump `cors`/`@types/cors` if express 5 requires it.
- **`express-rate-limit@^8.5.2`** — confirm express 5 support.

Note the asymmetry among the first three: the first two failures are loud (everything breaks), the third is silent (the security control quietly disappears). Do not treat a green smoke test as evidence for the third.

**Mandatory for this bump — re-run the full CORS/WebSocket regression net in `cloud-agent/src/index.test.ts`.** Counted 2026-08-12 (supersedes any earlier count in this document, which predates the current test file): **7 WebSocket upgrade tests** (no-Origin server-to-server, own http origin, own https origin behind a TLS-terminating proxy, rejected-when-unset, allowlisted, `chrome-extension://` allowlisted, non-allowlisted rejected) and **5 CORS HTTP tests** (`Access-Control-Allow-Origin` when set, `chrome-extension://` origin allowed, preflight on `/agent/run`, wildcard rejected, blocked when unset). The non-allowlisted-origin-rejected case in each set is the one that detects a vanished handler — it is the highest-signal test in the phase and must stay green, not merely "the suite passes." If Express 5 destabilizes any of them, **split it out of Phase 1 into its own PR** rather than debugging it alongside a `firebase-admin` major.

**Deployment gate — non-negotiable.** **There is no live staging environment.** The `staging` branch has no deployed backend; a `cloud-agent` or `functions` deploy lands **directly in production**. Treat the deploy itself as the gate, not a rehearsal for one:

1. Deploy cloud-agent via `cloud-agent/scripts/deploy.sh`, which supplies a `CORS_ORIGIN` default (`deploy.sh:32`, `https://clanker-ai.com,https://clanker-prod.web.app,https://clanker-prod.firebaseapp.com`). **A deploy by any other path must set `CORS_ORIGIN` explicitly** — omitting it is exactly what caused the 2026-08-11 incident, and this phase redeploys the same service.
2. Verify against production immediately — `/health`, a chat turn, a Talk session, and a Stripe webhook delivery, **plus the web client at `https://clanker-ai.com`** (chat turn + Talk session) since the web path is the one this surface breaks — before considering the phase done.
3. **Rollback is asymmetric between the two deploys.** Cloud Run rolls back with `gcloud run services update-traffic` to the previous revision — fast, and does not involve promotion. **Firebase Functions has no traffic-split equivalent**; a bad `firebase-admin` major there is revert-and-redeploy, on a path that includes the Stripe webhook, which has already caused a customer-facing incident here. Weigh the two deploys separately rather than treating them as one gate.
4. Verification is a **rollback gate**: the question is not "did it deploy" but "is production still correct, and can I revert within minutes if not".

This is the same production surface (Cloud Run + Firebase Functions, Cloud SQL, Vertex AI, Stripe webhook) that has produced customer-facing incidents twice — the Stripe webhook misconfiguration and the CORS deploy that 403'd the web client. A `firebase-admin` major touching the Stripe webhook path deserves the same suspicion.

### Phase 2 — root build and test tooling

No runtime impact on shipped app code; failures surface in CI rather than in production.

| Package                                   | From       | To                                                                                |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `jest`                                    | `~29.7.0`  | `^30.x`                                                                           |
| `@types/jest`                             | `29.5.14`  | `^30.x`                                                                           |
| `@testing-library/react-native`           | `^13.3.3`  | `^14.x`                                                                           |
| `eslint`                                  | `^9.39.4`  | `^10.x`                                                                           |
| `@babel/core`                             | `^7.29.7`  | `^8.x` — **also update the existing `overrides` entry, see below**                |
| `@commitlint/cli` + `config-conventional` | `^20.5.3`  | `^21.x`                                                                           |
| `better-sqlite3`                          | `^12.11.1` | `^13.x`                                                                           |
| `@types/node`                             | `^25.9.4`  | `~24.x` (currently `24.13.3`)                                                     |
| `semantic-release` chain                  | `^25.0.7`  | current; **reject the 24.2.9 downgrade**                                          |
| ~~`typescript`~~                          | `~6.0.3`   | **no change** — see [Why TypeScript 7 is excluded](#why-typescript-7-is-excluded) |

**⚠️ `@babel/core` is already pinned by a root `overrides` entry.** Root `package.json` carries:

```json
"overrides": {
  "@babel/core": "^7.29.7",
  "postcss": "8.5.24"
}
```

Bumping the `devDependencies` entry to `^8.x` while leaving the override at `^7.29.7` will **silently pin the whole tree back to Babel 7** — `npm install` succeeds, `npm test` may well pass, and the upgrade quietly does nothing. Both entries move together or neither does. `eslint-config-expo` peers `eslint: >=8.10`, so the ESLint 10 bump is unconstrained here.

**Nothing else in the root toolchain constrains these bumps.** Verified 2026-08-12: `jest-expo`, `@testing-library/react-native`, `prettier`, `eslint-config-expo`, `drizzle-kit`, `tsx`, and `semantic-release` declare no `typescript` peer, and `jest-expo@~57.0.4`'s only sharp peer is `@react-native/jest-preset: ^0.86.2`, which matches the installed `react-native@0.86.2`.

**`__tests__/avatarPicker.test.tsx` is fixed in this phase**, not separately. `jest` 29→30 and RNTL 13→14 both change render and timer behavior, so fixing it in its own PR would mean doing the work twice.

_What is actually wrong:_ the first `create()` in the file pays a one-off cold-render cost — rendering `AvatarPicker` lazily pulls in `FlatList`/`VirtualizedList` and the RN view tree. Roughly 600ms for test 1 against ~115ms for each subsequent test locally; on a contended CI runner that overran jest's 5s default and failed test 1. The other 8 failures were **collateral**: a test that times out mid-`act()` leaves react-test-renderer's act state broken, so every later `create()` returns an already-unmounted renderer (`Can't access .root on unmounted test renderer`). Do not chase that error — it is downstream of the first timeout.

_Current state:_ passing only because of `jest.setTimeout(30_000)` (commit `f2baebbf`). That is a workaround, not a fix.

_The fix to attempt:_ replace the real-time sleep in `renderPicker` with fake timers, advancing `FlatList`'s 50ms `updateCellsBatchingPeriod` deterministically instead of burning wall-clock time — approximately `jest.useFakeTimers()` plus `await act(async () => { jest.advanceTimersByTime(100) })`. Remove the 30s timeout once it passes.

_Do not repeat:_ commits `700ffd64` (poll with `waitFor`) and `7786deb8` (burn a real 100ms timer under `act`) both targeted `renderPicker`'s _synchronisation_. Both were the wrong target and neither fixed CI.

_CI debugging note (historical — fixed 2026-08-12):_ `.github/workflows/staging-test.yml` used to run `npm run format` (prettier `--write`) **before** the test step, which rewrote the tree in place — so stack-trace line numbers in CI logs sat below the line numbers in the committed file, and a repo-wide formatting sweep was hiding inside every test run's diff. The workflow now runs `npm run format:check` (a non-writing gate) instead, so CI logs and the committed file agree. See [Revision log](#revision-log-2026-08-12).

### Phase 3 — root runtime and native

Highest blast radius: these ship inside the app binary and can break native builds.

| Package                                             | From      | To                            | Notes                                                                                                                                                      |
| --------------------------------------------------- | --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@react-native-firebase/*` (7 packages)             | `^23.8.8` | `^26.x`                       | **All seven move together.** Mixed majors across this scope is unsupported                                                                                 |
| `react-native-gesture-handler`                      | `~2.32.0` | `^3.x`                        | Touch handling across every screen                                                                                                                         |
| `react-native-webview`                              | `13.16.1` | `^14.x`                       |                                                                                                                                                            |
| `react-native-error-boundary`                       | `^2.0.0`  | `^3.x`                        |                                                                                                                                                            |
| `zod-validation-error`                              | `^4.0.2`  | `^5.x`                        |                                                                                                                                                            |
| `react-native-reanimated` / `react-native-worklets` | current   | current; **reject downgrade** | audit suggests reverting; verify the pair stays version-compatible                                                                                         |
| `expo-age-range`                                    | `^56.0.5` | `^57.x` (latest `57.0.3`)     | **Regenerate `patches/expo-age-range+56.0.5.patch`.** It currently applies to 56.0.6 with a version-drift warning; the filename must match the new version |
| `expo-speech-recognition`                           | `~56.0.1` | **remove — see below**        | Dead JS dependency, but its config plugin supplies the microphone permission. Removal requires transplanting that permission first                         |

#### Removing `expo-speech-recognition` — the microphone permission must move first

Verified 2026-08-12. This package has **no JavaScript consumers anywhere in the repo** — zero imports in `src/`, `app/`, or `__tests__/`; the only references outside `package-lock.json` are `package.json:83` and the plugin entry at `app.config.ts:232`. It was added by `53e32c3d` ("feat(voice): add Talk tab") for `src/hooks/useVoiceChat.ts`, which `c695ab0e` ("feat(talk): add Gemini Live voice chat via XState machine and audio hooks") **deleted** when it replaced the walkie-talkie flow with continuous streaming via `src/machines/liveVoiceMachine.ts` and `src/hooks/useLiveVoiceChat.ts` on `@speechmatics/expo-two-way-audio`. The dependency was never cleaned up.

**But it is not inert.** `node_modules/expo-speech-recognition/app.plugin.js` writes four things into the generated native projects:

| Writes                                                                           | Still needed?      |
| -------------------------------------------------------------------------------- | ------------------ |
| `NSMicrophoneUsageDescription` (iOS)                                             | **Yes — critical** |
| `android.permission.RECORD_AUDIO`                                                | **Yes — critical** |
| `NSSpeechRecognitionUsageDescription` (iOS)                                      | No                 |
| `<queries>` for `com.google.android.googlequicksearchbox` + `RecognitionService` | No                 |

⚠️ **`@speechmatics/expo-two-way-audio` ships no config plugin at all** — no `app.plugin.js`, and its `expo-module.config.json` declares native modules only. It declares no permissions and instead asserts them at runtime:

```swift
// node_modules/@speechmatics/expo-two-way-audio/ios/MicrophonePermissionRequester.swift:17
guard (Bundle.main.infoDictionary?["NSMicrophoneUsageDescription"]) != nil else {
  fatalError("This app is missing NSMicrophoneUsageDescription, so audio services will fail...")
}
```

`app.config.ts`'s `ios.infoPlist` block declares only `NSPhotoLibraryUsageDescription`. So the `expo-speech-recognition` plugin's `microphonePermission` option is the **sole** source of the microphone string in the built `Info.plist`. **Deleting the package without replacing it is a hard `fatalError` crash on the Talk tab, not a graceful permission denial** — and it is invisible to `npm test`, `npm run typecheck`, and OTA, surfacing only in a native build.

**Do it in one commit, in this order:**

1. Add `NSMicrophoneUsageDescription` to the existing `ios.infoPlist` block (`app.config.ts:139`), reusing the current copy string.
2. Add `android.permissions: ['android.permission.RECORD_AUDIO']`.
3. Then remove the `expo-speech-recognition` dependency and its `plugins` entry, letting `NSSpeechRecognitionUsageDescription` and the Android `<queries>` block go with them.

**Verify by diffing the generated manifests, not by running tests.** After `npx expo prebuild --clean`, confirm `ios/*/Info.plist` still carries `NSMicrophoneUsageDescription` and no longer carries `NSSpeechRecognitionUsageDescription`, and that `AndroidManifest.xml` still carries `RECORD_AUDIO` and no longer carries the speech-service `<queries>` block. Then exercise the Talk tab on a real device on both platforms.

Beyond dead-code hygiene, this drops a speech-recognition permission the app does not use — one less declaration to justify in App Store and Play review.

**Do not disturb `patches/@speechmatics+expo-two-way-audio+0.1.2.patch`.** `@speechmatics/expo-two-way-audio` is pinned exactly at `0.1.2` and is not in this effort's scope; the patch filename is version-keyed the same way the `expo-age-range` one is, and any incidental bump breaks it. Note the coupling with the removal above: this package supplies live voice but declares none of its own permissions.

**Requires native verification**, which CI does not cover: `cd ios && pod install` plus a real iOS build, and `./gradlew clean` plus a real Android build. Do not merge on a green `npm test` alone.

### Phase 4 — overrides sweep

Whatever alerts survive Phases 0–3 get pinned to safe versions via `overrides` in the relevant `package.json`. Expected residue, mostly inside the Expo/Metro and semantic-release toolchains:

`tar` (critical, both backends) · `@opentelemetry/*` (11 packages) · `cacache` · `node-gyp` · `make-fetch-happen` · `sqlite3` · `adm-zip` · `js-yaml` · `ip-address` · `image-size` · `undici` · `uuid` · `@tootallnate/once` · `esbuild` · `brace-expansion` · `html-minifier`

Rules for this phase:

1. **Re-enumerate first, and audit the overrides that already exist.** Phases 0–3 will have resolved a large share of these. Overriding a package that no longer needs it adds permanent maintenance cost for nothing. Verified 2026-08-12, **six un-annotated overrides predate this effort and have no recorded rationale**:

   | Workspace    | Override                          | Note                                                                                      |
   | ------------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
   | root         | `@babel/core: ^7.29.7`            | must have moved to `^8.x` in Phase 2, or the Babel bump did nothing                       |
   | root         | `postcss: 8.5.24`                 | live — currently overriding `expo@57 → @expo/metro-config@57.0.8`'s postcss dependency    |
   | `functions/` | `@google/adk: { js-yaml: 4.3.0 }` | scoped to ADK specifically; check removability once Phase 1's ADK bump lands, per Phase 1 |
   | `functions/` | `ws: 8.21.1`                      |                                                                                           |
   | `functions/` | `uuid: ^11.1.1`                   |                                                                                           |
   | `functions/` | `protobufjs: 7.6.5`               |                                                                                           |

   All six need a rationale under rule 4.

2. **Expect the `sqlite3` chain to still be here.** `@mikro-orm/sqlite`, `sqlite3`, `node-gyp`, `cacache`, and `make-fetch-happen` arrive as auto-installed non-optional peers of `@google/adk` and survive the Phase 1 bump (see Phase 1). Note that all five DB drivers (`mariadb`, `mssql`, `mysql`, `postgresql`, `sqlite`) get installed even though only one is used — check whether they can be pruned rather than overridden.
3. **Do not force `express@5` tree-wide.** ADK depends on `express@^4.22.1`; a tree-wide override hands it an untested major. See Phase 1.
4. **Every override carries an adjacent tracked-document rationale** naming the alert it addresses and the condition under which it can be removed. `package.json` is strict JSON and cannot carry comments, so the rationale lives in `docs/<workspace>/dependency-overrides.md` (or an equivalent tracked Markdown file colocated with the workspace) and the override's `package.json` entry carries a stable key that the document reads back. Un-annotated overrides become permanent by default.
5. **An override is a last resort**, used when no non-downgrade upgrade path exists. It forces a version the parent package did not test against.
6. **Root alerts are build-time.** The Expo/Metro/semantic-release alerts affect the build host, not the shipped app bundle. Weigh them accordingly against the risk of forcing a version Metro was not tested with.
7. **Document accepted residue.** Any alert left open at the end needs a recorded reason. "Still open" without a reason is indistinguishable from "overlooked".

## Testing

Per phase, before the PR is opened:

- `npm install` completes clean in each touched workspace
- `npm run typecheck` clean
- `npm test` green — root baseline is **156 suites / 1416 tests** (measured on PR #600, 2026-08-12; supersedes the 150/1378 figure from PR #596, which predates the gifted-chat removal); `cloud-agent/` baseline is **288 tests (287 pass, 1 skipped)**; `functions/` baseline is **462 tests (462 pass)**
- `npx expo install --fix` reports no changes (root phases)
- `npm audit` re-run and the delta recorded in the PR body
- Phase 1 additionally: production deploy verified as a rollback gate (see Phase 1)
- Phase 3 additionally: iOS and Android native builds succeed locally; for the `expo-speech-recognition` removal, diff generated `Info.plist`/`AndroidManifest.xml` per that section

**What CI actually gates, as of 2026-08-12 (`.github/workflows/staging-test.yml`).** The workflow used to run `prettier --write` and `eslint --fix` before testing — both writers, which exit 0 on anything they can auto-fix and so cannot fail a PR — and it never typechecked any workspace, and never ran `functions/`'s tests at all (jest.config.js excludes it, and no step invoked it). It also ran on Node 22 while the baseline is Node 24. All four are fixed: `format:check` and `lint:check` (non-writing gates), a `typecheck` step in all three workspaces, an install/lint/typecheck/test sequence for `functions/` (it has its own non-writing `eslint .` script, previously unused in CI), and `node-version: 24`. `cloud-agent/` and `extension/` have no `lint` script of their own, so there is nothing further to add there. Treat this effort's own per-phase local verification above as _not redundant_ with CI even after that fix — CI is now a real gate, but production deploys (Phase 1) and native builds (Phase 3) still have no CI equivalent and stay manual.

The cloud-agent number was **measured on 2026-08-11**, not copied from a plan: the suite was run five times on this branch, and four runs returned 288/287/1 exactly. It supersedes the 281 figure, which predates the now-implemented CORS hardening.

⚠️ **One known flake, so it is not mistaken for a regression.** The fifth run failed `schedulerTriggerHandler.test.js:74` — _"returns 422 when no active device"_ — asserting `401 !== 422`, i.e. the request was rejected as unauthenticated before it could reach the no-active-device branch. It passed on the four other runs of the identical command. This is pre-existing and unrelated to any dependency bump. If it fires during this effort, re-run before investigating; if it starts failing consistently, that is a real signal and worth its own fix.

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

- Every phase was already verified independently on `staging`, so this is a batch of _verified_ changes, not a batch of unknowns.
- The backend majors — the phase most likely to cause a production incident — have already been in production since Phase 1, and their rollback path (Cloud Run revision traffic-shift) does not involve promotion at all.
- What actually lands _at_ promotion is the client bundle and the native build, and the pre-promotion gate for those is a real iOS and Android build off `staging`, not a green `npm test`.

The residual risk is a bad native build reaching the store. The mitigation is the same as for any release here: `staging` is buildable and verified before the promotion PR opens, and a bad binary is fixed by a follow-up release rather than a revert, because the store rollout cannot be un-shipped either way.

## Open Questions

1. **Internal packages: 5.x or 4.23.1?** The four `@equationalapplications/*` packages have a 5.x line at `5.2.1`. Aligning there is the better end state; aligning at `4.23.1` fixes the drift with no API migration. Resolve in Phase 0 by reading the 5.0.0 release notes — this is the single biggest scope variable in the effort.
2. **`core-llm-tools` pinning.** Keep the exact pin (`4.17.3`) or move to a caret range matching its three siblings? Resolve in Phase 0. Recommendation: caret, since the exact pin is what allowed the drift.
3. **Residual alert tolerance.** No target count is set for alerts remaining after Phase 4. Set one once Phase 3's `npm audit` delta is known, rather than guessing now.
4. **Where should the `expo-speech-recognition` removal actually land?** Phase 3 by default, since it changes the native manifests and rides the same OTA fence. But it is unrelated to every other Phase 3 change and could ship earlier as a standalone native PR if Phase 3 slips — the microphone-permission transplant is the whole risk, and it does not depend on any other phase.

**Resolved since the original draft:**

- ~~_Is `@google/genai` v2 compatible with the pinned `@google/adk`?_~~ **Yes, and it is mandatory.** `@google/adk@1.6.0` depends on `@google/genai@^2.9.0`. The two move as one step; the "split genai into its own PR" fallback does not exist. See Phase 1.
- ~~_TypeScript 7 across all three workspaces._~~ **Rejected.** `typescript-eslint` has no release accepting TS 7, and TS 7 is the native Go port rather than an incremental major. See [Why TypeScript 7 is excluded](#why-typescript-7-is-excluded).

## Revision log (2026-08-12)

Every version target in this document was re-verified against the npm registry and the three `package.json` files. Substantive changes:

| Change                         | Was                                                                                                                                          | Now                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript 7**               | Phase 1 + Phase 2, all three workspaces                                                                                                      | **Removed from the effort.** TS 6 added to the fixed platform baseline; TS 7 gets its own effort gated on typescript-eslint support                                           |
| **Phase 0 scope**              | "align four packages"; 5.2.1 dismissed as stale                                                                                              | 5.2.1 is current `latest` — Phase 0 is a **4.x → 5.x major**, with an explicit 5.x-vs-4.23.1 decision                                                                         |
| **Phase 0 workspaces**         | `core-llm-wiki` in all three                                                                                                                 | `core-llm-wiki` is root + cloud-agent only; `functions/` does not depend on it                                                                                                |
| **ADK / genai**                | two ordered rows, genai splittable                                                                                                           | **one step** — ADK 1.6 requires genai ^2.9.0                                                                                                                                  |
| **ADK side effects**           | sqlite3 chain "resolves as a side effect"                                                                                                    | Chain persists — mikro-orm drivers are non-optional auto-installed peers in both 1.2.0 and 1.6.0. Moved to Phase 4                                                            |
| **Express 5**                  | cloud-agent only                                                                                                                             | Unchanged, plus: ADK carries its own express 4, so no tree-wide override                                                                                                      |
| **`@babel/core`**              | devDependency bump only                                                                                                                      | Root `overrides` already pins `^7.29.7` — both must move or the bump is a no-op                                                                                               |
| **`expo-speech-recognition`**  | not mentioned                                                                                                                                | **Removal**, not an upgrade — dead JS since `c695ab0e`, but its config plugin is the sole source of `NSMicrophoneUsageDescription`, and Speechmatics `fatalError`s without it |
| **Root test baseline**         | 150 suites / 1378 tests                                                                                                                      | 156 suites / 1416 tests                                                                                                                                                       |
| **`functions/` test baseline** | not recorded (never run in CI)                                                                                                               | 462 tests, 462 pass — and now runs in CI, see below                                                                                                                           |
| **CI (`staging-test.yml`)**    | `prettier --write` + `eslint --fix` before tests (writers, cannot fail); no typecheck anywhere; `functions/` never tested or linted; Node 22 | `format:check` + `lint:check` (gates); typecheck in all three workspaces; `functions/` install+lint+typecheck+test added; Node 24; `patch-package --error-on-fail`            |
| **`@types/node`**              | `~24.x`, "not 26.x"                                                                                                                          | `~24.x` (head `24.13.3`), excluding both 25.x and 26.x                                                                                                                        |

**Second pass (2026-08-12, later the same day).** An earlier docs-only revision of this spec existed on an orphaned local branch (`chore/dependency-security-and-major-upgrades`, commit `bc9e6ecc`) that was never pushed or opened as a PR. It predated the TypeScript 7 / Phase 0 / ADK-genai / expo-speech-recognition / CI corrections above, but it verified real content the first pass above had missed. That content is folded in here, with line numbers and test counts re-verified since the branch was cut:

| Change                              | Was                                                                                                               | Now                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`functions/` overrides**          | Only root's two overrides audited                                                                                 | `functions/` has four more: a scoped `@google/adk: { js-yaml: 4.3.0 }` plus top-level `ws`, `uuid`, `protobufjs`. All six now listed in Phase 4                                                                                                                                                         |
| **Express 5 / CORS shared surface** | General warning (`req.socket.encrypted`, `req.headers.origin`, `server.on('upgrade')`)                            | Same three points kept, plus `cors@2.8.6`'s express-4-era `origin: false` semantic and `express-rate-limit` support, both needing verification. Line refs corrected to the current file (`selfOrigin` at `index.ts:204`, `attachWebSocketRoutes` at `index.ts:605` — both had drifted since `bc9e6ecc`) |
| **CORS/WS regression test count**   | "six WebSocket... four CORS HTTP" (this doc's first pass) / "six-case... two chrome-extension cases" (`bc9e6ecc`) | Recounted directly from `cloud-agent/src/index.test.ts`: **7 WebSocket tests, 5 HTTP tests** — neither prior figure was accurate                                                                                                                                                                        |
| **Phase 1 deploy gate**             | Generic "deploy then verify"                                                                                      | `deploy.sh:32`'s actual `CORS_ORIGIN` default quoted; web client verification (`clanker-ai.com`) added explicitly; Cloud Run vs. Firebase Functions rollback asymmetry stated as its own gate item                                                                                                      |

Not carried forward from `bc9e6ecc`: its Non-Goals link to `2026-08-11-gifted-chat-fork-migration-design.md` — that file was never created; the fork approach was rejected and the shipped spec is `2026-08-11-gifted-chat-removal-design.md`, which this document already links correctly.
