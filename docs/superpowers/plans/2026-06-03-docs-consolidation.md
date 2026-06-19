# Documentation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse 40+ fragmented docs files into ~6 domain docs + ADRs + contributor guide, eliminating library rehashes and micro-feature files that rot on every code change.

**Architecture:** Each source file is read in full, its Clanker-specific "why and glue" content is merged into the appropriate consolidated file, then the source is deleted. Library-rehash content (how third-party tools work generically) is dropped entirely. Contributor workflow content moves to root `CONTRIBUTING.md`.

**Tech Stack:** Markdown, git

---

## Final Target Structure

```
docs/
├── authentication.md          # Auth flow, bootstrap, cache, cookie consent, terms
├── ai-and-chat.md             # Chat pipeline, LLM wiki memory, image generation
├── billing-and-credits.md     # Payments, credits, Apple consent, checkout sync
├── admin-operations.md        # Admin dashboard, functions, runbook
├── architecture-and-data.md   # State management, Cloud SQL, offline, navigation, cloud save
├── accessibility.md           # Keep unchanged (already focused)
├── adrs/
│   └── 001-callable-error-normalization.md
├── flowcharts/                # Keep unchanged
└── superpowers/               # Keep unchanged — agent specs/plans; not indexed in root README.md (see AGENTS.md)

Root:
CONTRIBUTING.md                # Absorbs git workflow, merge strategy, debugging, functions testing
README.md                      # Add quick-start env var list (extracted from deleted FIREBASE_SETUP.md)
```

**Files deleted after consolidation (41 files → 6 + ADRs):**
- `AUTH_CACHE_MANAGEMENT.md`, `AUTH_FLOW.md`, `AUTH_PROVIDER_NAME_SYNC.md`, `AUTH_SOURCE_OF_TRUTH.md`, `BOOTSTRAP_EVENT_DRIVEN_REFRESH.md`, `COOKIE_CONSENT.md`, `OPTIMISTIC_TERMS_ACCEPTANCE.md`
- `CHAT_MEMORY_SUMMARIZATION.md`, `CHAT_RESPONSE_FUNCTION.md`, `IMAGE_GENERATION.md`, `IMAGE_GENERATION_FUNCTION.md`, `LLM_WIKI_MEMORY.md`, `WIKI_ARCHITECTURE.md`
- `PAYMENT_INTEGRATION.md`, `FIRST_LOGIN_CREDITS.md`, `APPLE_SUBSCRIPTION_CONSENT.md`, `CHECKOUT_MULTI_TAB_SYNC.md`
- `ADMIN_DASHBOARD.md`, `ADMIN_FUNCTIONS.md`, `ADMIN_RUNBOOK.md`
- `CLOUD_SQL_DESIGN.md`, `CLOUD_SQL_MIGRATIONS.md`, `STATE_MANAGEMENT.md`, `MIGRATION_OFFLINE.md`, `NAVIGATION.md`, `CLOUD_CHARACTER_SAVE_SHARE.md`, `AVATAR_GALLERY_UPLOAD.md`, `SUPPORT_PAGE.md`
- `CALLABLE_ERROR_NORMALIZATION.md` (moved to `adrs/`)
- `GIT_WORKFLOW.md`, `MERGE_STRATEGY.md`, `WEB_DEBUGGING.md`, `FIREBASE_FUNCTIONS_TESTING.md`
- **Library rehashes deleted entirely:** `FIREBASE_SETUP.md`, `FIREBASE_FUNCTIONS.md`, `EXPO_UPDATES.md`, `PAYMENT_API.md`

---

### Task 1: Create ADR for Callable Error Normalization

**Files:**
- Create: `docs/adrs/001-callable-error-normalization.md`
- Delete: `docs/CALLABLE_ERROR_NORMALIZATION.md`

- [ ] **Step 1: Read the source file in full**

```bash
cat docs/CALLABLE_ERROR_NORMALIZATION.md
```

- [ ] **Step 2: Create ADR file**

Create `docs/adrs/001-callable-error-normalization.md` with this structure. Preserve all content from the source verbatim, prepend the ADR header:

