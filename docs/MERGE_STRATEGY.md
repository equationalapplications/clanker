# Merge Strategy: Promoting Code Through Branches

This document explains how to promote changes from `staging` → `main` cleanly.

## Overview

```
feature-branch → staging → main
```

Each promotion step is a Pull Request on GitHub. **Always use "Create a merge commit"**.

Why: squash merges concatenate source commit messages into the squash body. If that body includes
`chore(release): ... [skip ci]`, GitHub Actions can skip production release workflows.

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
4. Select **"Create a merge commit"**.
5. CI on `main` runs semantic-release, bumps the version, and creates a GitHub release.

### Via GitHub CLI

```bash
gh pr create --base main --head staging \
  --title "chore(release): promote staging to production" \
  --body "Promote staging to production."

gh pr merge --merge --subject "chore(release): promote staging to production"
```

## Syncing main Back to staging

After a production release on `main`, open a PR from `main` → `staging` and merge with
**"Create a merge commit"**. This keeps `staging` up-to-date with release commits without risking
workflow skips caused by squash merge commit bodies.

## Hotfixes

If a critical fix needs to go directly to production:

1. Branch from `main`: `git checkout -b hotfix/critical-bug main`
2. Fix and PR into `main` (merge commit).
3. Cherry-pick the fix back to `staging`: `git cherry-pick <sha>`

## Branch Protection Rules

| Branch    | Requires PR | Linear History | Signed Commits |
| --------- | ----------- | -------------- | -------------- |
| `main`    | ✅          | ✅             | ✅             |
| `staging` | ✅          | ✅             | ✅             |

## Quick Reference

| Action               | Method           | Commit Message Example                             |
| -------------------- | ---------------- | -------------------------------------------------- |
| Feature → staging    | Merge Commit     | `feat(profile): add user profile page`             |
| Bug fix → staging    | Merge Commit     | `fix(auth): resolve token refresh loop`            |
| staging → main       | Merge Commit     | `chore(release): promote staging to production`    |
| Hotfix → main        | Merge Commit     | `fix(auth): patch critical auth regression`        |

## Common Pitfalls

1. **Don't use "Squash and merge"** for PRs targeting `staging` or `main`.
2. **Don't skip syncing `main` back into `staging`** after production releases.
3. **Always pull the latest before promoting.** Stale local branches lead to unexpected conflicts.

## Related Documentation

- [Git Workflow & Branching](GIT_WORKFLOW.md) — Feature branch workflow and commit guidelines.
- [Expo Updates & Runtime Versioning](EXPO_UPDATES.md) — How version bumps drive OTA vs native builds.
