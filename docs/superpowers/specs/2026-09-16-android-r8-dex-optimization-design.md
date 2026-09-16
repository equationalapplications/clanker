# Android R8 DEX Optimization — Design

**Date:** 2026-09-16
**Status:** Draft
**Resolves:** Google Play Console warning "DEX code optimization is below our threshold" — Obfuscation 2% (release 118, `33.0.1`)
**Deadline:** February 2027 (Play Console compliance date)

## Problem

Play Console now scores the DEX code in each Android release and warns when any
category is under 25%. Doing nothing risks "visibility and publishing
capabilities" on Google Play. Release 118 (`33.0.1`) scores **Obfuscation 2%**.
The two other categories listed, Memory usage and Bad behavior, have no score.

The cause is that R8 never runs. `android/` is gitignored and EAS regenerates it
with `expo prebuild` on every build. The generated `android/app/build.gradle`
reads the setting like this:

```groovy
def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()
...
shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false').toBoolean()
minifyEnabled enableMinifyInReleaseBuilds
```

Neither property is ever set. The `expo-build-properties` entry in
`app.config.ts` has only an `ios` block, so release AABs ship all DEX code
unshrunk and unobfuscated.

`expo-build-properties` (`~57.0.20`) renamed `enableProguardInReleaseBuilds` to
`enableMinifyInReleaseBuilds`. The old name still works: `pluginConfig.js`
converts it. This spec uses the current name.

## Goals

1. Release AABs are built with R8 minification and obfuscation, plus resource
   shrinking.
2. The Play Console Obfuscation score for the first release with this change is
   **≥ 25%**.
3. No runtime regressions in native paths that R8 can break: reflection, the
   JNI/JS bridge, and resources looked up by name.
4. Crashlytics and Play Console stack traces from R8 builds are still readable.

## Non-goals

- Memory usage and Bad behavior categories (no score is shown for them).
- iOS. The existing `ios` block is unchanged.
- Hermes or JS bundle size work.
- Changes to debug or dev-client builds. Minify applies to the `release`
  build type only.

## Approach

Turn on R8 and resource shrinking through `expo-build-properties`. Add keep
rules only when a real failure shows up.

Rejected alternatives:

- **R8 only, without resource shrinking.** Resource shrinking adds almost no
  runtime risk once the smoke test below covers name-looked-up resources, and
  it saves APK size. Resource shrinking has no effect on the obfuscation
  score, so we can drop it on its own if it causes trouble (see Rollback).
- **Broad keep rules for every native module up front**, for example
  `-keep class com.revenuecat.** { *; }`. These defeat obfuscation for those
  packages and could keep the score under 25%, the threshold the warning
  enforces. Most of our native dependencies already ship consumer rules
  (RNFB, RevenueCat, Google Sign-In, expo modules, reanimated, worklets).

## Design

### 1. Config change (the only source change)

`app.config.ts`, in the existing `expo-build-properties` entry:

```ts
[
  'expo-build-properties',
  {
    android: {
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true,
    },
    ios: { /* unchanged */ },
  },
],
```

Keep rules, when a validation step proves one is needed, go in
`android.extraProguardRules`, which is appended to the generated
`android/app/proguard-rules.pro`. Each rule gets a comment naming the failure
that required it: the class and exception, and the step that caught it. Never
edit the local `android/app/proguard-rules.pro` directly. It is regenerated
and not tracked.

Rules must be as narrow as possible. `-keep` a named class or member, never a
whole package, unless the failure proves the whole package is loaded by
reflection.

### 2. Verify the generated artifacts

Tests and typecheck cannot see this change. Verify with a prebuild instead:

```sh
npx expo prebuild -p android --clean
grep -E 'enableMinifyInReleaseBuilds|enableShrinkResourcesInReleaseBuilds' android/gradle.properties
```

Pass criteria:

- Both properties are present and `true`.
- `android/app/proguard-rules.pro` differs from the previous generated
  version only by the intended `extraProguardRules`, if any.
- `AndroidManifest.xml` is unchanged (this change should not touch it).

`npx expo install --check` still passes. The change adds no dependencies,
because `expo-build-properties` is already installed.

### 3. Validation pipeline

Run the steps in order. A failure at any step goes back to §1: add a narrow
rule, then restart from step 3.1.

**3.1 Local release build (cheap first check).**
`npx expo run:android --variant release` on the emulator rig or a device.

- The build finishes, so R8 reports no missing-class errors. Warnings go
  through `-dontwarn` only after we confirm they are harmless.
- The app launches, completes sign-in with mock auth off, and visits every
  tab.
