# Merge Strategy: Promoting Code Through Branches

This document explains how to merge changes between the three main branches (`dev` → `staging` → `main`) without running into conflicts—especially the recurring `CHANGELOG.md` conflict.

## Overview

Our branch promotion flow is:

```
dev  →  staging  →  main
```

Each promotion step is a Pull Request on GitHub. The critical rule is: **always use "Squash and Merge"** when promoting between these branches. This keeps the history linear and avoids merge-commit conflicts that block future PRs.

## Why Merge Commits Cause Problems

When you use a regular "Create a merge commit" on GitHub, the resulting merge commit has **two parents**. This creates a non-linear history that conflicts with our branch protection rules:

- `staging` and `main` both enforce **linear history** (no merge commits).
- `semantic-release` auto-generates `CHANGELOG.md` and bumps `package.json` on each branch independently. A regular merge creates conflicting versions of these files.
- Once a merge commit exists, **every future PR** between those branches will show the same conflict.

## The Solution: Squash and Merge

"Squash and Merge" takes all the commits from the source branch and combines them into **one new commit** on the target branch. This commit has only one parent, so the history stays linear and conflicts are avoided.

## Step-by-Step: Promoting dev → staging

### Via GitHub UI (Recommended)

1. Go to the repository on GitHub.
2. Click **Pull Requests** → **New Pull Request**.
3. Set **base:** `staging` and **compare:** `dev`.
4. Click **Create Pull Request**.
5. Title the PR with a conventional commit message:
   ```
   chore(release): promote dev to staging
   ```
6. Once checks pass, click the **dropdown arrow** next to the merge button.
7. Select **"Squash and merge"**.
8. Edit the commit message if needed — keep it as a conventional commit.
9. Click **Confirm squash and merge**.

### Via GitHub CLI

```bash
# Create the PR
gh pr create --base staging --head dev \
  --title "chore(release): promote dev to staging" \
  --body "Promote latest dev changes to staging for pre-release testing."

# Merge with squash (after PR is approved)
gh pr merge --squash --subject "chore(release): promote dev to staging"
```

## Step-by-Step: Promoting staging → main

The process is identical, just change the branches:

1. Create a PR from `staging` → `main`.
2. Title: `chore(release): promote staging to production vX.Y.Z`
3. Use **"Squash and merge"**.

## Resolving an Existing CHANGELOG Conflict

If you already have a PR that shows "Can't automatically merge" due to a `CHANGELOG.md` conflict, here's how to fix it locally:

### Option A: Resolve Locally and Push (Admin Only)

```bash
# Make sure you're on the target branch (e.g., staging)
git checkout staging
git pull origin staging

# Merge dev using the "ours" strategy for conflicting files
# This keeps staging's version of CHANGELOG.md (semantic-release regenerates it)
git merge -X ours origin/dev -m "chore(release): merge dev into staging"

# If branch protection requires linear history, squash instead:
git merge --squash origin/dev
git commit -m "chore(release): promote dev to staging"

# Push
git push origin staging
```

### Option B: Rebase dev onto staging

```bash
# Create a temporary branch from dev
git checkout dev
git pull origin dev
git checkout -b temp/promote-to-staging

# Rebase onto staging (resolve conflicts if any)
git rebase origin/staging

# During rebase, if CHANGELOG.md conflicts:
#   Accept the staging version, then continue:
git checkout --theirs CHANGELOG.md
git add CHANGELOG.md
git rebase --continue

# Push and create PR from temp branch → staging
git push origin temp/promote-to-staging
# Create PR on GitHub, then squash and merge
```

### Option C: Reset CHANGELOG Before Merging

If the only conflict is `CHANGELOG.md`, you can reset it before creating the PR:

```bash
git checkout dev
git checkout origin/staging -- CHANGELOG.md
git commit -m "chore: sync changelog with staging"
git push origin dev
# Now create PR from dev → staging — no conflict
```

> **Note:** `semantic-release` regenerates CHANGELOG.md on every release, so the content of this file during a merge doesn't matter much. The important thing is getting the code changes through cleanly.

## Branch Protection Rules

Our branches have these protections that affect the merge strategy:

| Branch    | Requires PR | Linear History | Signed Commits |
| --------- | ----------- | -------------- | -------------- |
| `main`    | ✅          | ✅             | ✅             |
| `staging` | ✅          | ✅             | ✅             |
| `dev`     | ⚠️ Partial  | ❌             | ❌             |

**Linear history** = no merge commits allowed. This is why "Squash and merge" is required for `staging` and `main`.

## Quick Reference

| Action                      | Method               | Commit Message Example                                    |
| --------------------------- | -------------------- | --------------------------------------------------------- |
| Feature → dev               | Squash and Merge     | `feat(profile): add user profile page`                    |
| Bug fix → dev               | Squash and Merge     | `fix(auth): resolve token refresh loop`                   |
| dev → staging               | Squash and Merge     | `chore(release): promote dev to staging`                  |
| staging → main              | Squash and Merge     | `chore(release): promote staging to production vX.Y.Z`    |

## Common Pitfalls

1. **Don't use "Create a merge commit"** for any PR targeting `staging` or `main`. It will succeed if you have admin bypass, but it creates problems for future merges.

2. **Don't worry about CHANGELOG.md content during promotion merges.** `semantic-release` will regenerate it on the next release. Accept whichever version resolves the conflict.

3. **Don't merge `main` back into `dev` or `staging`.** Changes flow in one direction only: `dev` → `staging` → `main`. If you need a hotfix on main, cherry-pick it back to dev.

4. **Always pull the latest before promoting.** Stale local branches lead to unexpected conflicts.

## Related Documentation

- [Git Workflow & Branching](GIT_WORKFLOW.md) — Feature branch workflow, commit guidelines, and conventional commits.
- [Expo Updates & Runtime Versioning](EXPO_UPDATES.md) — How version bumps from commits drive OTA vs native builds.
