# Docs
- Read README links for implementation details.
- Read exact Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing code.

# Checks
- After changing `root` or `functions/`, run: `npm run typecheck && npm run lint && npm run test`

# Git & Commits
- **Flow**: feature → `staging` → `main` (via PRs only).
- **Commits**: Use Conventional Commits.
  - `feat`: Minor bump (OTA)
  - `fix`: Patch bump (OTA)
  - `BREAKING CHANGE`: Major bump (Native build required)
- **Length**: Max 100 characters per line (header, body, and footer).

# PRs & Reviews
- **Template**: Always use `.github/pull_request_template.md`.
- **Copilot**: Ignore `package.json`, `package-lock.json`, and `CHANGELOG.md` changes in staging PRs if they match `main` (these are semantic-release artifacts).