- `adb logcat` shows no `ClassNotFoundException`, `NoSuchMethodError`,
  `NoSuchFieldError`, or `Resources$NotFoundException`.

A local APK is not signed by Play App Signing, so Google Sign-In and billing
cannot be fully checked here. That is done in steps 3.2–3.3.

**3.2 Internal track build.**
EAS `staging` profile → `eas submit` to the Play **internal** track. Install
through the internal-tester Play link so the Play-signed binary is the one
being tested.

**3.3 Smoke test on the internal-track install.** Every item must pass:

| Area          | Check                                                                          | R8 risk being covered                                          |
| ------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Auth          | Google Sign-In; Firebase Auth token exchange; App Check token                  | RNFB / google-signin bridge, reflection                        |
| Billing       | RevenueCat offerings load; purchase or restore completes; entitlement reflects | RevenueCat model deserialization                               |
| Voice         | Speechmatics two-way audio session starts and returns audio                    | `@speechmatics/expo-two-way-audio` has no known consumer rules |
| Images        | Image picker, share, save to library                                           | expo-image / media-library / sharing                           |
| Notifications | Push received, **small icon renders correctly**                                | `shrinkResources` removing a drawable looked up by name        |
| Backend       | Firebase Functions call, Storage upload, SQLite read/write, llm-wiki path      | RNFB functions/storage, expo-sqlite                            |
| UI            | WebView screen, keyboard-controller chat composer, reanimated animations       | JSI / Fabric bridge classes                                    |
| Updates       | App fetches and applies an OTA on the `staging` channel                        | expo-updates                                                   |

**3.4 Deobfuscation check.**

- Trigger a test native crash in the internal build (Crashlytics test crash).
- In the Firebase console, the stack trace shows original class and method
  names, which proves the Crashlytics gradle plugin
  (`com.google.firebase.crashlytics`, already applied) uploaded the mapping
  file from the EAS build.
- Play Console → App bundle explorer shows a deobfuscation file for that
  version code. AGP bundles the mapping into the AAB. If none is shown,
  upload `mapping.txt` from the EAS build artifacts by hand and record the
  gap as a follow-up.

**3.5 Promote and confirm.**
Promote to production with the next release. The spec moves to
**Implemented** only after the Play Console report for that release shows
**Obfuscation ≥ 25%** and Crashlytics shows no new crash cluster with
R8-type exceptions for 7 days after rollout.

If the score is still below 25% with R8 on, the next step is to find which
dependency's consumer rules keep the most code: `-printconfiguration` and
`-printusage` from a local release build. Then write a follow-up spec. Do not
add blanket rules to game the score.

### 4. Release and OTA considerations

- **Store build required.** This is a native build change, so OTA updates
  cannot deliver it. It ships with the next staging→main promotion and a new
  EAS production build.
- **`runtimeVersion` is unchanged.** The JS↔native interface is unchanged, so
  the commit takes no `BREAKING CHANGE:` footer. Existing installs keep
  receiving OTA updates.
- **Risk to future OTA updates.** R8 removes native code that nothing
  references. A later OTA update whose JS calls a native method that was
  never used before could hit a stripped member at runtime, and no build step
  would catch it. Mitigation: any release that adds a new JS→native call path
  (a new native module method or a newly used SDK feature) repeats step 3.3
  for that path on an internal-track build before the OTA ships.
- **Version and CHANGELOG** are left to `semantic-release-bot`. Use a
  `fix(android):` or `build(android):` commit type, with no manual version
  bump.

### 5. Rollback

- Set `enableMinifyInReleaseBuilds` (and, if needed, only
  `enableShrinkResourcesInReleaseBuilds`) back to `false` and ship a new store
  build.
- The flags are independent, so a resource-only problem can be rolled back
  without losing obfuscation.
- The installed-base fix for an R8 crash is a store build, not an OTA update.
  Keep the step 3.3 gate strict for that reason.

## Testing summary

| Gate             | Evidence                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Generated config | `gradle.properties` grep after `expo prebuild --clean`                                          |
| Build            | Local release build + EAS `staging` build both succeed                                          |
| Runtime          | Step 3.1 logcat is clean; every row in the step 3.3 smoke table passes on a Play-signed install |
| Observability    | Step 3.4: readable Crashlytics trace + deobfuscation file present in Play Console               |
| Outcome          | Play Console Obfuscation ≥ 25% on the promoted release                                          |

The existing Jest suites are unaffected and are not evidence for this change.

## Open questions

None blocking. Record the actual Obfuscation score from step 3.5 in this spec
when it is available.
