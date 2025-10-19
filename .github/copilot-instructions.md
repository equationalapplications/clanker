# 📖 READ THE README FIRST

**Before starting any development work, always read the `README.md` file.** The README contains an index of all documentation with links to detailed guides in the `/docs` folder. When working on a specific feature or system:

1. Check the README for relevant documentation links
2. Read the linked documentation file(s) for implementation details
3. Review related files mentioned in the documentation
4. Only then proceed with development

# ⚠️ CRITICAL REFACTORING RULES

1. **DO NOT delete files that are part of the app** - Even if temporarily unused during a refactor, functional files must be preserved with a `// TODO: Re-integrate this file after [refactor description]` comment at the top.

2. **DO NOT delete imports or function calls** - If temporarily not using an import or function during testing/refactoring, comment it out with `// TODO: Re-enable after [reason]` instead of deleting it.

3. **DO NOT create example or placeholder files** - Only create production-ready code. No `ExampleComponent.tsx` or `PlaceholderScreen.tsx` files that could be confused with real functionality.

4. **DO NOT replace working screens with TODO screens** - If a screen exists with functionality (edit, chat, etc.), preserve it. Don't replace it with a skeleton that says "TODO: Implement this".

5. **Mark deprecated code clearly** - If code is truly being replaced, add a comment: `// DEPRECATED: Use NewComponent instead. Will be removed in [version/date]`

6. **Verify before deletion** - Before suggesting file/code deletion, explicitly confirm with the user that it's not functional code that's temporarily disconnected during refactoring.

7. **DO NOT create temporary or sample files without asking** - Never create temporary utility files, sample data files, test SQL files, or any other temporary files without explicit user permission. These clutter the codebase. If you need to show an example, use a code block in your response instead.

**Why**: Deleting functional code during refactoring causes lost work, broken features, and confusion. Commenting preserves code that can be quickly restored or referenced. Temporary files clutter the repository and create maintenance burden.

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

**See**: `docs/GIT_WORKFLOW.md` for detailed branch strategy, PR process, and commit guidelines. See `docs/EXPO_UPDATES.md` for runtime versioning and OTA vs native build decisions.

# Documentation Guidelines

When creating or updating documentation:

1. **Create detailed docs in `/docs` folder** - All comprehensive documentation lives in individual markdown files in the `docs/` directory. Use descriptive filenames like `FEATURE_NAME.md` or `SYSTEM_NAME.md` in SCREAMING_SNAKE_CASE.

2. **Add summary + link to README** - After creating a doc file, add a brief 1-2 sentence summary and a link to it in the main `README.md` under the appropriate section (e.g., "Documentation Deep Dives", "Architecture", "Key Features").

3. **Doc structure** - Each documentation file should include:
   - Clear title and purpose
   - Table of contents for longer docs
   - Code examples with explanations
   - Common pitfalls or gotchas
   - Related files and their locations
   - Links to other relevant docs

4. **Keep README concise** - The README should be a high-level overview and index. Detailed implementation details belong in individual doc files, not the README.

5. **Update existing docs** - When making significant code changes, update the corresponding documentation in `/docs`. Don't let docs become stale.

6. **Example format**:
   ```markdown
   # Feature Name
   
   Brief description of what this feature does and why it exists.
   
   ## Overview
   - Key concept 1
   - Key concept 2
   
   ## Implementation
   Detailed explanation with code examples...
   
   ## Related Files
   - `src/path/to/file.ts` - What it does
   ```

7. **Link format in README**:
   ```markdown
   - **[Feature Name](docs/FEATURE_NAME.md)** - Brief 1-2 sentence description of what the doc covers.
   ```