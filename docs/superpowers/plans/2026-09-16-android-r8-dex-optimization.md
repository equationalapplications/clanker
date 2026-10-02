# Android R8 DEX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on R8 minification/obfuscation and resource shrinking for Android release builds so the Play Console Obfuscation score reaches ≥ 25%, with no runtime regressions.

**Architecture:** The only source change is the `android` block of the existing `expo-build-properties` entry in `app.config.ts`. A Jest regression test pins the flags. Everything else is verification of generated artifacts and real builds: prebuild output, a local release APK, a Play internal-track install, and a Crashlytics deobfuscation check. Keep rules, if needed, go through `android.extraProguardRules`.

**Tech Stack:** Expo SDK 57 (CNG, `android/` gitignored), `expo-build-properties ~57.0.20`, R8/AGP, EAS Build/Submit, RNFB Crashlytics gradle plugin, Jest (root).

**Spec:** `docs/superpowers/specs/2026-09-16-android-r8-dex-optimization-design.md`

## Global Constraints

- Option names: `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`. Do not use the deprecated `enableProguardInReleaseBuilds`.
- Keep rules go only in `android.extraProguardRules`, one comment per rule naming the failure (class, exception, step that caught it). Never edit `android/app/proguard-rules.pro` by hand. Never use package-wide `-keep` unless a failure proves the whole package is loaded by reflection.
- `-dontwarn` only after confirming the warning is harmless.
- The existing `ios` block is unchanged. Debug and dev-client builds are unaffected.
- No new dependencies. `npx expo install --check` must still pass.
- Commit type `fix(android):`, with **no** `BREAKING CHANGE:` footer (`runtimeVersion` must not change). Never edit `package.json` version or `CHANGELOG.md`.
- PRs target `staging`, never `main`. The user merges.
- `eas build`, `eas submit`, and Play Console promotion are outward-facing. **STOP and ask the user** before each.
- Root Jest: run a single file with `npx jest <path>` (`npm test -- <path>` does not filter).
- Commitlint rejects sentence-case subjects. Keep the subject lowercase after the scope.

---

## File Structure

| File                                                                      | Change                                        | Responsibility                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `app.config.ts`                                                           | Modify (`expo-build-properties` entry, ~L209) | Adds the `android` block with both flags (and later `extraProguardRules` if a failure requires it) |
| `__tests__/appConfigAndroidR8.test.ts`                                    | Create                                        | Regression guard: release flags stay on, no deprecated option, iOS block intact                    |
| `docs/superpowers/specs/2026-09-16-android-r8-dex-optimization-design.md` | Modify (final task)                           | Status and the recorded Obfuscation score                                                          |

