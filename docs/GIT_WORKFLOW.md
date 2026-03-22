# Git Workflow

This document outlines the Git workflow for contributing to the project. The goal is a clear, repeatable process that minimizes surprises and keeps our history clean.

## Branch Strategy

We use a three-tier branching model with a one-way flow of changes. All new work is done on temporary **feature branches** and merged into `dev`.

```
feature-branch
  ↓ PR (Squash and Merge)
dev
  ↓ PR
staging
  ↓ PR
main
```

### Branch Purposes

| Branch    | Purpose                 | Protected | Deployment       |
| --------- | ----------------------- | --------- | ---------------- |
| `main`    | Production-ready code   | ✅ Yes    | Production (EAS) |
| `staging` | Pre-release testing     | ✅ Yes    | Staging (EAS)    |
| `dev`     | Active development      | ⚠️ Partial | Dev client only  |

## The "Feature Branch → Squash Merge" Workflow

This is the primary workflow for all new features and bug fixes. It keeps our `dev`, `staging`, and `main` branches clean and easy to understand.

### 1. Starting New Work

Always start from the `dev` branch. First, make sure your local `dev` is up-to-date.

```bash
git checkout dev
git pull origin dev
git checkout -b feat/add-user-profile # Or fix/login-bug, etc.
```

### 2. Doing the Work

On your feature branch (e.g., `feat/add-user-profile`), work as you normally do. Create as many commits as you want—they are temporary and will be squashed later.

```bash
# ...write some code...
git commit -m "WIP: created profile page"
# ...write more code...
git commit -m "added avatar component"
```

### 3. Creating a Pull Request

When your feature is complete, you'll create a Pull Request to merge it into `dev`.

**Before creating the PR**, update your branch with the latest changes from `dev`. This is where you handle any potential conflicts yourself, before anyone else sees them.

```bash
# While on your feature branch (e.g., feat/add-user-profile)
git pull --rebase origin dev
```
*(If there are any conflicts, Git will pause and let you fix them. This keeps the final PR clean.)*

Push your branch and create a PR on GitHub from your feature branch into `dev`.

### 4. Merging the Pull Request

This is the most important part for a clean history. When merging the PR, select the **"Squash and Merge"** option on GitHub.

-   **Edit the commit message** to follow the [Conventional Commits](https://www.conventionalcommits.org/) standard. For example: `feat(profile): add user profile page and avatar`.
-   This takes all your small commits ("WIP", "added component") and combines them into **one single, meaningful commit** on the `dev` branch.

This process ensures `dev` has a clean, linear history of meaningful features, which makes promoting code to `staging` and `main` simple and conflict-free.

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning with `semantic-release`.

**Format:** `<type>(<scope>): <subject>`

| Type     | Description            | Version Bump |
| -------- | ---------------------- | ------------ |
| `feat`   | New feature            | Minor        |
| `fix`    | Bug fix                | Patch        |
| `perf`   | Performance improvement| Patch        |
| `docs`   | Documentation only     | None         |
| `style`  | Code style (formatting)| None         |
| `refactor`| Code refactoring       | None         |
| `test`   | Adding/updating tests  | None         |
| `chore`  | Maintenance tasks      | None         |
| `ci`     | CI/CD changes          | None         |
| `build`  | Build system changes   | None         |

For a **breaking change**, add `!` after the type (e.g., `feat!: ...`). This will trigger a **major** version bump and requires a new native build. Use it only when changing native code or the Expo SDK.
