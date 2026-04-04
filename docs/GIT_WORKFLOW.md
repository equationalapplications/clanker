# Git Workflow

We use a two-branch model with a one-way flow of changes. All new work is done on temporary **feature branches** and merged into `staging`.

```
feature-branch
  ↓ PR (Squash and Merge)
staging          ← integration & pre-release testing
  ↓ PR (Squash and Merge)
main             ← production
```

## The "Feature Branch → Squash Merge" Workflow

### Starting New Work

Always start from the `staging` branch. Make sure your local copy is up-to-date.

```bash
git checkout staging
git pull origin staging
git checkout -b feat/add-user-profile  # Or fix/login-bug, etc.
```

### Doing the Work

On your feature branch, work as you normally do. Create as many commits as you want — they will be squashed later.

```bash
git commit -m "feat(profile): create basic profile page"
git commit -m "feat(profile): add avatar component"
```

### Creating a Pull Request

When your feature is complete, create a Pull Request targeting `staging`.

**Before creating the PR**, rebase onto the latest staging to handle conflicts on your branch:

```bash
git pull --rebase origin staging
```

Push your branch and create a PR on GitHub from your feature branch into `staging`.

### Promoting to Production

When staging is ready for release:

1. Create a PR from `staging` → `main`.
2. Use **"Squash and Merge"**.
3. CI on `main` runs `semantic-release`, which bumps `package.json`, generates `CHANGELOG.md`, and creates a GitHub release.

> **Note:** `semantic-release` on staging only creates a GitHub pre-release tag — it does **not** commit files back to the branch. This prevents merge conflicts when promoting to main.

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning with `semantic-release`.

**Format:** `<type>(<scope>): <subject>`

| Type       | Description             | Version Bump |
| ---------- | ----------------------- | ------------ |
| `feat`     | New feature             | Minor        |
| `fix`      | Bug fix                 | Patch        |
| `perf`     | Performance improvement | Patch        |
| `docs`     | Documentation only      | None         |
| `style`    | Code style (formatting) | None         |
| `refactor` | Code refactoring        | None         |
| `test`     | Adding/updating tests   | None         |
| `chore`    | Maintenance tasks       | None         |
| `ci`       | CI/CD changes           | None         |
| `build`    | Build system changes    | None         |


**⚠️ CRITICAL - Breaking Changes & Runtime Version:**

- Breaking changes (`BREAKING CHANGE:`) increment major version → updates `runtimeVersion` in `app.config.ts`
- New runtime version → **requires new native build and app store submission**
- Non-breaking commits → OTA update (instant deployment) - Fine for Javascript-only changes
- **Only use breaking changes when adding/updating native modules, Expo SDK, or native config**