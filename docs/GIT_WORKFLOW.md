# Git Workflow & Branch Strategy

This document outlines the Git workflow, branching strategy, and best practices for contributing to Clanker.

## Table of Contents

- [Branch Strategy](#branch-strategy)
- [Development Workflow](#development-workflow)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Branch Protection Rules](#branch-protection-rules)
- [CI/CD Integration](#cicd-integration)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

## Branch Strategy

We use a three-tier branching model:

```
dev (feature development)
  ↓ PR (squash merge)
staging (pre-release testing)
  ↓ PR (squash merge)
main (production)
  ↓ fast-forward
dev (sync back)
```

### Branch Purposes

| Branch | Purpose | Protected | Deployment |
|--------|---------|-----------|------------|
| `main` | Production-ready code | ✅ Yes | Production (EAS) |
| `staging` | Pre-release testing | ✅ Yes | Staging (EAS) |
| `dev` | Active development | ⚠️ Partial | Dev client only |

### Branch Naming

For feature branches (short-lived):
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation only
- `refactor/description` - Code refactoring
- `chore/description` - Maintenance tasks

**Examples:**
```bash
feature/character-sharing
fix/auth-token-refresh
docs/update-firebase-setup
refactor/simplify-navigation
chore/update-dependencies
```

## Development Workflow

### 1. Starting New Work

Always start from the latest `main`:

```bash
# Ensure you're on main and up-to-date
git checkout main
git pull origin main

# Create your feature branch
git checkout -b feature/your-feature-name
```

### 2. Making Changes

```bash
# Make your changes
# ...

# Stage changes
git add .

# Commit with conventional commit message
git commit -m "feat(scope): description"

# Push to your fork/branch
git push origin feature/your-feature-name
```

### 3. Keeping Your Branch Updated

```bash
# Fetch latest changes
git fetch origin main

# Rebase your branch (preferred over merge)
git rebase origin/main

# If conflicts occur, resolve them, then:
git add .
git rebase --continue

# Force-push your updated branch
git push --force-with-lease origin feature/your-feature-name
```

### 4. Opening a Pull Request

1. Push your branch to GitHub
2. Open PR targeting the appropriate branch:
   - Feature → `dev`
   - Hotfix → `staging` or `main` (emergency only)
3. Fill out the PR template completely
4. Link related issues
5. Request review from maintainers

### 5. After PR Approval

**Maintainer will merge using:**
- **Squash merge** (preferred) - Creates single commit
- **Rebase merge** - Preserves linear history
- ⚠️ **Never merge commit** - Violates branch protection

## Commit Guidelines

### Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning and changelog generation.

**Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Commit Types

| Type | Description | Version Bump |
|------|-------------|--------------|
| `feat` | New feature | Minor (0.x.0) |
| `fix` | Bug fix | Patch (0.0.x) |
| `docs` | Documentation only | None |
| `style` | Code style (formatting) | None |
| `refactor` | Code refactoring | None |
| `perf` | Performance improvement | Patch |
| `test` | Adding/updating tests | None |
| `chore` | Maintenance tasks | None |
| `ci` | CI/CD changes | None |
| `build` | Build system changes | None |

### Breaking Changes

For breaking changes, add `!` after type or add `BREAKING CHANGE:` in footer:

```bash
feat!: redesign character API

BREAKING CHANGE: Character creation now requires `personality` field
```

This triggers a **major version bump** (x.0.0).

**⚠️ CRITICAL - Breaking Changes & Expo Updates:**

Breaking changes increment the major version, which updates the `runtimeVersion` in `app.config.ts` (e.g., 1.0.0 → 2.0.0). This **forces a new native build** and requires users to download from app stores instead of receiving an instant OTA update.

**Only use breaking changes when:**
- Adding/removing native modules
- Updating Expo SDK or React Native
- Changing native configuration or permissions
- Database schema changes requiring migration

**For detailed information on runtime versioning and update strategy, see [Expo Updates & Runtime Versioning](./EXPO_UPDATES.md).**

### Commit Examples

```bash
# New feature
git commit -m "feat(characters): add character sharing with permissions"

# Bug fix
git commit -m "fix(auth): resolve token refresh race condition"

# Documentation
git commit -m "docs(setup): add Firebase configuration guide"

# Multiple paragraphs
git commit -m "refactor(navigation): simplify drawer structure

Consolidated redundant navigation layers and improved
type safety across route definitions.

Closes #123"
```

### Commit Signing (Optional but Recommended)

#### Using GPG

```bash
# Generate GPG key
gpg --full-generate-key

# List keys and copy ID
gpg --list-secret-keys --keyid-format=long

# Configure Git
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true

# Add to GitHub: Settings → SSH and GPG keys → New GPG key
gpg --armor --export YOUR_KEY_ID
```

#### Using SSH (Easier)

```bash
# Configure Git to use SSH signing
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub

# Add SSH key to GitHub: Settings → SSH and GPG keys
# Mark it as "Signing Key"
```

#### Signing Individual Commits

```bash
git commit -S -m "feat: your message"
```

## Pull Request Process

### 1. Before Opening PR

**Checklist:**
- [ ] Code follows project style guide
- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint`)
- [ ] No type errors (`npm run typecheck`)
- [ ] Documentation updated (if needed)
- [ ] Screenshots added (for UI changes)
- [ ] Branch is up-to-date with target

### 2. PR Description Template

Our PR template includes:
- **Description** - What does this PR do?
- **Type of Change** - Feature, bug fix, docs, etc.
- **Related Issues** - Links to issues
- **Testing** - How was this tested?
- **Screenshots** - Visual changes
- **Checklist** - Pre-merge verification

### 3. Review Process

1. **Automated checks run** - CI/CD workflows
2. **Code review** - Maintainer reviews code
3. **Changes requested** - Address feedback
4. **Approval** - At least 1 approval required
5. **Merge** - Maintainer merges via squash/rebase

### 4. After Merge

```bash
# Switch to target branch and update
git checkout dev
git pull origin dev

# Delete your feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

## Branch Protection Rules

### Protected Branches: `main`, `staging`

**Enforced rules:**
- ✅ Require pull request before merging
- ✅ Require status checks to pass (CI/CD)
- ✅ Require linear history (no merge commits)
- ✅ Restrict force pushes
- ✅ Restrict deletions
- ⚠️ Require signed commits (configurable - see note below)

**Note on Signed Commits:**  
If you accept GitHub UI suggestions or use the web editor, commits are automatically signed by `github-actions[bot]`. This is acceptable and doesn't require personal GPG keys. However, for command-line commits, follow the signing instructions above if this rule is enabled.

### Dev Branch: Looser Rules

- ⚠️ Force push allowed (for rebasing)
- ⚠️ Direct push allowed (for quick iterations)
- ✅ Still requires PR to merge into `staging`

## CI/CD Integration

### GitHub Actions Workflows

Our workflows are triggered by pushes to protected branches:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `eas-staging.yml` | Push to `staging` | Test, build, release to staging |
| `eas-production.yml` | Push to `main` | Test, build, release to production |

**Important:** We use `push` triggers only (no `pull_request`), so workflows run **once** when PR merges.

### Workflow Runs

**On PR merge to `staging`:**
1. ✅ Linting and type checking
2. ✅ Run tests
3. ✅ Semantic release (pre-release version)
4. ✅ EAS Update to staging branch

**On PR merge to `main`:**
1. ✅ Linting and type checking
2. ✅ Run tests
3. ✅ Semantic release (production version)
4. ✅ EAS Update to production branch
5. ✅ Create GitHub release with changelog

### Preventing Duplicate Runs

**❌ Wrong (runs twice):**
```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

**✅ Correct (runs once on merge):**
```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:  # Manual trigger option
```

### Concurrency Control

Workflows use concurrency groups to prevent overlapping runs:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This cancels in-progress runs when new commits are pushed.

### GitHub Personal Access Token (GH_PAT)

**Required for semantic-release on protected branches.**

The workflows use a `GH_PAT` secret to bypass branch protection rules when semantic-release commits version bumps. Without this, semantic-release would fail because:
- Protected branches require PRs
- semantic-release creates commits directly

**Setup:**

1. **Create a fine-grained Personal Access Token:**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Click "Generate new token"
   - Name: `semantic-release-bypass`
   - Repository access: Only select `clanker`
   - Permissions:
     - Contents: **Read and write**
   - Expiration: Set based on your security policy (e.g., 1 year)
   - Generate token and copy it

2. **Add as repository secret:**
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `GH_PAT`
   - Secret: Paste the token
   - Add secret

3. **Verify in GitHub branch protection:**
   - Go to Settings → Rules → Rulesets
   - Edit the ruleset for `main` and `staging`
   - Under "Bypass list", add the token user (your GitHub username)
   - Save changes

**Fallback:** If `GH_PAT` is not configured, workflows fall back to `GITHUB_TOKEN`, but semantic-release may fail on protected branches.

## Common Tasks

### Syncing Branches

**After staging merges to main:**
```bash
# Update dev and staging from main
git checkout main
git pull origin main

git checkout staging
git merge main --ff-only
git push origin staging

git checkout dev
git merge main --ff-only
git push origin dev
```

### Fixing Merge Conflicts

```bash
# Rebase instead of merge to avoid conflicts
git fetch origin main
git rebase origin/main

# If conflicts:
# 1. Resolve conflicts in files
# 2. Stage resolved files
git add .

# 3. Continue rebase
git rebase --continue

# 4. Force-push updated branch
git push --force-with-lease origin your-branch
```

### Emergency Hotfix to Production

```bash
# Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug

# Make fix and test thoroughly
# ...

# Commit with fix type
git commit -m "fix: resolve critical production bug"

# Push and create PR to main
git push origin hotfix/critical-bug

# After merge, backport to staging and dev
git checkout staging
git cherry-pick <hotfix-commit-sha>
git push origin staging

git checkout dev
git cherry-pick <hotfix-commit-sha>
git push origin dev
```

### Cleaning Up Old Branches

```bash
# List merged branches
git branch --merged main

# Delete locally
git branch -d old-feature-branch

# Delete remotely
git push origin --delete old-feature-branch

# Prune deleted remote branches
git fetch --prune
```

## Troubleshooting

### "Repository has moved" Error

**Problem:**
```
remote: This repository moved. Please use the new location:
remote:   git@github.com:equationalapplications/clanker.git
```

**Solution:**
```bash
# Update remote URL
git remote set-url origin git@github.com:equationalapplications/clanker.git

# Verify
git remote -v
```

### "Cannot force-push to protected branch"

**Problem:** Trying to force-push to `main` or `staging`.

**Solution:**
1. Never force-push to protected branches
2. Use PR workflow instead
3. If you must update history, create a new branch:
   ```bash
   git checkout -b fix/branch-name origin/main
   # Make changes
   git push origin fix/branch-name
   # Open PR
   ```

### "Merge commit not allowed"

**Problem:** Branch has merge commits, violates linear history.

**Solution:**
```bash
# Rebase to remove merge commits
git rebase origin/main

# Or create fresh branch with cherry-picked commits
git checkout -b fix/linear-history origin/main
git cherry-pick <commit-sha>...
git push origin fix/linear-history
```

### "Unsigned commit rejected"

**Problem:** Branch protection requires signed commits.

**Solution:**
1. Sign commits as described in [Commit Signing](#commit-signing-optional-but-recommended)
2. Or, if working via GitHub UI, commits are auto-signed by `github-actions[bot]`
3. Temporarily disable "Require signed commits" in branch settings if needed for cleanup

### Diverged Branches

**Problem:**
```
Your branch and 'origin/main' have diverged,
and have 10 and 5 different commits each.
```

**Solution:**
```bash
# If your local changes should win:
git push --force-with-lease origin main

# If remote changes should win:
git reset --hard origin/main

# If you want to keep both (creates merge commit):
git pull --rebase origin main
```

### Lost Commits After Rebase

**Problem:** Commits disappeared after rebasing.

**Solution:**
```bash
# Find lost commits
git reflog

# Restore to previous state
git reset --hard HEAD@{N}  # Replace N with reflog entry number
```

## Best Practices Summary

1. ✅ **Always use feature branches** - Never commit directly to `main`/`staging`
2. ✅ **Rebase, don't merge** - Keeps history linear
3. ✅ **Write conventional commits** - Enables automated versioning
4. ✅ **Keep PRs focused** - One feature/fix per PR
5. ✅ **Update documentation** - Code changes should include doc updates
6. ✅ **Test before pushing** - Run linting, type checks, and tests locally
7. ✅ **Sign commits** - Verify your identity (optional but recommended)
8. ✅ **Sync regularly** - Keep your branch up-to-date with target
9. ❌ **Never force-push to protected branches** - Use PR workflow
10. ❌ **Don't accept GitHub UI suggestions on protected branches** - Apply locally and push

---

**Questions?** Open a [Discussion](https://github.com/equationalapplications/clanker/discussions) or contact the team.
