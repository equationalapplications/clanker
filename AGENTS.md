# 📖 READ THE README FIRST

1. Check the README for relevant documentation links
2. Read the linked documentation file(s) for implementation details

# 🔀 GIT WORKFLOW & VERSIONING

**Branch Strategy**: Two-branch promotion flow: `staging` → `main`. Feature branches merge into `staging` via PR. All changes go through PRs (no direct commits to protected branches).

**Commit Format**: Use [Conventional Commits](https://www.conventionalcommits.org/) - commits drive semantic-release which auto-versions the app.

```bash
feat(scope): add new feature        # Minor bump (1.0.0 → 1.1.0) - OTA update
fix(scope): resolve bug             # Patch bump (1.0.0 → 1.0.1) - OTA update
'BREAKING CHANGE:': breaking change       # Major bump (1.0.0 → 2.0.0) - NATIVE BUILD REQUIRED
```

**Commit Message Line Length Limits** (enforced by commitlint):
- Header (first line): max **100 characters**
- Body lines: max **100 characters** each
- Footer lines: max **100 characters** each

# DOCUMENTATION

1. **Create detailed docs in `/docs` folder** - All comprehensive documentation lives in individual markdown files in the `docs/` directory. Use descriptive filenames like `FEATURE_NAME.md` or `SYSTEM_NAME.md` in SCREAMING_SNAKE_CASE.

2. **Add summary + link to README** - After creating a doc file, add a brief 1-2 sentence summary and a link to it in the main `README.md` under the appropriate section (e.g., "Documentation Deep Dives", "Architecture", "Key Features").

3. **Keep README concise** - The README should be a high-level overview and index. Detailed implementation details belong in individual doc files, not the README.