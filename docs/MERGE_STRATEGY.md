# Merge Strategy: Promoting Code Through Branches

This document explains how to promote changes from `staging` → `main` cleanly.

## Overview

```
feature-branch → staging → main
```

Each promotion step is a Pull Request on GitHub. **Always use "Squash and Merge"** to keep the history linear.

## How Conflicts Are Prevented

`semantic-release` runs on both `staging` and `main`, but they behave differently:

- **Staging:** Creates a GitHub pre-release tag only. Does **not** commit `CHANGELOG.md`, `package.json`, or `package-lock.json` back to the branch.
- **Main:** Full release — bumps version, generates CHANGELOG, and commits the files back.

Because staging never mutates files, the only source of version/CHANGELOG commits is `main`. This means promoting `staging → main` will never conflict on auto-generated files.

## Step-by-Step: Promoting staging → main

### Via GitHub UI (Recommended)

1. Go to **Pull Requests** → **New Pull Request**.
2. Set **base:** `main` and **compare:** `staging`.
3. Title the PR: `chore(release): promote staging to production`
4. Select **"Squash and merge"**.
5. CI on `main` runs semantic-release, bumps the version, and creates a GitHub release.

### Via GitHub CLI

```bash
gh pr create --base main --head staging \
  --title "chore(release): promote staging to production" \
  --body "Promote staging to production."

gh pr merge --squash --subject "chore(release): promote staging to production"
```

## Hotfixes

If a critical fix needs to go directly to production:

1. Branch from `main`: `git checkout -b hotfix/critical-bug main`
2. Fix and PR into `main` (squash merge).
3. Cherry-pick the fix back to `staging`: `git cherry-pick <sha>`

## Branch Protection Rules

| Branch    | Requires PR | Linear History | Signed Commits |
| --------- | ----------- | -------------- | -------------- |
| `main`    | ✅          | ✅             | ✅             |
| `staging` | ✅          | ✅             | ✅             |

## Quick Reference

| Action               | Method           | Commit Message Example                             |
| -------------------- | ---------------- | -------------------------------------------------- |
| Feature → staging    | Squash and Merge | `feat(profile): add user profile page`             |
| Bug fix → staging    | Squash and Merge | `fix(auth): resolve token refresh loop`            |
| staging → main       | Squash and Merge | `chore(release): promote staging to production`    |
| Hotfix → main        | Squash and Merge | `fix(auth): patch critical auth regression`        |

## Common Pitfalls

1. **Don't use "Create a merge commit"** for any PR targeting `staging` or `main`.
2. **Don't merge `main` back into `staging`.** Changes flow one direction: `staging` → `main`. Use cherry-pick for hotfixes.
3. **Always pull the latest before promoting.** Stale local branches lead to unexpected conflicts.

## Related Documentation

- [Git Workflow & Branching](GIT_WORKFLOW.md) — Feature branch workflow and commit guidelines.
- [Expo Updates & Runtime Versioning](EXPO_UPDATES.md) — How version bumps drive OTA vs native builds.
