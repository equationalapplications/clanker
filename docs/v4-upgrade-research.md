# LLM Wiki v3 → v4.1.0 Upgrade: Research Findings

## Current State
- **Clanker current version**: @equationalapplications/expo-llm-wiki@^3.0.0
- **Target version**: @equationalapplications/expo-llm-wiki@4.1.0
- **Date**: 2026-05-09

## Research Method

### Commands Run

**Command 1: v4.1.0 Release Information**
```
$ gh release view v4.1.0 --repo equationalapplications/expo-llm-wiki
title:	v4.1.0
tag:	v4.1.0
draft:	false
prerelease:	false
immutable:	false
author:	github-actions[bot]
created:	2026-05-09T02:58:55Z
published:	2026-05-09T02:58:58Z
url:	https://github.com/equationalapplications/expo-llm-wiki/releases/tag/v4.1.0
--
# [4.1.0](https://github.com/equationalapplications/expo-llm-wiki/compare/v4.0.0...v4.1.0) (2026-05-09)

### Bug Fixes

* **core:** add context to status callback errors
* **core:** harden subscribeEntityStatus delivery
* **core:** notify entity status on manual librarian/heal
* **core:** preserve re-entrant status transitions in subscribeEntityStatus
* **core:** subscribeEntityStatus review — always initial, copy status

### Features

* **core:** add subscribeEntityStatus initial emission scaffold
* **core:** isolate listener errors and re-entrant subscribe/unsubscribe
* **core:** notify entity-status subscribers on auto-heal transitions
* **core:** notify entity-status subscribers on auto-librarian transitions
* **core:** notify entity-status subscribers on ingest transitions
```

**Command 2: v4.0.0 Release Information**
```
$ gh release view v4.0.0 --repo equationalapplications/expo-llm-wiki
title:	v4.0.0
tag:	v4.0.0
draft:	false
prerelease:	false
immutable:	false
author:	github-actions[bot]
created:	2026-05-09T00:01:40Z
published:	2026-05-09T00:01:43Z
url:	https://github.com/equationalapplications/expo-llm-wiki/releases/tag/v4.0.0
--
# [4.0.0](https://github.com/equationalapplications/expo-llm-wiki/compare/v3.2.0...v4.0.0) (2026-05-09)

* refactor(core)!: rename source_type enum values for clarity

### BREAKING CHANGES

* Existing databases use the old enum string values
and are incompatible without manual SQL migration. See migration
guide in docs/superpowers/specs/2026-05-08-source-type-rename-design.md.

Run to migrate (adjust tablePrefix if customized):
  UPDATE llm_wiki_entries SET source_type = 'immutable_document'
    WHERE source_type = 'user_document';
  UPDATE llm_wiki_entries SET source_type = 'librarian_inferred'
    WHERE source_type = 'agent_inferred';
```

**Findings**: Only v4.0.0 and v4.1.0 releases document v3→v4 breaking changes. No v3.x release notes are relevant to the upgrade path.

## Critical Breaking Changes (v3 → v4)

### Database Schema Migration Required (v4.0.0 Breaking Change)
**Impact: HIGH - Database compatibility breaking change**

From v4.0.0 release notes:

> **BREAKING CHANGES**: Existing databases use the old enum string values and are incompatible without manual SQL migration. See migration guide in docs/superpowers/specs/2026-05-08-source-type-rename-design.md.
>
> Run to migrate (adjust tablePrefix if customized):
> ```sql
> UPDATE llm_wiki_entries SET source_type = 'immutable_document'
>   WHERE source_type = 'user_document';
> UPDATE llm_wiki_entries SET source_type = 'librarian_inferred'
>   WHERE source_type = 'agent_inferred';
> ```

**Details**:
- `source_type` enum values renamed for clarity:
  - `'user_document'` → `'immutable_document'`
  - `'agent_inferred'` → `'librarian_inferred'`
- This breaks compatibility with all v3.x databases
- Commit: `refactor(core)!: rename source_type enum values for clarity`

## New Public Exports

### From v4.1.0
- `subscribeEntityStatus` - Subscribe to entity status transitions
  - **v4.1.0 Release Notes (verified from `gh release view` output)**:
    - Bug Fix: "harden subscribeEntityStatus delivery"
    - Bug Fix: "preserve re-entrant status transitions in subscribeEntityStatus"
    - Bug Fix: "add context to status callback errors"
    - Bug Fix: "subscribeEntityStatus review — always initial, copy status"
    - Feature: "isolate listener errors and re-entrant subscribe/unsubscribe"
    - Feature: "add subscribeEntityStatus initial emission scaffold"
    - Feature: "notify entity-status subscribers on [various transitions: ingest, auto-librarian, auto-heal, manual librarian/heal]"

## Clanker Symbol Compatibility Analysis

### All Clanker imports checked - Status: COMPATIBLE (no renames needed)

| Symbol | v3 Status | v4 Status | Notes |
|--------|-----------|-----------|-------|
| WikiProvider | ✓ | ✓ | No change |
| useWiki | ✓ | ✓ | No change |
| useMemoryRead | ✓ | ✓ | No change |
| useWikiWrite | ✓ | ✓ | No change |
| useWikiIngest | ✓ | ✓ | No change |
| useWikiForget | ✓ | ✓ | No change |
| useWikiExport | ✓ | ✓ | No change |
| useWikiMaintenance | ✓ | ✓ | No change |
| useWikiHasChanged | ✓ | ✓ | No change |
| WikiBusyError | ✓ | ✓ | Stable |
| formatContext | ✓ | ✓ | No change |
| MemoryDump (type) | ✓ | ✓ | No change |
| createWiki | ✓ | ✓ | No change |

**Conclusion**: No export renames or removals affecting Clanker. All imports remain valid.

## Phase 1 Deliverables: COMPLETE

- [x] Pulled v4.0.0 and v4.1.0 release notes via `gh release view`
- [x] Identified actual v3→v4 breaking changes (schema migration only)
- [x] Documented schema migration requirements with actual SQL from release notes
- [x] Verified no export renames affecting Clanker (13 symbols confirmed)
- [x] Consulted package README (no v3→v4 migration guidance found)
- [x] Removed unverifiable v3.x internal change claims

## Next Steps (Future Phases)

### Phase 2: Bump package.json dependency
- Update package.json: `^3.0.0` → `^4.1.0`
- Run `npm install`
- Verify installation and TypeScript compilation

### Phase 3: Handle breaking changes
- **Database schema migration**: Execute the source_type enum migration SQL on app launch
  - Coordinate with app startup to migrate existing databases before any wiki operations
  - Both old and new values may coexist temporarily; migration must complete before write operations resume
- **Testing**: Verify all wiki operations (read, write, delete, maintenance) work correctly post-migration
- Consider leveraging new `subscribeEntityStatus` for entity status UI indicators

### Phase 4: Leverage new features (optional/future)
- Evaluate new `subscribeEntityStatus` for real-time entity status monitoring

## Files Requiring Changes (identified for Phase 2+)

- `package.json` - Update version dependency
- Database initialization logic - Add schema migration for source_type enum rename

