# Contributing to Clanker

Thank you for your interest in contributing to Clanker! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Git Workflow & Branch Strategy](#git-workflow--branch-strategy)
- [Merge Strategy: Promoting to Production](#merge-strategy-promoting-to-production)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Testing](#testing)
- [Firebase Functions Testing](#firebase-functions-testing)
- [Web Debugging](#web-debugging)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

Quick start:

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clanker.git
   cd clanker
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/equationalapplications/clanker.git
   ```

## Development Setup

### Prerequisites

- Node.js (v18 or later)
- npm (v9 or later)
- Expo CLI
- iOS Simulator (for iOS development) or Android Studio (for Android development)

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Fill in the required values in `.env` (see README.md for details)

3. **Start the development server**:
   ```bash
   npm start
   ```

### Important Files to Review

Before contributing, please read:
- [README.md](README.md) — Project overview and documentation index
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — Development patterns and architecture
- Documentation in `/docs` folder — Detailed implementation guides

## Git Workflow & Branch Strategy

We use a two-branch model with feature branches that merge into `staging`, then promote to `main`.

```
feature-branch
  ↓ PR (Merge Commit)
staging          ← integration & pre-release testing
  ↓ PR (Merge Commit)
main             ← production
```

> **Why merge commits only?** Squash merging concatenates all commit messages from the source branch into the merge commit body. If `chore(release): ... [skip ci]` gets included, GitHub Actions skips the release workflow. Always use "Create a merge commit".

### Starting New Work

You can start from either `staging` or `main`:

- Use `staging` when your feature depends on unreleased integration work.
- Use `main` (shortcut) when you want the latest production release.

```bash
# Option A — from staging
git checkout staging && git pull origin staging
git checkout -b feat/your-feature-name

# Option B — from main (PR still targets staging)
git checkout main && git pull origin main
git checkout -b feat/your-feature-name
```

### Doing the Work

Use [Conventional Commits](https://www.conventionalcommits.org/) from the start:

```bash
git commit -m "feat(profile): create basic profile page"
git commit -m "feat(profile): add avatar component"
```

### Before Creating a PR

Rebase onto the latest staging:

```bash
git fetch origin
git rebase origin/staging
```

### Branch Protection Rules

| Branch    | Requires PR | Linear History | Signed Commits |
| --------- | ----------- | -------------- | -------------- |
| `main`    | ✅          | ✅             | ✅             |
| `staging` | ✅          | ✅             | ✅             |

---

## Merge Strategy: Promoting to Production

### Promoting staging → main

1. Create a PR from `staging` into `main` with title `chore(release): promote staging to production`
2. Select **"Create a merge commit"** (never squash)
3. CI on `main` runs `semantic-release`, bumps version, generates CHANGELOG, creates a GitHub release

> **Note:** `semantic-release` on staging only creates a GitHub pre-release tag — it does not commit files. This prevents merge conflicts when promoting to main.

### Syncing main → staging (Required After Every Release)

After every production release, sync those changes back into `staging`:

1. Create a PR from `main` into `staging` with title `chore: sync main into staging`
2. Select **"Create a merge commit"**

**Why this matters:** semantic-release commits updated `CHANGELOG.md`, `package.json`, and `package-lock.json` to `main`. If you skip this sync, feature branches diverge and you'll hit merge conflicts on those files later.

### Hotfixes

```bash
git checkout -b hotfix/critical-bug main
# fix → PR into main (merge commit)
# then sync main back into staging
```

### Quick Reference

| Action | Method | Commit Message |
|---|---|---|
| Feature → staging | Merge Commit | `feat(scope): description` |
| staging → main | Merge Commit | `chore(release): promote staging to production` |
| main → staging | Merge Commit | `chore: sync main into staging` |
| Hotfix → main | Merge Commit | `fix(scope): description` |

### Common Pitfalls

1. **Never use "Squash and merge"** for PRs targeting `staging` or `main`
2. **Don't skip syncing main → staging** after releases — the most common source of avoidable conflicts
3. **Branch from `staging`** (not `main`) to avoid missing unreleased work
4. **Always pull latest before promoting** — stale local branches lead to unexpected conflicts

---

## How to Contribute

### Reporting Bugs

- Check if the bug has already been reported in [Issues](https://github.com/equationalapplications/clanker/issues)
- If not, create a new issue with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots (if applicable)
  - Environment details (OS, device, app version)

### Suggesting Features

- Check existing [Issues](https://github.com/equationalapplications/clanker/issues) for similar suggestions
- Create a new issue with:
  - Clear description of the feature
  - Use cases and benefits
  - Potential implementation approach (optional)

### Contributing Code

Quick workflow:

1. **Choose or create an issue** to work on
2. **Create a feature branch** (see [Git Workflow](#git-workflow--branch-strategy))
3. **Make your changes** following our coding standards
4. **Test thoroughly** (see [Testing](#testing))
5. **Commit your changes** using Conventional Commits
6. **Push to your fork** and **create a Pull Request** targeting `staging`

## Pull Request Process

1. **Update documentation** if your changes affect usage or APIs
2. **Add tests** for new functionality
3. **Run all checks**:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run test:functions   # if changing Cloud Functions
   ```
4. **Ensure your PR**:
   - Has a clear title and description
   - References related issues (e.g., "Fixes #123")
   - Includes screenshots for UI changes
   - Has no merge conflicts with staging branch
5. **Request review** from maintainers
6. **Address feedback** promptly

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Define proper types (avoid `any`)
- Use interfaces for object shapes
- Export types when they're used across files

### React Native / React

- Use functional components with hooks
- Keep components focused and reusable
- Use `memo` for performance when appropriate
- Follow the existing component structure in the project

### File Organization

- Follow the existing directory structure
- Place components in `/src/components` or `/app` (for screens)
- Place hooks in `/src/hooks`
- Place services in `/src/services`
- Add documentation to `/docs` for major features

### Naming Conventions

- **Components**: PascalCase (e.g., `CharacterList.tsx`)
- **Hooks**: camelCase starting with `use` (e.g., `useCharacter.ts`)
- **Utils/Services**: camelCase (e.g., `characterService.ts`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `MAX_CHARACTERS`)

### Code Style

- Use Prettier for formatting (runs automatically on commit)
- Use ESLint rules (run `npm run lint`)
- Add comments for complex logic
- Keep functions small and focused
- Avoid deeply nested code

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning with `semantic-release`.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Line limits:** Header max 100 characters, body/footer max 100 characters each.

### Types & Version Impact

| Type | Description | Version Bump |
|------|-------------|-------------|
| `feat` | New feature | Minor |
| `fix` | Bug fix | Patch |
| `perf` | Performance improvement | Patch |
| `docs` | Documentation only | None |
| `style` | Code style (formatting) | None |
| `refactor` | Code refactoring | None |
| `test` | Adding/updating tests | None |
| `chore` | Maintenance tasks | None |
| `ci` | CI/CD changes | None |
| `build` | Build system changes | None |

### Breaking Changes

`BREAKING CHANGE:` in the footer increments the **major** version, which updates `runtimeVersion` in `app.config.ts` and requires a new native build + app store submission. Use this only when adding/updating native modules, Expo SDK, or native config. Non-breaking commits deploy as OTA updates.

### Examples

```
feat(characters): add character sharing functionality

fix(auth): resolve token refresh race condition
Closes #123
```

```
fix(auth): resolve Firebase token refresh issue

Fix race condition where token refresh could fail during
background sync, causing authentication errors.

Fixes #456
```

## Testing

### Running Tests

```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
```

### Writing Tests

- Add tests for new features in `__tests__` directory
- Follow existing test patterns
- Test both success and error cases
- Mock external dependencies (Firebase, Supabase, etc.)

### Manual Testing

Before submitting a PR:
1. Test on iOS simulator/device
2. Test on Android emulator/device
3. Test on web (if applicable)
4. Test with different subscription states
5. Test offline behavior

---

## Firebase Functions Testing

Cloud Functions tests live in `functions/src/*.test.ts` and focus on:
- Callable auth and input validation
- Webhook request validation
- Happy-path Cloud SQL bootstrap/repository flow with mocked dependencies

The suite avoids live network calls to Stripe, Cloud SQL, and Firebase Auth.

### Commands

```bash
cd functions
npm run typecheck      # Validate TypeScript
npm run lint           # ESLint for functions sources and tests
npm run test           # Compile + run Node test runner
```

### Runtime Config

Some flows depend on non-sensitive params in the target environment:
- `STRIPE_SUCCESS_URL=https://clanker-ai.com/checkout/success`
- `STRIPE_CANCEL_URL=https://clanker-ai.com/checkout/cancel`

Stripe checkout tests also assume `STRIPE_SECRET_KEY` is set to a valid key-like value.

### Test Design Notes

- Tests call exported internal handlers (`*Handler`) directly — no emulator setup needed
- Cloud SQL-backed flows mock repository/service boundaries with deterministic behavior
- Webhook tests use in-memory request/response recorders

### Adding New Function Tests

1. Add or expose a handler symbol in the function module
2. Create a sibling `*.test.ts` file in `functions/src`
3. Keep external systems mocked
4. Run `npm run typecheck && npm run lint && npm run test` from `functions/`

---

## Web Debugging

### Quick Start: Live Debug Session

1. **Start Metro in a terminal:**
   ```bash
   npx expo start --web --port 8081
   ```
   Wait for `Web: http://localhost:8081` to appear.

2. **Open `http://localhost:8081`** in Chrome/Edge.

3. **Simulate a fresh user by clearing storage:**
   ```js
   window.localStorage.clear()
   location.reload()
   ```

4. **Capture all errors via Playwright:**
   ```js
   const errors = []
   page.on('pageerror', err => errors.push({ text: err.message, stack: err.stack }))
   page.on('console', msg => {
     if (msg.type() === 'warning' || msg.type() === 'error')
       errors.push({ type: msg.type(), text: msg.text(), location: msg.location() })
   })
   await page.evaluate(() => window.localStorage.clear())
   await page.reload()
   await page.waitForTimeout(4000)
   return errors
   ```

### Style Pitfalls (Crashes on Web)

1. **Style arrays passed through `<Link asChild>` / `<Slot>`** — crashes with `CSSStyleDeclaration` indexed setter error. Fix: use `StyleSheet.flatten()` before passing to `<Link asChild>` children.

2. **`gap` in `StyleSheet.create`** — same error. Replace `gap` with `columnGap` and `rowGap`.

3. **Mixed `StyleSheet` IDs and inline objects** — use `StyleSheet.flatten()` to produce a plain object.

4. **`animationType="fade"` on `Modal`** — use `animationType="none"` for web-only modals.

### Debugging Strategy

- Start Metro + open `localhost:8081` with localStorage cleared (reproduces first-time user state)
- Capture `pageerror` events first — they include source-mapped stack traces pointing to your code
- Read the Component Stack in the dev overlay (identifies culprit faster than call stacks)
- Search `[styles.` in the culprit file to find style arrays
- Verify fix by reloading with cleared localStorage and confirming no errors

### Remaining Noise (safe to ignore)

| Warning | Source |
|---|---|
| `shadow* style props are deprecated. Use boxShadow.` | React Native Paper |
| `props.pointerEvents is deprecated. Use style.pointerEvents` | React Native Web |
| `[Reanimated] Property [transform] may be overwritten` | Reanimated + Paper |
| `useNativeDriver is not supported` | Animated without `useNativeDriver: false` |
| Firebase App Check 403 | Debug token not configured for localhost |

---

## Documentation

### Code Documentation

- Add JSDoc comments for public APIs
- Document complex algorithms or business logic
- Keep comments up-to-date with code changes

### Project Documentation

- Update relevant docs in `/docs` folder
- Add links in README.md for new major features
- Include code examples in documentation
- Keep the documentation style consistent

### API Documentation

When adding new APIs or changing existing ones:
1. Document parameters and return types
2. Provide usage examples
3. Note any breaking changes
4. Update related documentation files

## Getting Help

- **Questions**: Open a [Discussion](https://github.com/equationalapplications/clanker/discussions)
- **Bugs**: Open an [Issue](https://github.com/equationalapplications/clanker/issues)
- **Security**: Email [info@equationalapplications.com](mailto:info@equationalapplications.com)

## Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes (for significant contributions)

Thank you for contributing to Clanker! 🎉