```markdown
# ADR 001: Callable Error Normalization

**Date:** 2024 (exact date unknown — see git log)
**Status:** Accepted

## Context

[paste the "Why This Exists" section from the source]

## Decision

[paste the "Normalization Rules" section from the source]

## Consequences

[paste the "Applying in Callables" / "Testing" sections from the source]
```

- [ ] **Step 2b: Fix relative links after directory depth change**

The file moves from `docs/` to `docs/adrs/`, so any relative paths gain one extra `../`:

```bash
# Check for any relative links in the source
grep -E "\[.*\]\(\.\.?/" docs/CALLABLE_ERROR_NORMALIZATION.md || grep -E "\[.*\]\([^h]" docs/CALLABLE_ERROR_NORMALIZATION.md
```

For each relative link found, adjust the path (e.g., `../assets/foo.png` stays correct since it now resolves from `docs/adrs/` up to `docs/`; links like `AUTH_FLOW.md` must become `../authentication.md`).

- [ ] **Step 3: Verify the ADR file captures all source content**

```bash
wc -l docs/adrs/001-callable-error-normalization.md
# Should be close to the source line count (allow for added header lines)
```

- [ ] **Step 4: Delete source file**

```bash
git rm docs/CALLABLE_ERROR_NORMALIZATION.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/adrs/001-callable-error-normalization.md
git commit -m "docs: migrate callable error normalization to ADR 001"
```

---

### Task 2: Consolidate Authentication Domain

**Files:**
- Create: `docs/authentication.md`
- Delete: `AUTH_CACHE_MANAGEMENT.md`, `AUTH_FLOW.md`, `AUTH_PROVIDER_NAME_SYNC.md`, `AUTH_SOURCE_OF_TRUTH.md`, `BOOTSTRAP_EVENT_DRIVEN_REFRESH.md`, `COOKIE_CONSENT.md`, `OPTIMISTIC_TERMS_ACCEPTANCE.md`

- [ ] **Step 1: Read all source files in full**

```bash
cat docs/AUTH_SOURCE_OF_TRUTH.md
cat docs/AUTH_FLOW.md
cat docs/AUTH_CACHE_MANAGEMENT.md
cat docs/AUTH_PROVIDER_NAME_SYNC.md
cat docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH.md
cat docs/COOKIE_CONSENT.md
cat docs/OPTIMISTIC_TERMS_ACCEPTANCE.md
```

- [ ] **Step 2: Create consolidated authentication.md**

Create `docs/authentication.md` with this skeleton. Fill each section with the source content — keep Clanker-specific "why" and system-level glue, drop generic Firebase/Expo tutorial content that belongs in vendor docs.

```markdown
# Authentication

## Source of Truth

Firebase Auth is the canonical identity provider. Cloud SQL stores app-level user and subscription state.

[merge AUTH_SOURCE_OF_TRUTH.md content here]

## Auth Flow: Firebase → Cloud SQL Bootstrap

[merge AUTH_FLOW.md content here — the full sequence, response shape, error modes]

## Auth Cache Management

[merge AUTH_CACHE_MANAGEMENT.md content here — caching strategy, invalidation rules]

## Provider Name Sync

[merge AUTH_PROVIDER_NAME_SYNC.md content here — why display name sync is needed, how it works]

## Bootstrap Event-Driven Refresh

[merge BOOTSTRAP_EVENT_DRIVEN_REFRESH.md content here]

## Cookie Consent

[merge COOKIE_CONSENT.md content here]

## Terms Acceptance (Optimistic)

[merge OPTIMISTIC_TERMS_ACCEPTANCE.md content here]
```

- [ ] **Step 3: Verify no source section was dropped**

Scan each source file's H2/H3 headings and confirm each appears (by concept, not necessarily by name) in `authentication.md`:

```bash
grep "^#" docs/AUTH_FLOW.md docs/AUTH_CACHE_MANAGEMENT.md docs/AUTH_PROVIDER_NAME_SYNC.md docs/AUTH_SOURCE_OF_TRUTH.md docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH.md docs/COOKIE_CONSENT.md docs/OPTIMISTIC_TERMS_ACCEPTANCE.md
grep "^#" docs/authentication.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/AUTH_CACHE_MANAGEMENT.md docs/AUTH_FLOW.md docs/AUTH_PROVIDER_NAME_SYNC.md docs/AUTH_SOURCE_OF_TRUTH.md docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH.md docs/COOKIE_CONSENT.md docs/OPTIMISTIC_TERMS_ACCEPTANCE.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/authentication.md
git commit -m "docs: consolidate auth docs into authentication.md"
```