Conditional (only if Task 2's sentinel probe fails):

| File                             | Change | Responsibility                                          |
| -------------------------------- | ------ | ------------------------------------------------------- |
| `plugins/withProguardRules.ts`   | Create | Appends root `proguard-rules.pro` to the generated file |
| `proguard-rules.pro` (repo root) | Create | Source of custom keep rules                             |

---

### Task 1: Enable R8 flags with a regression test

**Files:**

- Create: `__tests__/appConfigAndroidR8.test.ts`
- Modify: `app.config.ts` (the `'expo-build-properties'` plugin entry, currently ~lines 209–223)

**Interfaces:**

- Consumes: `app.config.ts` default export `({ config }: ConfigContext) => ExpoConfig`.
- Produces: `ExpoConfig.plugins` entry `['expo-build-properties', { android: { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true }, ios: {...} }]`, which later tasks verify in the generated output.

- [ ] **Step 1: Write the failing test**

Create `__tests__/appConfigAndroidR8.test.ts`:

```ts
/**
 * @jest-environment node
 */
import type { ConfigContext, ExpoConfig } from 'expo/config'

import appConfig from '../app.config'

type BuildPropertiesProps = {
  android?: Record<string, unknown>
  ios?: Record<string, unknown>
}

const getBuildProperties = (): BuildPropertiesProps => {
  const resolved: ExpoConfig = appConfig({ config: {} } as ConfigContext)
  const entry = (resolved.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  )
  if (!Array.isArray(entry)) {
    throw new Error('expo-build-properties plugin entry with options not found')
  }
  return entry[1] as BuildPropertiesProps
}

describe('app.config expo-build-properties (Android R8)', () => {
  it('enables R8 minification and resource shrinking for release builds', () => {
    const { android } = getBuildProperties()
    expect(android?.enableMinifyInReleaseBuilds).toBe(true)
    expect(android?.enableShrinkResourcesInReleaseBuilds).toBe(true)
  })

  it('does not use the deprecated enableProguardInReleaseBuilds option', () => {
    const { android } = getBuildProperties()
    expect(android).not.toHaveProperty('enableProguardInReleaseBuilds')
  })

  it('keeps the iOS static-linkage settings unchanged', () => {
    const { ios } = getBuildProperties()
    expect(ios?.useFrameworks).toBe('static')
    expect(ios?.forceStaticLinking).toEqual([
      'RNFBApp',
      'RNFBAuth',
      'RNFBCrashlytics',
      'RNFBFunctions',
      'RNFBAppCheck',
      'RNFBAnalytics',
    ])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx jest __tests__/appConfigAndroidR8.test.ts`
Expected: the first test FAILS (`expected true, received undefined`), and the other two PASS.
If the file fails to _load_ instead (for example an import of `package.json` or `dotenv` breaks under the jest-expo preset), fix the loading problem in the test file only, such as a `jest.mock('dotenv', ...)`. Do not change `app.config.ts` to suit the test. Re-run until only the first test fails.

- [ ] **Step 3: Add the android block**

In `app.config.ts`, change the entry to:

```ts
    [
      'expo-build-properties',
      {
        android: {
          // R8 minify/obfuscate + resource shrinking for release builds only.
          // Play Console DEX optimization threshold (Obfuscation ≥ 25%); see
          // docs/superpowers/specs/2026-09-16-android-r8-dex-optimization-design.md.
          // Keep rules, if ever needed, go in `extraProguardRules` — android/ is regenerated.
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: [
            'RNFBApp',
            'RNFBAuth',
            'RNFBCrashlytics',
            'RNFBFunctions',
            'RNFBAppCheck',
            'RNFBAnalytics',
          ],
        },
      },
    ],
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest __tests__/appConfigAndroidR8.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Run the static gates**

Run: `npm run typecheck && npx prettier --check app.config.ts __tests__/appConfigAndroidR8.test.ts && npx eslint app.config.ts __tests__/appConfigAndroidR8.test.ts && npx expo install --check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add app.config.ts __tests__/appConfigAndroidR8.test.ts
git commit -m "fix(android): enable R8 minification and resource shrinking in release builds

Play Console flagged DEX code optimization below threshold
(Obfuscation 2%, release 118).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Verify generated artifacts and prove `extraProguardRules` works

This task only verifies. The sentinel is **never committed**.

**Files:**

- Temporarily modify (reverted in Step 6): `app.config.ts`
- Conditional create (only if Step 5 fails): `plugins/withProguardRules.ts`, `proguard-rules.pro`

**Interfaces:**

- Consumes: Task 1's config.
- Produces: a confirmed mechanism for keep rules, used by Tasks 3–4: either `android.extraProguardRules` (expected) or the fallback plugin.

- [ ] **Step 1: Back up the local generated android dir**

`android/` is gitignored but may hold local-only state. `prebuild --clean` deletes it.

```bash
SCRATCH=/private/tmp/claude-r8-backup   # or your session scratchpad
mkdir -p "$SCRATCH" && cp -R android "$SCRATCH/android.before"
```

- [ ] **Step 2: Add a temporary sentinel rule**

In the `android` block from Task 1, add:

```ts
          extraProguardRules: '# R8-SENTINEL-2026-09-16 (temporary; remove before commit)',
```

- [ ] **Step 3: Regenerate the native project**

Run: `npx expo prebuild -p android --clean --no-install`
Expected: exits 0.

- [ ] **Step 4: Check the flags**

Run: `grep -E '^android\.(enableMinifyInReleaseBuilds|enableShrinkResourcesInReleaseBuilds)=' android/gradle.properties`
Expected, exactly:

```
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResourcesInReleaseBuilds=true
```

- [ ] **Step 5: Check the sentinel and the diffs**

```bash
grep -n 'R8-SENTINEL-2026-09-16' android/app/proguard-rules.pro
diff "$SCRATCH/android.before/app/proguard-rules.pro" android/app/proguard-rules.pro
diff "$SCRATCH/android.before/app/src/main/AndroidManifest.xml" android/app/src/main/AndroidManifest.xml
```

Expected:

- The sentinel line is found.
- The proguard diff shows only the appended sentinel block, inside the plugin's generated `@generated begin expo-build-properties` markers.
- The manifest diff is empty.

If the manifest differs, check whether `android.before` was stale (built from an older config) before blaming this change. Rerun prebuild on `staging` without Task 1 to get a true baseline.

**If the sentinel is NOT found → fallback.** Stop and tell the user first. Then create `plugins/withProguardRules.ts`:

```ts
import { ConfigPlugin, withDangerousMod } from 'expo/config-plugins'
import fs from 'fs'
import path from 'path'

const BEGIN = '# @generated begin clanker-proguard-rules'
const END = '# @generated end clanker-proguard-rules'

/** Appends <projectRoot>/proguard-rules.pro to android/app/proguard-rules.pro on prebuild. */
const withProguardRules: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot
      const source = path.join(root, 'proguard-rules.pro')
      if (!fs.existsSync(source)) return cfg
      const target = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro')
      const existing = fs.readFileSync(target, 'utf8')
      const stripped = existing.replace(new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`), '')
      const block = `\n${BEGIN}\n${fs.readFileSync(source, 'utf8').trim()}\n${END}\n`
      fs.writeFileSync(target, stripped + block)
      return cfg
    },
  ])

