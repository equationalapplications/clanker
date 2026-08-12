# Root Dependency Overrides

This document tracks every entry in the root `package.json` `overrides` block and
every transitive-vulnerability audit residue in the root workspace. Every
override that survives here carries a tracked rationale and a removal
condition. Untracked overrides become permanent by default.

> **Phase 4 of the dependency-security and major-upgrades effort.** See
> [`docs/superpowers/specs/2026-08-11-dependency-security-and-major-upgrades-design.md`](./superpowers/specs/2026-08-11-dependency-security-and-major-upgrades-design.md#phase-4--overrides-sweep)
> for the rules this document enforces.

## Current overrides

```jsonc
// package.json
"overrides": {}
```

The root workspace currently carries **no** overrides. Both pre-Phase-4
overrides (`@babel/core: ^7.29.7` and `postcss: 8.5.24`) were audited and
deleted in Phase 4 — see [Removed overrides](#removed-overrides-phase-4-audit) below.

## Removed overrides (Phase 4 audit)

| Override               | Removed because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@babel/core: ^7.29.7` | **Dead override.** Natural resolution is `7.29.7` (matches `devDependencies` entry on line 112). Removing the override does not change the resolved version. No advisory at this version. The override was masking intent rather than fixing anything. Removal condition: a new `@babel/core` advisory appears at `7.29.7` (then re-add), or Babel 8 lands (then Phase 2's deferred Babel 8 bump subsumes this row). Note: Phase 2 was originally scheduled to bump `@babel/core` to `^8.x`; that bump was deferred due to `babel-preset-expo@58.0.0-canary-20260806` blocking (see spec revision log). |
| `postcss: 8.5.24`      | **Removed-but-not-dead.** Natural resolution with the override is `8.5.24`; without the override, `8.5.26` resolves — both versions carry **no `npm audit` advisory**, and the audit count is identical (34 vulnerabilities) in both states. The override pinned against `expo@57 → @expo/metro-config@57.0.8`'s older postcss dependency, which has since caught up. This row records an actual version bump (8.5.24 → 8.5.26), not a no-op removal — labelled as such so a future re-audit does not assume the override was inert.                                                                    |

## Accepted-residue table (root, post-Phase-3)

The root workspace's `npm audit` reports **34 vulnerabilities** (14 moderate,
20 high) at the post-Phase-3 baseline. **All root alerts are build-time**
(`semantic-release`, `expo`, `metro`, `react-native`, semantic-release's `npm`
subtree, `expo-cli` / `@expo/*` tooling) per the spec's rule 6 ("Root alerts
are build-time"). Per the spec's rule 5 ("An override is a last resort"), no
overrides are added for build-time residue.

| Package                                                                                                                                                                       | Severity        | Reason                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/inline-modules`, `@expo/local-build-cache-provider`, `@expo/metro`, `@expo/metro-config`, `@expo/prebuild-config` | moderate / high | All on **build host only** — used by `expo export`, `expo prebuild`, `eas-cli`. Fixes require Expo SDK 58+, which is out of scope for this effort (Expo 57 is the fixed platform baseline). Resolved by the next Expo major bump, not by an override.                    |
| `@react-native/community-cli-plugin`, `@react-native/metro-config`, `@react-native/virtualized-lists`                                                                         | high            | Fixes require RN 0.87+; the SDK 57 baseline is on RN 0.86.2. Build-time tooling — does not affect the shipped app bundle. Resolved by the next RN/Expo major bump.                                                                                                       |
| `metro`, `metro-config`, `metro-transform-worker`                                                                                                                             | high            | Same — bundled with the RN 0.86.2 baseline. Build-time.                                                                                                                                                                                                                  |
| `react-native`, `react-native-purchases`, `react-native-reanimated`, `react-native-worklets`, `react-native-error-boundary`                                                   | high            | RN-side packages. `react-native-purchases` is at 10.x (current), `reanimated`/`worklets` are pinned exactly, `error-boundary` is at the latest. Audit suggests downgrades; these are rejected per the spec's fixed-platform-baseline rule.                               |
| `expo`, `expo-sharing`, `expo-splash-screen`, `@react-native/community-cli-plugin`                                                                                            | moderate / high | On SDK 57; fixes are in SDK 58+. Build-time + native manifest only (sharing/splash feed into prebuild).                                                                                                                                                                  |
| `semantic-release`, `@semantic-release/npm`, `npm` (transitive)                                                                                                               | moderate        | Build host. `npm` is transitive via `semantic-release → npm`. Audit suggests reverting to `npm@<11` or `semantic-release@24`; both are rejected per the platform baseline (`semantic-release@25`, `npm@11`).                                                             |
| `semantic-release-react-native`, `html-minifier`                                                                                                                              | high            | Build host. Audit suggests reverting to `<1.8.0`; that is a downgrade and rejected.                                                                                                                                                                                      |
| `tar` (in `npm`/`pacote`/`libnpmdiff`)                                                                                                                                        | moderate        | Build host only (`npm pack`/`npm publish`). The vulnerable range `<=7.5.20`; natural resolution `7.5.19`. Per rule 6, build-time risk is weighed against forcing a version Metro was not tested with — leaving it on the build host. **Not** added as an override.       |
| `uuid` (transitive via `npm`)                                                                                                                                                 | moderate        | Build host only. `<11.1.1` vulnerable; natural resolution `7.0.3` (a long-EOL major). Adding a root override here would force every transitive `uuid` in the build tooling to a single major. We accept this residue; CI is short-lived and not exposed to the internet. |
| `brace-expansion`, `image-size`, `ip-address`, `undici`, `xcode`                                                                                                              | moderate / high | Build-time tooling. Most transitively via `semantic-release → npm`. Audit suggestions downgrades; all rejected.                                                                                                                                                          |
| `npm` (`<11.0.0-pre.0` advisory)                                                                                                                                              | moderate        | Build host. Fix requires `npm >=11.0.0-pre.0`; current resolution is `11.19.0`, so this is the audit's stale-resolution flag, not a current vulnerability. No action.                                                                                                    |

## Removal conditions

Every accepted-residue item above lists the conditions under which it can be
resolved. None of them are achievable inside Phase 4 alone — each requires a
parent package to be bumped past the current SDK / platform baseline, which is
explicitly fixed by the spec.

When the next Expo SDK / RN major bump ships, re-run this audit and update the
table accordingly.

## How to update this document

1. Re-enumerate: `npm audit --json > /tmp/audit.json` and `jq '.vulnerabilities |
to_entries | map(.value.effects // []) | add | unique' /tmp/audit.json` to
   find transitive parents.
2. For each new transitive chain, decide: fix-by-parent-bump (preferred),
   scoped override (last resort), or accepted residue.
3. Update the relevant section above, naming the advisory ID and removal
   condition.
4. If an override is added, write its section in this file **before** the
   `package.json` edit is committed. `package.json` cannot carry comments; this
   file is the only record.