---

### Task 3: Consolidate AI & Chat Domain

**Files:**
- Create: `docs/ai-and-chat.md`
- Delete: `CHAT_MEMORY_SUMMARIZATION.md`, `CHAT_RESPONSE_FUNCTION.md`, `IMAGE_GENERATION.md`, `IMAGE_GENERATION_FUNCTION.md`, `LLM_WIKI_MEMORY.md`, `WIKI_ARCHITECTURE.md`

- [ ] **Step 1: Read all source files in full**

```bash
cat docs/WIKI_ARCHITECTURE.md
cat docs/LLM_WIKI_MEMORY.md
cat docs/CHAT_RESPONSE_FUNCTION.md
cat docs/CHAT_MEMORY_SUMMARIZATION.md
cat docs/IMAGE_GENERATION.md
cat docs/IMAGE_GENERATION_FUNCTION.md
```

- [ ] **Step 2: Create consolidated ai-and-chat.md**

```markdown
# AI & Chat

## Wiki Architecture

[merge WIKI_ARCHITECTURE.md — wikiMachine, wikiOrchestrator, useCharacterWiki, data flow]

## LLM Wiki Memory

[merge LLM_WIKI_MEMORY.md — how character memory is stored, retrieved, and used in prompts]

## Chat Response Function

[merge CHAT_RESPONSE_FUNCTION.md — the callable/function that drives AI responses]

## Chat Memory Summarization

[merge CHAT_MEMORY_SUMMARIZATION.md — when and how summaries are triggered]

## Image Generation

[merge IMAGE_GENERATION.md — feature description, subscription gating]

## Image Generation Function

[merge IMAGE_GENERATION_FUNCTION.md — the callable implementation details]
```

- [ ] **Step 3: Verify section coverage**

```bash
grep "^#" docs/WIKI_ARCHITECTURE.md docs/LLM_WIKI_MEMORY.md docs/CHAT_RESPONSE_FUNCTION.md docs/CHAT_MEMORY_SUMMARIZATION.md docs/IMAGE_GENERATION.md docs/IMAGE_GENERATION_FUNCTION.md
grep "^#" docs/ai-and-chat.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/CHAT_MEMORY_SUMMARIZATION.md docs/CHAT_RESPONSE_FUNCTION.md docs/IMAGE_GENERATION.md docs/IMAGE_GENERATION_FUNCTION.md docs/LLM_WIKI_MEMORY.md docs/WIKI_ARCHITECTURE.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/ai-and-chat.md
git commit -m "docs: consolidate AI/chat docs into ai-and-chat.md"
```

---

### Task 4: Consolidate Billing & Credits Domain

**Files:**
- Create: `docs/billing-and-credits.md`
- Delete: `PAYMENT_INTEGRATION.md`, `FIRST_LOGIN_CREDITS.md`, `APPLE_SUBSCRIPTION_CONSENT.md`, `CHECKOUT_MULTI_TAB_SYNC.md`

- [ ] **Step 1: Read all source files in full**

```bash
cat docs/PAYMENT_INTEGRATION.md
cat docs/FIRST_LOGIN_CREDITS.md
cat docs/APPLE_SUBSCRIPTION_CONSENT.md
cat docs/CHECKOUT_MULTI_TAB_SYNC.md
```

- [ ] **Step 2: Create consolidated billing-and-credits.md**

```markdown
# Billing & Credits

## Payment Integration

[merge PAYMENT_INTEGRATION.md — Stripe/RevenueCat integration, subscription tiers, how purchases are recorded]

## First Login Credits

[merge FIRST_LOGIN_CREDITS.md — how/when free credits are granted to new users]

## Apple Subscription Consent

[merge APPLE_SUBSCRIPTION_CONSENT.md — Apple IAP consent flow specifics, why it differs from web]

## Checkout Multi-Tab Sync

[merge CHECKOUT_MULTI_TAB_SYNC.md — how multiple browser tabs are kept in sync during checkout]
```

- [ ] **Step 3: Verify section coverage**