export default withProguardRules
```

Register it in `app.config.ts` `plugins` as `'./plugins/withProguardRules'`, following how `withIosAllowNonModularHeaders` is registered. Move the sentinel into a root `proguard-rules.pro`, then repeat Steps 3–5. From then on, "add a keep rule" in later tasks means editing root `proguard-rules.pro`.

- [ ] **Step 6: Remove the sentinel and regenerate**

Delete the `extraProguardRules` line (or the sentinel line in root `proguard-rules.pro` under the fallback, keeping the file). Run `npx expo prebuild -p android --clean --no-install`. Confirm `grep -c R8-SENTINEL android/app/proguard-rules.pro` prints `0`, and that `git diff app.config.ts` shows nothing beyond Task 1's committed state.

- [ ] **Step 7: Commit (fallback only)**

Only if the fallback was needed:

```bash
git add plugins/withProguardRules.ts app.config.ts
git commit -m "fix(android): add config plugin to append custom proguard rules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

On the expected path there is nothing to commit. Record "extraProguardRules verified" in the task report.

---

### Task 3: Local release build gate (spec §3.1)

**Files:**

- Conditional modify: `app.config.ts` (`android.extraProguardRules`) only if a failure requires a keep rule

**Interfaces:**

- Consumes: the Task 2 mechanism for keep rules.
- Produces: a release build that runs cleanly on the emulator or a device, which Task 4 requires before an EAS build.

- [ ] **Step 1: Build and install the release variant**

Make sure mock auth is off for this run (`EXPO_PUBLIC_USE_MOCK_AUTH` unset or `false`), because mock auth skips signup and sync paths.
Start the emulator rig (or connect a device), then run:

```bash
adb logcat -c
npx expo run:android --variant release 2>&1 | tee "$SCRATCH/release-build.log"
```

Expected: build succeeds and `:app:minifyReleaseWithR8` appears in the log (`grep -c minifyReleaseWithR8 "$SCRATCH/release-build.log"` ≥ 1).

If R8 fails with `Missing class ...`, read the class. If it belongs to an optional dependency that is never loaded, add a targeted `-dontwarn <exact.class.Name>` with a comment. Otherwise add a narrow `-keep`. Then rebuild.

- [ ] **Step 2: Exercise the app**

On the device:

- Sign in with a real account (Google Sign-In may fail on a locally signed APK because the SHA-1 is not registered; that is expected and covered in Task 4).
- Open every tab.
- Open a chat and send a message.
- Open the image viewer.
- Open a WebView screen.
- Start a voice session.

- [ ] **Step 3: Scan logcat for R8-type failures**

Stream logcat to a file. Do not pipe a long-running command through `tail`.

```bash
adb logcat -d > "$SCRATCH/logcat-release.txt"
grep -nE 'ClassNotFoundException|NoSuchMethodError|NoSuchFieldError|Resources\$NotFoundException|AbstractMethodError|ExceptionInInitializerError' "$SCRATCH/logcat-release.txt"
```

Expected: no matches from app or library packages.

For each match:

- Identify the class and member.
- Add the narrowest rule to `extraProguardRules`, with a comment in the form `# <Exception> <class> — caught by R8 plan Task 3 (local release)`.
- Rerun from Step 1.

- [ ] **Step 4: Commit keep rules (only if any were added)**

