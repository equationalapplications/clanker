# Expo Updates & Runtime Versioning

This document explains how Expo Updates (OTA - Over-The-Air updates) work in this project and their relationship to semantic versioning and conventional commits.

## Table of Contents

- [Overview](#overview)
- [Runtime Version Strategy](#runtime-version-strategy)
- [Conventional Commits Impact](#conventional-commits-impact)
- [Update Types](#update-types)
- [Deployment Workflows](#deployment-workflows)
- [When to Use Breaking Changes](#when-to-use-breaking-changes)
- [Testing Updates](#testing-updates)
- [Troubleshooting](#troubleshooting)

## Overview

**Expo Updates** allows you to push JavaScript bundle updates directly to users without requiring them to download a new version from the App Store or Google Play. This enables instant bug fixes and feature deployments.

### Key Concepts

- **Runtime Version** - Determines compatibility between updates and native builds
- **OTA Update** - Over-the-air JavaScript bundle update (instant)
- **Native Build** - Full app binary requiring app store submission
- **Update Channel** - Separate update streams (staging vs production)

### Our Configuration

```typescript
// app.config.ts
const breakingChangeVersion = pkg.version.split('.')[0]
const runtimeVer = breakingChangeVersion + '.0.0'

export default {
  runtimeVersion: runtimeVer,  // e.g., "1.0.0" from package version "1.2.3"
  updates: {
    url: 'https://u.expo.dev/2333eead-a87c-4a6f-adea-b1b433f4740e',
    fallbackToCacheTimeout: 5000,
  },
}
```

## Runtime Version Strategy

### How It Works

1. **package.json version** is managed by semantic-release based on conventional commits
2. **Runtime version** = major version only (e.g., `1.0.0`, `2.0.0`, `3.0.0`)
3. Apps **only download updates** matching their runtime version
4. **Breaking changes** increment major version → new runtime version → requires new build

### Example Flow

| package.json | Runtime Version | Update Type | User Impact |
|--------------|-----------------|-------------|-------------|
| `1.0.0` | `1.0.0` | Initial release | Install from store |
| `1.1.0` | `1.0.0` | Minor (feat) | OTA update |
| `1.1.5` | `1.0.0` | Patch (fix) | OTA update |
| `1.2.0` | `1.0.0` | Minor (feat) | OTA update |
| `2.0.0` | `2.0.0` | Major (breaking) | **New store build required** |
| `2.1.0` | `2.0.0` | Minor (feat) | OTA update |

### Why This Matters

**Compatible updates (same runtime version):**
```
Version 1.0.0 app can receive:
✅ 1.1.0 update (new feature)
✅ 1.2.0 update (another feature)
✅ 1.2.3 update (bug fix)
```

**Incompatible updates (different runtime version):**
```
Version 1.0.0 app CANNOT receive:
❌ 2.0.0 update (breaking change - requires new native modules)
❌ 2.1.0 update (even though it's compatible with 2.0.0)
```

## Conventional Commits Impact

### Non-Breaking Changes (OTA Updates)

These commits trigger **minor or patch** version bumps and deploy via OTA:

```bash
# Minor version bump (1.0.0 → 1.1.0)
feat(characters): add character export functionality

# Patch version bump (1.0.0 → 1.0.1)
fix(auth): resolve token refresh timing issue

# No version bump (documentation only)
docs(readme): update installation instructions
```

**Deployment:** Instant OTA update to all users on same runtime version.

### Breaking Changes (Native Builds Required)

These commits trigger **major** version bump and require new app store submission:

```bash
# Major version bump (1.0.0 → 2.0.0)
feat!: upgrade to new React Native architecture

# Or using footer
feat(storage): migrate to new SQLite version

BREAKING CHANGE: Requires database migration on app start
```

**Deployment:** 
1. CI builds new native binaries for iOS and Android
2. Submit to App Store and Google Play for review
3. Users must download new version from stores
4. Subsequent updates use new runtime version (2.0.0)

## Update Types

### What Requires a Breaking Change?

**Always requires native build (use breaking change):**
- ✅ Adding/removing native modules or dependencies
- ✅ Updating Expo SDK major version
- ✅ Changing native configuration (app.json, AndroidManifest.xml, Info.plist)
- ✅ Modifying permissions (camera, location, etc.)
- ✅ Updating React Native version
- ✅ Database schema changes requiring migration
- ✅ Changing bundle identifier or package name

**Can use OTA update (non-breaking):**
- ✅ JavaScript code changes
- ✅ React component updates
- ✅ Bug fixes in business logic
- ✅ UI/UX improvements
- ✅ New features using existing native capabilities
- ✅ API endpoint changes
- ✅ Configuration updates (colors, strings, assets)

### Examples

**✅ OTA Update (Non-Breaking):**
```bash
feat(chat): add message reactions with emoji picker
fix(profile): correct avatar upload validation
perf(messages): optimize message list rendering
refactor(navigation): simplify drawer structure
```

**⚠️ Native Build Required (Breaking):**
```bash
feat!: add native video recording support

BREAKING CHANGE: Adds expo-camera and expo-av dependencies requiring native build

---

feat!: upgrade to Expo SDK 55

BREAKING CHANGE: New Expo SDK requires updated native configuration

---

feat!: implement biometric authentication

BREAKING CHANGE: Adds native biometric module and new iOS Info.plist entries
```

## Deployment Workflows

### Staging Channel (dev → staging)

When PR merges to `staging` branch:

```yaml
# .github/workflows/eas-staging.yml
on:
  push:
    branches: [staging]

steps:
  - Semantic release analyzes commits
  - Version bumped in package.json
  - If breaking change:
      - Runtime version updates (e.g., 1.0.0 → 2.0.0)
      - EAS Build creates new native binaries
  - If non-breaking:
      - Runtime version stays same
      - EAS Update publishes OTA bundle
```

**Result:** Staging app users receive update based on their runtime version.

### Production Channel (staging → main)

When PR merges to `main` branch:

```yaml
# .github/workflows/eas-production.yml
on:
  push:
    branches: [main]

steps:
  - Semantic release creates GitHub release
  - If breaking change:
      - New production build
      - Submit to App Store and Google Play
  - If non-breaking:
      - OTA update to production channel
```

**Result:** Production users receive update (instantly if OTA, or via stores if native build).

## When to Use Breaking Changes

### Strategic Considerations

**Breaking changes force all users to update via app stores:**
- ⏱️ Apple review: 1-3 days
- ⏱️ Google review: hours to 1 day
- 📱 Users must manually update (or wait for auto-update)
- 🔄 Can't instantly roll back (must submit another build)

**OTA updates are instant:**
- ⚡ Published in seconds
- 📱 Auto-downloaded on next app launch
- 🔄 Can instantly roll back by publishing previous version
- ✅ No app store review needed

### Best Practices

1. **Batch native changes together**
   - Don't make breaking changes frequently
   - Group multiple native updates into one major release
   - Example: Upgrade Expo SDK + add native modules + update permissions in single release

2. **Use breaking changes deliberately**
   ```bash
   # Good: Intentional major release with multiple native changes
   feat!: v2.0.0 with video recording and biometrics
   
   BREAKING CHANGE: Major release includes:
   - Expo SDK 55 upgrade
   - Native video recording (expo-camera)
   - Biometric authentication (expo-local-auth)
   - New iOS permissions in Info.plist
   ```

3. **Avoid accidental breaking changes**
   - Don't use `!` or `BREAKING CHANGE:` unless you intend to force native builds
   - Review commits carefully before merging
   - Consider impact on users (forced store update)

4. **Plan breaking changes around releases**
   - Schedule native builds for specific release cycles
   - Communicate to users in advance (App Store release notes)
   - Prepare for app store review delays

5. **Prefer OTA for quick fixes**
   ```bash
   # Fix critical bug instantly via OTA
   fix(auth): resolve crash on token expiration
   
   # Not:
   fix!: resolve crash on token expiration
   BREAKING CHANGE: ...  # Don't do this for bug fixes!
   ```

## Testing Updates

### Local Testing

**Test OTA updates locally:**
```bash
# Build preview with updates enabled
eas build --platform ios --profile preview

# Publish update to branch
eas update --branch preview --message "Test new feature"

# Install preview build on device
# Update will download on next launch
```

### Staging Testing

1. Merge PR to `staging` branch
2. CI publishes update to staging channel
3. Staging app users receive update
4. Test thoroughly before promoting to production

### Production Release

1. Merge `staging` → `main`
2. CI publishes to production channel
3. Monitor for issues in production
4. Roll back if needed:
   ```bash
   # Republish previous working version
   eas update --branch production --message "Rollback to v1.2.0"
   ```

## Troubleshooting

### "Update available but not installing"

**Problem:** App shows update available but doesn't apply it.

**Causes:**
- Runtime version mismatch (app is v1.0.0, update is for v2.0.0)
- Network connectivity issues
- Update already cached

**Solution:**
```bash
# Check runtime version in app
# Settings → About → Runtime Version

# Verify update was published for correct runtime version
eas update:list --branch production

# Force app to re-check for updates
# Close and reopen app
```

### "Build required after non-breaking commit"

**Problem:** CI triggered native build when you expected OTA update.

**Cause:** Commit was accidentally marked as breaking.

**Solution:**
```bash
# Check recent commits for breaking change markers
git log --oneline -10

# Look for:
# - feat! or fix!
# - BREAKING CHANGE: in commit body

# If accidental, revert and recommit:
git revert HEAD
git commit -m "feat(feature): add feature without breaking change"
```

### "Users on old version not receiving updates"

**Problem:** Some users stuck on old version.

**Possible causes:**
1. **Different runtime version** - They need new native build
2. **Disabled auto-updates** - User disabled background updates in OS settings
3. **No network** - App needs connectivity to check for updates

**Solution:**
```bash
# Check what runtime versions are active
eas build:list --platform ios --status finished

# Verify multiple runtime versions are deployed
# Users on old runtime need native build update
```

### "Rollback not working"

**Problem:** Published rollback update but issues persist.

**Cause:** Client may have cached problematic update.

**Solution:**
```bash
# Publish new update with incremented version
eas update --branch production --message "Fix for issue X"

# Ask users to:
# 1. Force quit app
# 2. Clear app cache (reinstall if needed)
# 3. Reopen app
```

### "CI not publishing updates"

**Problem:** Workflow completes but no update available.

**Check:**
1. Verify workflow ran successfully in GitHub Actions
2. Check semantic-release output for version bump
3. Verify branch name matches workflow trigger
4. Check EAS credentials are configured

**Debug:**
```bash
# View recent updates
eas update:list --branch staging

# Check build/update status
eas build:list --platform all

# View workflow logs in GitHub Actions tab
```

## Update Channels

We use separate channels for different environments:

| Channel | Branch | Purpose | Auto-update |
|---------|--------|---------|-------------|
| `production` | `main` | Production users | Yes |
| `staging` | `staging` | Pre-release testing | Yes |
| `development` | `dev` | Local development | Manual |

### Switching Channels

Users can only receive updates from the channel their build was configured for. To test staging updates, you must install a staging build.

```bash
# Build for staging channel
eas build --platform ios --profile staging

# Build for production channel
eas build --platform ios --profile production
```

## Best Practices Summary

1. ✅ **Use OTA for most changes** - Instant deployment, easy rollback
2. ✅ **Reserve breaking changes for native updates** - Group them together
3. ✅ **Test in staging before production** - Catch issues early
4. ✅ **Monitor update adoption** - Check EAS dashboard for rollout progress
5. ✅ **Keep runtime versions consistent** - Don't increment major version unnecessarily
6. ✅ **Document breaking changes clearly** - Explain why native build is needed
7. ✅ **Plan breaking changes strategically** - Consider app store review times
8. ❌ **Don't use breaking changes for bug fixes** - Unless absolutely necessary
9. ❌ **Don't change runtime version manually** - Let semantic-release handle it
10. ❌ **Don't force users to update too frequently** - Batch native changes

## Related Documentation

- **[Git Workflow & Branching](./GIT_WORKFLOW.md)** - Conventional commits and semantic versioning
- **[EAS Build Configuration](./EAS_BUILD.md)** - Build profiles and configuration (if exists)
- [Expo Updates Documentation](https://docs.expo.dev/versions/latest/sdk/updates/) - Official Expo docs
- [Semantic Release](https://semantic-release.gitbook.io/) - Automated versioning

---

**Questions?** Open a [Discussion](https://github.com/equationalapplications/clanker/discussions) or contact the team.
