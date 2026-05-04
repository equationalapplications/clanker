# Spec: Upgrade @equationalapplications/expo-llm-wiki

**Date:** 2026-05-04
**Status:** Draft
**Branch:** feature/upgrade-expo-llm-wiki

---

## Background

Clanker already integrates `@equationalapplications/expo-llm-wiki` for local wiki memory and React hooks. The current app dependency is `^2.4.0`, and the package registry latest version is `2.5.0`.

This upgrade should preserve the existing package-driven memory model and sync logic while moving to the newer package release.

## Goals

- Bump `@equationalapplications/expo-llm-wiki` from `^2.4.0` to `^2.5.0` in `package.json` and `package-lock.json`.
- Confirm the new package version is compatible with current app code, especially:
  - `createWiki(...)`
  - `WikiProvider`
  - `getWiki().read(...)`
  - `getWiki().write(...)`
  - `wiki.exportDump(...)` / `wiki.importDump(...)`
  - `wiki.runPrune(...)`
  - `useWikiIngest()` / `useWikiHasChanged()` / `useWikiForget()`
  - `formatContext(...)`
- Keep existing `characters.context` summary flow intact.
- Avoid introducing any separate custom memory DB; manual query code is acceptable only when it is the package API using expo-llm-wiki.
- Verify the app continues to use the package as the source of truth for local wiki memory.

## Scope

### Included

- Dependency bump only.
- Compatibility validation across the current package integration points.
- Testing the package upgrade with existing local and cloud sync flows.
- Confirming no new custom DB or memory store is introduced.

### Excluded

- Large refactor of wiki data architecture.
- Changing how `characters.context` or the last-ten-message summary works.
- Adding new wiki UI screens.
- Migrating old custom wiki schema data.

## Integration touchpoints

The upgrade should verify the following files and flows:

- `src/services/wikiService.ts`
  - `createWiki(db, { llmProvider: ..., config: ... })`
  - `wiki.setup()` startup path
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx`
  - cloud sync via `exportWiki` / `wikiSync` / `importDump`
- `src/services/characterSyncService.ts`
  - periodic cloud sync via `wiki.exportDump()` / `wiki.importDump()` / `wiki.runPrune()`
- `src/services/aiChatService.ts`
  - in-turn memory read via `getWiki()?.read(...)`
  - post-turn memory write via `wiki.write(...)`
  - formatting with `formatContext(...)`
- `src/components/ChatComposer.tsx`
  - document ingestion with `useWikiIngest()` / `useWikiHasChanged()` / `useWikiForget()`
- `app/_layout.tsx`
  - `WikiProvider wiki={wiki}` mount

## Risk areas

- Package API surface changed between `2.4.0` and `2.5.0`.
- `WikiProvider` import path or hook exports changed.
- `formatContext` signature or `read()` bundle shape changed.
- Cloud sync paths that use `middleware` / custom dump remix may need one-line updates.

## Acceptance criteria

- `package.json` and `package-lock.json` reference `^2.5.0`.
- `npm install` completes successfully.
- CHANGELOG reviewed; no breaking changes detected in `2.5.0` that affect current integration points.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand` passes.
- The app still mounts `WikiProvider` once at root and continues to use package APIs for memory and ingest.
- No new custom database layer appears in the upgrade.

## Verification steps

1. Update dependency version in `package.json` and `package-lock.json`.
2. Run `npm install`.
3. Check the package CHANGELOG in `node_modules/@equationalapplications/expo-llm-wiki/CHANGELOG.md` for breaking changes between `2.4.0` and `2.5.0`.
4. Run `npm run typecheck`.
5. Run `npm run lint`.
6. Run `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand`.

---

## Notes

- The package README confirms the intended integration pattern: `createWiki(...)`, `wiki.setup()`, `WikiProvider`, `useMemoryRead`, and `formatContext`.
- Existing manual package-driven operations are acceptable. The main concern is only to keep them under `expo-llm-wiki`, not a separate custom database.