```bash
grep "^#" docs/PAYMENT_INTEGRATION.md docs/FIRST_LOGIN_CREDITS.md docs/APPLE_SUBSCRIPTION_CONSENT.md docs/CHECKOUT_MULTI_TAB_SYNC.md
grep "^#" docs/billing-and-credits.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/PAYMENT_INTEGRATION.md docs/FIRST_LOGIN_CREDITS.md docs/APPLE_SUBSCRIPTION_CONSENT.md docs/CHECKOUT_MULTI_TAB_SYNC.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs: consolidate billing/credits docs into billing-and-credits.md"
```

---

### Task 5: Consolidate Admin Operations Domain

**Files:**
- Create: `docs/admin-operations.md`
- Delete: `ADMIN_DASHBOARD.md`, `ADMIN_FUNCTIONS.md`, `ADMIN_RUNBOOK.md`

- [ ] **Step 1: Read all source files in full**

```bash
cat docs/ADMIN_DASHBOARD.md
cat docs/ADMIN_FUNCTIONS.md
cat docs/ADMIN_RUNBOOK.md
```

- [ ] **Step 2: Create consolidated admin-operations.md**

```markdown
# Admin Operations

## Admin Dashboard

[merge ADMIN_DASHBOARD.md — what the admin UI shows, how to access it]

## Admin Functions

[merge ADMIN_FUNCTIONS.md — the callable functions exposed for admin tasks, their inputs/outputs]

## Runbook

[merge ADMIN_RUNBOOK.md — step-by-step operational procedures for common admin tasks]
```

- [ ] **Step 3: Verify section coverage**

```bash
grep "^#" docs/ADMIN_DASHBOARD.md docs/ADMIN_FUNCTIONS.md docs/ADMIN_RUNBOOK.md
grep "^#" docs/admin-operations.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/ADMIN_DASHBOARD.md docs/ADMIN_FUNCTIONS.md docs/ADMIN_RUNBOOK.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/admin-operations.md
git commit -m "docs: consolidate admin docs into admin-operations.md"
```

---

### Task 6: Consolidate Architecture & Data Domain

**Files:**
- Create: `docs/architecture-and-data.md`
- Delete: `CLOUD_SQL_DESIGN.md`, `CLOUD_SQL_MIGRATIONS.md`, `STATE_MANAGEMENT.md`, `MIGRATION_OFFLINE.md`, `NAVIGATION.md`, `CLOUD_CHARACTER_SAVE_SHARE.md`, `AVATAR_GALLERY_UPLOAD.md`, `SUPPORT_PAGE.md`

- [ ] **Step 1: Read all source files in full**

```bash
cat docs/STATE_MANAGEMENT.md
cat docs/CLOUD_SQL_DESIGN.md
cat docs/CLOUD_SQL_MIGRATIONS.md
cat docs/MIGRATION_OFFLINE.md
cat docs/NAVIGATION.md
cat docs/CLOUD_CHARACTER_SAVE_SHARE.md
cat docs/AVATAR_GALLERY_UPLOAD.md
cat docs/SUPPORT_PAGE.md
```

- [ ] **Step 2: Create consolidated architecture-and-data.md**

```markdown
# Architecture & Data

## State Management

[merge STATE_MANAGEMENT.md — the layer table (xState / TanStack Query / SQLite / Context), machine list, when to add a new machine]

## Navigation

[merge NAVIGATION.md — drawer + tabs structure, Expo Router layout, auth guard flow]

## Cloud SQL Design

[merge CLOUD_SQL_DESIGN.md — schema decisions, why Cloud SQL over Firestore, table responsibilities]

## Cloud SQL Migrations

[merge CLOUD_SQL_MIGRATIONS.md — how migrations are run, naming convention, rollback approach]

## Offline Migration Strategy

[merge MIGRATION_OFFLINE.md — how SQLite schema migrations work offline-first]

## Cloud Character Save & Share

[merge CLOUD_CHARACTER_SAVE_SHARE.md — feature design, subscription gating, deep-link route]

## Avatar Gallery Upload

[merge AVATAR_GALLERY_UPLOAD.md — upload flow, storage bucket, size/format constraints]

## Support Page

[merge SUPPORT_PAGE.md — what the support flow does, who it routes to]
```

- [ ] **Step 3: Verify section coverage**