```bash
git add app.config.ts
git commit -m "fix(android): add R8 keep rules for <library>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Also add one assertion to `__tests__/appConfigAndroidR8.test.ts` so the rules can't be dropped silently:

```ts
it('keeps the R8 keep rules required by runtime validation', () => {
  const { android } = getBuildProperties()
  expect(android?.extraProguardRules).toContain('<exact rule text added>')
})
```

Run `npx jest __tests__/appConfigAndroidR8.test.ts` (expect all passing) and include the test file in the same commit.

---

### Task 4: PR, internal-track build, smoke test, deobfuscation (spec §3.2–3.4)

**Files:** none, unless a failure requires a keep rule (same loop as Task 3 Step 3 → commit → rebuild).

**Interfaces:**

- Consumes: branch with Tasks 1–3 committed.
- Produces: a validated internal-track build and an open PR to `staging` whose body has the evidence.

- [ ] **Step 1: Run the full root gates**

Run: `npm run typecheck && npx jest > "$SCRATCH/jest-full.log" 2>&1; echo exit=$?`, then check the summary line in the log.
Expected: exit 0, suite count = previous baseline + 1.

- [ ] **Step 2: STOP — ask the user before building**

Ask: "Ready to run `eas build -p android --profile staging` and then `eas submit -p android --profile staging` (internal track)?" Wait for an explicit yes.

- [ ] **Step 3: Build and submit**

```bash
eas build -p android --profile staging --non-interactive
eas submit -p android --profile staging --latest
```

Expected: the build succeeds, and its Gradle log contains `minifyReleaseWithR8` and a Crashlytics mapping upload task (`uploadCrashlyticsMappingFileRelease`). If the upload task is missing or fails, note it; Step 6 decides whether it matters.

- [ ] **Step 4: Install through the internal-tester Play link**

The user installs from the Play internal-testing opt-in link, which gives a Play-signed binary. If an earlier version is installed from outside Play, uninstall it first so the Play install doesn't fail on a signature mismatch.

- [ ] **Step 5: Smoke test (the user performs it; record pass/fail per row)**

| Area          | Check                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Auth          | Google Sign-In; Firebase Auth token exchange; App Check token                  |
| Billing       | RevenueCat offerings load; purchase or restore completes; entitlement reflects |
| Voice         | Speechmatics two-way audio session starts and returns audio                    |
| Images        | Image picker, share, save to library                                           |
| Notifications | Push received, small icon renders correctly (not a blank/white square)         |
| Backend       | Firebase Functions call, Storage upload, SQLite read/write, llm-wiki path      |
| UI            | WebView screen, keyboard-controller chat composer, reanimated animations       |
| Updates       | App fetches and applies an OTA on the `staging` channel                        |

Any failure: collect `adb logcat` (Task 3 Step 3 grep), add a narrow rule, commit, and go back to Task 3 Step 1.

- [ ] **Step 6: Deobfuscation check**

- Trigger a native test crash. If the app has no hidden trigger, send it from a dev-only path or use `adb shell am crash com.equationalapplications.clanker`. Note that `am crash` gives a system-generated trace; prefer a real Crashlytics test crash if one exists.
- Relaunch the app so the report uploads.
- User confirms in the Firebase console that the frames show real class and method names, not `a.b.c`.
- User confirms that Play Console → App bundle explorer → the version code shows a deobfuscation file. If it's missing, download `mapping.txt` from the EAS build artifacts, upload it by hand, and record a follow-up.

- [ ] **Step 7: Push and open the PR — STOP and ask first**

After the user says yes:

```bash
git push -u origin docs/android-r8-dex-optimization-spec
gh pr create --base staging --title "fix(android): enable R8 minification for Play DEX optimization" --body-file "$SCRATCH/pr-body.md"
```

`pr-body.md` must contain:

- the spec and plan paths;
- the Task 2 generated-artifact evidence (the grep output);
- the Task 3 logcat result;
- the EAS build URL;
- the Step 5 smoke table with pass/fail filled in — no placeholders;
- the Step 6 deobfuscation result;
- the spec §4 OTA guardrail: any later release adding a new JS→native call path repeats Step 5 for that path;
- a note that this change needs a store build and does not change `runtimeVersion`;
- the attribution line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Do not merge. The user merges.

---

### Task 5: Post-release confirmation and spec close-out (spec §3.5)

Runs after the user has merged the PR, promoted staging→main, and rolled out a production build. That happens outside this session.

**Files:**

- Modify: `docs/superpowers/specs/2026-09-16-android-r8-dex-optimization-design.md` (Status line and "Open questions")

- [ ] **Step 1: Read the Play Console score**

The user pastes the DEX optimization report for the promoted release. Required: Obfuscation ≥ 25%.
If it's below 25%:

- Do NOT add rules to game the score.
- Run a local release build with `-printusage` and `-printconfiguration` added temporarily through `extraProguardRules` (not committed).
- Find which consumer rules keep the most code.
- Stop and propose a follow-up spec.

- [ ] **Step 2: 7-day Crashlytics watch**

Seven days after rollout, the user confirms there is no new Crashlytics crash cluster whose top frame is `ClassNotFoundException`, `NoSuchMethodError`, `NoSuchFieldError`, `AbstractMethodError`, or `Resources$NotFoundException`.

- [ ] **Step 3: Update the spec**

- Set `**Status:** Implemented`.
- Replace the "Open questions" body with: `Obfuscation score on release <versionCode> (<version>): <N>% (read <date>). No R8-type crash clusters in the 7 days after rollout.`, filled in with the real values.
- Branch off `staging`, commit it (`docs(spec): mark android R8 DEX optimization implemented`), and open a PR to `staging`, asking the user before pushing.
