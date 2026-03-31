# 📖 READ THE README FIRST

**Before starting any development work, always read the `README.md` file.** The README contains an index of all documentation with links to detailed guides in the `/docs` folder. When working on a specific feature or system:

1. Check the README for relevant documentation links
2. Read the linked documentation file(s) for implementation details
3. Review related files mentioned in the documentation
4. Only then proceed with development

# 🔀 GIT WORKFLOW & VERSIONING

**Branch Strategy**: Three-tier promotion flow: `dev` → `staging` → `main`. All changes go through PRs (no direct commits to protected branches).

**Commit Format**: Use [Conventional Commits](https://www.conventionalcommits.org/) - commits drive semantic-release which auto-versions the app.

```bash
feat(scope): add new feature        # Minor bump (1.0.0 → 1.1.0) - OTA update
fix(scope): resolve bug             # Patch bump (1.0.0 → 1.0.1) - OTA update
feat!(scope): breaking change       # Major bump (1.0.0 → 2.0.0) - NATIVE BUILD REQUIRED
```

**⚠️ CRITICAL - Breaking Changes & Runtime Version:**

- Breaking changes (`feat!` or `BREAKING CHANGE:`) increment major version → updates `runtimeVersion` in `app.config.ts`
- New runtime version → **requires new native build and app store submission**
- Non-breaking commits → OTA update (instant deployment)
- **Only use breaking changes when adding/updating native modules, Expo SDK, or native config**


# Documentation Guidelines

When creating or updating documentation:

1. **Create detailed docs in `/docs` folder** - All comprehensive documentation lives in individual markdown files in the `docs/` directory. Use descriptive filenames like `FEATURE_NAME.md` or `SYSTEM_NAME.md` in SCREAMING_SNAKE_CASE.

2. **Add summary + link to README** - After creating a doc file, add a brief 1-2 sentence summary and a link to it in the main `README.md` under the appropriate section (e.g., "Documentation Deep Dives", "Architecture", "Key Features").

3. **Keep README concise** - The README should be a high-level overview and index. Detailed implementation details belong in individual doc files, not the README.