```bash
grep "^#" docs/STATE_MANAGEMENT.md docs/CLOUD_SQL_DESIGN.md docs/CLOUD_SQL_MIGRATIONS.md docs/MIGRATION_OFFLINE.md docs/NAVIGATION.md docs/CLOUD_CHARACTER_SAVE_SHARE.md docs/AVATAR_GALLERY_UPLOAD.md docs/SUPPORT_PAGE.md
grep "^#" docs/architecture-and-data.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/CLOUD_SQL_DESIGN.md docs/CLOUD_SQL_MIGRATIONS.md docs/STATE_MANAGEMENT.md docs/MIGRATION_OFFLINE.md docs/NAVIGATION.md docs/CLOUD_CHARACTER_SAVE_SHARE.md docs/AVATAR_GALLERY_UPLOAD.md docs/SUPPORT_PAGE.md
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture-and-data.md
git commit -m "docs: consolidate architecture/data docs into architecture-and-data.md"
```

---

### Task 7: Merge Contributor Workflow into CONTRIBUTING.md

**Files:**
- Modify: `CONTRIBUTING.md`
- Delete: `docs/GIT_WORKFLOW.md`, `docs/MERGE_STRATEGY.md`, `docs/WEB_DEBUGGING.md`, `docs/FIREBASE_FUNCTIONS_TESTING.md`

- [ ] **Step 1: Read all source files and current CONTRIBUTING.md**

```bash
cat CONTRIBUTING.md
cat docs/GIT_WORKFLOW.md
cat docs/MERGE_STRATEGY.md
cat docs/WEB_DEBUGGING.md
cat docs/FIREBASE_FUNCTIONS_TESTING.md
```

- [ ] **Step 2: Add a "Development Guides" section to CONTRIBUTING.md**

Find the existing CONTRIBUTING.md section on git workflow (currently a link to `docs/GIT_WORKFLOW.md`) and replace it with full inlined content. Add new sections for merge strategy, web debugging, and functions testing. The result should look like:

```markdown
## Git Workflow & Branching

[full content from GIT_WORKFLOW.md — two-branch model, feature branch start, merge commit why, sync procedure]

## Merge Strategy: Promoting Code

[full content from MERGE_STRATEGY.md — staging→main promotion, why merge commits only, step-by-step]

## Web Debugging

[full content from WEB_DEBUGGING.md — Chrome devtools setup, React Query devtools, common issues]

## Firebase Functions Testing

[full content from FIREBASE_FUNCTIONS_TESTING.md — local emulator setup, running callable tests, gotchas]
```

- [ ] **Step 3: Remove the old link to docs/GIT_WORKFLOW.md from CONTRIBUTING.md**

Search for `docs/GIT_WORKFLOW.md` in CONTRIBUTING.md and remove/replace any reference that now points to deleted content.

```bash
grep -n "GIT_WORKFLOW\|MERGE_STRATEGY\|WEB_DEBUGGING\|FIREBASE_FUNCTIONS_TESTING" CONTRIBUTING.md
```

- [ ] **Step 4: Delete source files**

```bash
git rm docs/GIT_WORKFLOW.md docs/MERGE_STRATEGY.md docs/WEB_DEBUGGING.md docs/FIREBASE_FUNCTIONS_TESTING.md
```

- [ ] **Step 5: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: absorb contributor workflow guides into CONTRIBUTING.md"
```

---

### Task 8: Delete Library Rehash Files + Extract Env Vars to README

**Files:**
- Modify: `README.md`
- Delete: `docs/FIREBASE_SETUP.md`, `docs/FIREBASE_FUNCTIONS.md`, `docs/EXPO_UPDATES.md`, `docs/PAYMENT_API.md`

- [ ] **Step 1: Read library rehash files, identify Clanker-specific content**

```bash
cat docs/FIREBASE_SETUP.md
cat docs/FIREBASE_FUNCTIONS.md
cat docs/EXPO_UPDATES.md
cat docs/PAYMENT_API.md
cat README.md
```

Look specifically for:
- Environment variable names that are Clanker-specific (e.g., `GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICE_INFO_PLIST`, EAS secret names)
- Any non-obvious Clanker configuration choices that differ from the Firebase/Expo/Stripe defaults
- Callable function names defined in `functions/` (from FIREBASE_FUNCTIONS.md) — these belong in `ai-and-chat.md` or `admin-operations.md` if not already there

- [ ] **Step 2: Add "Environment Variables" section to README.md**

In README.md, add a section (after existing setup instructions or before Contributing) listing only the Clanker-specific env vars and secrets extracted from the deleted files:

```markdown
## Environment Variables & Secrets

For Firebase config files required by EAS builds and local development:
- `GOOGLE_SERVICES_JSON` — base64-encoded `google-services.json` (Android)
- `GOOGLE_SERVICE_INFO_PLIST` — base64-encoded `GoogleService-Info.plist` (iOS)

See the [Firebase documentation](https://firebase.google.com/docs/projects/learn-more) for generating these files from the Firebase console. Upload them as EAS file secrets via `eas secret:create`.

For Stripe/RevenueCat, see [billing-and-credits.md](docs/billing-and-credits.md).
```

Only include env vars that are actually present in the deleted files. Do not invent ones.

- [ ] **Step 3: Check if FIREBASE_FUNCTIONS.md lists any callables not yet documented**

```bash
grep -E "(callable|function|exports)" docs/FIREBASE_FUNCTIONS.md | head -40
```

If any callable functions are listed that are NOT yet covered in `ai-and-chat.md`, `admin-operations.md`, or `architecture-and-data.md`, add them to the appropriate file before deleting.

- [ ] **Step 4: Delete the library rehash files**

```bash
git rm docs/FIREBASE_SETUP.md docs/FIREBASE_FUNCTIONS.md docs/EXPO_UPDATES.md docs/PAYMENT_API.md
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: delete library-rehash files, extract env vars to README"
```

---

### Task 9: Fix All Cross-References

**Files:**
- Scan all remaining docs and source files for broken links

- [ ] **Step 1: Find all references to deleted files**

```bash
grep -r "AUTH_FLOW\|AUTH_CACHE\|AUTH_PROVIDER\|AUTH_SOURCE\|BOOTSTRAP_EVENT\|COOKIE_CONSENT\|OPTIMISTIC_TERMS\|CHAT_MEMORY\|CHAT_RESPONSE\|IMAGE_GENERATION\|LLM_WIKI\|WIKI_ARCHITECTURE\|PAYMENT_INTEGRATION\|FIRST_LOGIN\|APPLE_SUBSCRIPTION\|CHECKOUT_MULTI\|ADMIN_DASHBOARD\|ADMIN_FUNCTIONS\|ADMIN_RUNBOOK\|CLOUD_SQL_DESIGN\|CLOUD_SQL_MIGRATIONS\|MIGRATION_OFFLINE\|NAVIGATION\|CLOUD_CHARACTER\|AVATAR_GALLERY\|SUPPORT_PAGE\|CALLABLE_ERROR\|GIT_WORKFLOW\|MERGE_STRATEGY\|WEB_DEBUGGING\|FIREBASE_FUNCTIONS_TESTING\|FIREBASE_SETUP\|FIREBASE_FUNCTIONS\|EXPO_UPDATES\|PAYMENT_API" --include="*.md" .
```

- [ ] **Step 2: Bulk-replace references with sed**

Run these in order (macOS `sed` requires `-i ''`):

```bash
# Auth files
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/AUTH_FLOW\.md|docs/authentication.md|g' \
    -e 's|docs/AUTH_CACHE_MANAGEMENT\.md|docs/authentication.md|g' \
    -e 's|docs/AUTH_PROVIDER_NAME_SYNC\.md|docs/authentication.md|g' \
    -e 's|docs/AUTH_SOURCE_OF_TRUTH\.md|docs/authentication.md|g' \
    -e 's|docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH\.md|docs/authentication.md|g' \
    -e 's|docs/COOKIE_CONSENT\.md|docs/authentication.md|g' \
    -e 's|docs/OPTIMISTIC_TERMS_ACCEPTANCE\.md|docs/authentication.md|g' \
  {} +

# AI/chat files
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/CHAT_MEMORY_SUMMARIZATION\.md|docs/ai-and-chat.md|g' \
    -e 's|docs/CHAT_RESPONSE_FUNCTION\.md|docs/ai-and-chat.md|g' \
    -e 's|docs/IMAGE_GENERATION_FUNCTION\.md|docs/ai-and-chat.md|g' \
    -e 's|docs/IMAGE_GENERATION\.md|docs/ai-and-chat.md|g' \
    -e 's|docs/LLM_WIKI_MEMORY\.md|docs/ai-and-chat.md|g' \
    -e 's|docs/WIKI_ARCHITECTURE\.md|docs/ai-and-chat.md|g' \
  {} +

# Billing files
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/PAYMENT_INTEGRATION\.md|docs/billing-and-credits.md|g' \
    -e 's|docs/FIRST_LOGIN_CREDITS\.md|docs/billing-and-credits.md|g' \
    -e 's|docs/APPLE_SUBSCRIPTION_CONSENT\.md|docs/billing-and-credits.md|g' \
    -e 's|docs/CHECKOUT_MULTI_TAB_SYNC\.md|docs/billing-and-credits.md|g' \
  {} +

# Admin files
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/ADMIN_DASHBOARD\.md|docs/admin-operations.md|g' \
    -e 's|docs/ADMIN_FUNCTIONS\.md|docs/admin-operations.md|g' \
    -e 's|docs/ADMIN_RUNBOOK\.md|docs/admin-operations.md|g' \
  {} +

# Architecture files
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/CLOUD_SQL_DESIGN\.md|docs/architecture-and-data.md|g' \
    -e 's|docs/CLOUD_SQL_MIGRATIONS\.md|docs/architecture-and-data.md|g' \
    -e 's|docs/STATE_MANAGEMENT\.md|docs/architecture-and-data.md|g' \
    -e 's|docs/MIGRATION_OFFLINE\.md|docs/architecture-and-data.md|g' \
    -e 's|docs/NAVIGATION\.md|docs/architecture-and-data.md|g' \
    -e 's|docs/CLOUD_CHARACTER_SAVE_SHARE\.md|docs/architecture-and-data.md|g' \
  {} +

# Contributor + misc
find . -type f -name "*.md" -not -path "./node_modules/*" \
  -exec sed -i '' \
    -e 's|docs/GIT_WORKFLOW\.md|CONTRIBUTING.md|g' \
    -e 's|docs/MERGE_STRATEGY\.md|CONTRIBUTING.md|g' \
    -e 's|docs/WEB_DEBUGGING\.md|CONTRIBUTING.md|g' \
    -e 's|docs/FIREBASE_FUNCTIONS_TESTING\.md|CONTRIBUTING.md|g' \
    -e 's|docs/FIREBASE_SETUP\.md|README.md|g' \
    -e 's|docs/CALLABLE_ERROR_NORMALIZATION\.md|docs/adrs/001-callable-error-normalization.md|g' \
  {} +
```

- [ ] **Step 3: Verify no stale references remain**

After sed runs, confirm output is empty:

```bash
grep -r "docs/AUTH_\|docs/CHAT_\|docs/IMAGE_GENERATION\|docs/LLM_WIKI\|docs/WIKI_ARCH\|docs/PAYMENT_INTEGRATION\|docs/FIRST_LOGIN\|docs/APPLE_SUB\|docs/CHECKOUT_MULTI\|docs/ADMIN_\|docs/CLOUD_SQL\|docs/STATE_MANAGEMENT\|docs/MIGRATION_OFFLINE\|docs/NAVIGATION\.md\|docs/CLOUD_CHARACTER\|docs/GIT_WORKFLOW\|docs/MERGE_STRATEGY\|docs/WEB_DEBUG\|docs/FIREBASE_FUNCTIONS_TESTING\|docs/FIREBASE_SETUP\|docs/CALLABLE_ERROR" \
  --include="*.md" --exclude-dir=node_modules .
```

- [ ] **Step 4: Manual check for references that sed missed**

`sed` only caught `docs/` prefixed links. Check bare filenames too:

For each hit, update the link to point to the new consolidated file:

| Old path | New path |
|----------|----------|
| `docs/AUTH_*.md` | `docs/authentication.md` |
| `docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH.md` | `docs/authentication.md` |
| `docs/COOKIE_CONSENT.md` | `docs/authentication.md` |
| `docs/OPTIMISTIC_TERMS_ACCEPTANCE.md` | `docs/authentication.md` |
| `docs/CHAT_*.md` | `docs/ai-and-chat.md` |
| `docs/IMAGE_GENERATION*.md` | `docs/ai-and-chat.md` |
| `docs/LLM_WIKI_MEMORY.md` | `docs/ai-and-chat.md` |
| `docs/WIKI_ARCHITECTURE.md` | `docs/ai-and-chat.md` |
| `docs/PAYMENT_INTEGRATION.md` | `docs/billing-and-credits.md` |
| `docs/FIRST_LOGIN_CREDITS.md` | `docs/billing-and-credits.md` |
| `docs/APPLE_SUBSCRIPTION_CONSENT.md` | `docs/billing-and-credits.md` |
| `docs/CHECKOUT_MULTI_TAB_SYNC.md` | `docs/billing-and-credits.md` |
| `docs/ADMIN_*.md` | `docs/admin-operations.md` |
| `docs/CLOUD_SQL_*.md` | `docs/architecture-and-data.md` |
| `docs/STATE_MANAGEMENT.md` | `docs/architecture-and-data.md` |
| `docs/MIGRATION_OFFLINE.md` | `docs/architecture-and-data.md` |
| `docs/NAVIGATION.md` | `docs/architecture-and-data.md` |
| `docs/CLOUD_CHARACTER_SAVE_SHARE.md` | `docs/architecture-and-data.md` |
| `docs/CALLABLE_ERROR_NORMALIZATION.md` | `docs/adrs/001-callable-error-normalization.md` |
| `docs/GIT_WORKFLOW.md` | `CONTRIBUTING.md` |
| `docs/MERGE_STRATEGY.md` | `CONTRIBUTING.md` |
| `docs/WEB_DEBUGGING.md` | `CONTRIBUTING.md` |
| `docs/FIREBASE_FUNCTIONS_TESTING.md` | `CONTRIBUTING.md` |
| `docs/FIREBASE_SETUP.md` | `README.md` |
| `docs/PAYMENT_API.md` | Stripe docs URL |

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: update cross-references to point to consolidated files"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Confirm target structure**

```bash
ls docs/*.md docs/adrs/*.md
# Expected: accessibility.md, admin-operations.md, ai-and-chat.md,
#           architecture-and-data.md, authentication.md, billing-and-credits.md
#           adrs/001-callable-error-normalization.md
```

- [ ] **Step 2: Confirm no broken links remain**

```bash
grep -r "docs/AUTH_\|docs/CHAT_\|docs/ADMIN_\|docs/CLOUD_SQL\|docs/PAYMENT_\|docs/GIT_WORKFLOW\|docs/MERGE_STRATEGY\|docs/FIREBASE_SETUP\|docs/EXPO_UPDATES" --include="*.md" .
# Expected: no output
```

- [ ] **Step 3: Confirm all new consolidated files have content**

```bash
for f in docs/authentication.md docs/ai-and-chat.md docs/billing-and-credits.md docs/admin-operations.md docs/architecture-and-data.md docs/adrs/001-callable-error-normalization.md; do
  echo "=== $f: $(wc -l < $f) lines ==="
done
```

Each file should have at least 50 lines (if any is nearly empty, the merge was incomplete).

- [ ] **Step 4: Commit if clean**

```bash
git status
# If any stragglers, git rm them; otherwise:
git commit --allow-empty -m "docs: consolidation complete — 40+ files → 6 domain docs + ADRs"
```

---

## Self-Review

**Spec coverage:**
- ✅ Delete library rehashes (FIREBASE_SETUP, FIREBASE_FUNCTIONS, EXPO_UPDATES, PAYMENT_API) → Task 8
- ✅ Consolidate auth files → Task 2
- ✅ Consolidate AI/chat files → Task 3
- ✅ Consolidate billing files → Task 4
- ✅ Consolidate admin files → Task 5
- ✅ Consolidate architecture files → Task 6
- ✅ Move contributor guides to CONTRIBUTING.md → Task 7
- ✅ ADRs for engineering decisions → Task 1
- ✅ Cross-references updated → Task 9
- ✅ Final verification → Task 10

**Placeholder scan:** No TBD/TODO present in steps. Each step has concrete bash commands.

**Type consistency:** N/A — docs-only migration, no code types.
