# Spec: Upgrade @equationalapplications/expo-llm-wiki + Hooks-First Refactor

**Date:** 2026-05-04
**Status:** Implemented
**Branch:** feature/upgrade-expo-llm-wiki

---

## Background

Clanker integrates `@equationalapplications/expo-llm-wiki` v2.4.0 for local wiki memory. The package now provides comprehensive React hooks (`useMemoryRead`, `useWikiWrite`, `useWikiMaintenance`, etc.) that offer better lifecycle management, centralized error/loading state, and context integration compared to direct service-layer `wiki.*()` method calls.

This upgrade bumps to v2.5.0 and refactors all wiki access to use React hooks *everywhere* (except service-layer setup code), improving long-term maintainability and consistency.

## Goals

- Bump `@equationalapplications/expo-llm-wiki` from `^2.4.0` to `^2.5.0`.
- **Architectural shift:** Prefer React hooks over raw `wiki.*()` method calls in all components and UI logic.
- Move memory reads out of `aiChatService.ts` into `useAIChat.ts`: call `wiki.read()` via `useWiki()` pre-turn, format with `formatContext()`, pass the resulting `memoryBlock` string down to the service.
- Move memory writes out of `aiChatService.ts`: pass an `onWriteObservation` callback from `useAIChat.ts` (backed by `useWikiWrite()`) so the service triggers the write without importing wiki hooks.
- Replace `wiki.runPrune()` / `wiki.runLibrarian()` / `wiki.runHeal()` with `useWikiMaintenance()`.
- Refactor cloud sync flows (`characterSyncService.ts`, edit screen) to use `useWikiExport()` and `useWikiMaintenance()` where UI-driven or extract to custom hooks.
- Keep `createWiki(...)` and `wiki.setup()` in the service layer (non-React context; raw methods acceptable here).
- Verify package v2.5.0 compatibility and all tests pass.

## Scope

### Included

- Dependency bump to v2.5.0.
- Refactor chat message context reading: `useAIChat.ts` calls `wiki.read()` via `useWiki()` pre-turn and passes the formatted `memoryBlock` to `aiChatService.ts` (which no longer reads memory directly).
- Refactor post-turn memory writes: `useAIChat.ts` passes an `onWriteObservation` callback (backed by `useWikiWrite()`) to `aiChatService.ts` so the service never imports wiki hooks.
- Refactor sync operations: `useWikiMaintenance().runPrune()` in appropriate contexts.
- Use `useWikiExport()` for cloud sync flows where architecturally sound.
- Ensure all component memory access uses hooks from `WikiProvider` context.
- Testing the upgrade with new hook-based patterns.

### Excluded

- Changing how `characters.context` rolling summary works (separate from wiki memory).
- Large data migration or schema refactoring.
- New wiki UI screens or management interfaces.
- Service-layer setup code (`wikiService.ts`, `wiki.setup()` startup) — raw methods fine there.

## Integration touchpoints

### Service layer (raw methods acceptable — non-React context)

- `src/services/wikiService.ts`
  - `createWiki(db, { llmProvider: ..., config: ... })`
  - `wiki.setup()` startup
  - Export `getWiki()` singleton for hook access
  
### UI layer (hooks required)

- `src/services/aiChatService.ts`
  - **Refactored:** No longer reads or writes wiki directly. Accepts `memoryBlock?: string` (pre-formatted by caller) and `onWriteObservation?` callback (supplied by caller) via the options argument.
  
- `src/hooks/useAIChat.ts` (React context — hooks used here)
  - Pre-turn: calls `wiki.read(characterId, userMessage.text)` via `useWiki()`, formats result with `formatContext()`, passes `memoryBlock` to `sendMessageWithAIResponse`.
  - Post-turn: passes `onWriteObservation` callback backed by `useWikiWrite()` to `sendMessageWithAIResponse` for fire-and-forget observation writes.

- `src/components/ChatView.tsx` (or caller)
  - Memory reading is done in `useAIChat.ts` (via `useWiki()` + `wiki.read()`), not in `ChatView` directly.
  - `ChatView` uses `useWiki()` for entity-status polling (ingesting/librarian indicators).
  
- `src/services/characterSyncService.ts` (background sync)
  - **Currently:** `wiki.exportDump([char.id])` + `wiki.importDump(...)` + `wiki.runPrune(...)` → Extract sync logic into a custom hook or refactor to use `useWikiExport()` + `useWikiMaintenance()` when called from a React context. For non-React background intervals, raw methods acceptable.
  
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx` (manual cloud sync button)
  - **Currently:** `exportWiki([id])` + `wikiSync({ dump: ... })` + `wiki.importDump(...)` + `wiki.runPrune(...)` → Refactor to use `useWikiExport()`, `useWikiMaintenance()` for centralized error/loading state.
  - Button press handler calls `exportWiki()` hook → `wikiSync()` → `importDump()` + `runPrune()` via maintenance hook.
  
- `src/components/ChatComposer.tsx`
  - Keep `useWikiIngest()`, `useWikiHasChanged()`, `useWikiForget()` (already hooks).
  - No changes needed.

- `app/_layout.tsx`
  - Keep `WikiProvider wiki={wiki}` mount at root (no change).

### Hook availability check

**Always available in components under `WikiProvider`:**
- `useWiki()` — access wiki instance directly (used in `useAIChat.ts` for `wiki.read()` pre-turn and in `ChatView` for entity-status polling)
- `useWikiWrite()` — fire-and-forget or awaited memory writes (used in `useAIChat.ts` for post-turn observation writes)
- `useWikiMaintenance()` — `runLibrarian()`, `runHeal()`, `runPrune()` with shared loading/error state
- `useWikiIngest()` — document ingestion (already in use)
- `useWikiHasChanged()` — skip-unchanged-file check (already in use)
- `useWikiForget()` — forget specific facts/tasks (already in use)
- `useWikiExport()` — export dumps for cloud sync (used in `useCharacterWikiSync`)

Note: `useMemoryRead()` is available from the package but not used in this implementation; `useWiki()` + `wiki.read()` is used directly in `useAIChat.ts` for fine-grained error handling and format control.

## Risk areas

- Package API surface changed between `2.4.0` and `2.5.0`.
- Hook signatures or context behavior changed.
- `WikiProvider` mount point or context depth affects hook availability.
- `useWiki()`, `useWikiWrite()`, `useWikiMaintenance()` error handling or loading state semantics differ.
- Service-layer `wiki.setup()` or `getWiki()` singleton pattern altered.

## Implementation decision: Hooks vs. raw methods by context

- **React components (UI-driven):** Use hooks exclusively. Edit screen sync uses `useWikiExport()` + `useWikiMaintenance()` for consistent error/loading state.
- **Service layer (non-React, background):** Raw methods acceptable. `characterSyncService.ts` background sync uses `wiki.runPrune()` directly since it's not in React context and has its own error handling via `WikiBusyError` catch.
- **Hook creation:** `useCharacterWikiSync()` in `src/hooks/useCharacterWiki.ts` wraps the sync flow for UI use. Background sync reuses raw methods.
- **Escape hatch:** `useWiki()` available if a hook genuinely can't express the pattern needed, but prefer specialized hooks.

**Phase 1: Verify compatibility**
- Update package version.
- Run `npm install` and `npm run typecheck`.
- Confirm no import or API signature breakage.

**Phase 2: Move memory reads into hooks**
- Moved `getWiki()?.read(...)` from `aiChatService.ts` into `useAIChat.ts`.
- `useAIChat.ts` calls `wiki.read(characterId, userMessage.text)` via `useWiki()`, wraps in try/catch, formats with `formatContext()`, and passes `memoryBlock` string to the service.

**Phase 3: Move memory writes into hooks**
- Moved `wiki.write()` post-turn call from `aiChatService.ts` into `useAIChat.ts`.
- `useAIChat.ts` passes an `onWriteObservation` callback backed by `useWikiWrite()` to the service; the service invokes it fire-and-forget (wrapped in try/catch) without needing to import wiki hooks.

**Phase 4: Refactor sync operations**
- Extract `characterSyncService.ts` sync logic into a custom hook if called from React (or leave raw if background-only).
- Edit screen cloud sync button: use `useWikiExport()` + `useWikiMaintenance()` with loading/error UI feedback.
- Ensure `runPrune()` completes before declaring sync "done."

**Phase 5: Test and verify**
- Run `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand`.
- Verify chat memory reads display correctly.
- Verify cloud sync completes without errors.
- No custom DB layer introduced.

## Acceptance criteria

- `package.json` and `package-lock.json` reference `^2.5.0`.
- `npm install` completes successfully.
- CHANGELOG reviewed; no breaking changes detected in `2.5.0` that affect current integration points.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand` passes.
- **Edit screen uses hooks:** `useWikiExport()` + `useWikiMaintenance()` with proper error/loading UI feedback. ✓
- **Custom hook created:** `useCharacterWikiSync()` encapsulates the full sync flow for UI reuse. ✓
- **No raw method calls in React components** for wiki operations (except service setup code). ✓
- Background sync in service layer uses raw methods with `WikiBusyError` handling.
- `WikiProvider` mounts once at app root; all hooks access wiki via context.
- No new custom database layer.
- Chat memory reads render correctly and reflect recent facts.
- Cloud sync button shows loading state and success/error feedback. ✓

## Verification steps

1. Update dependency version in `package.json` and `package-lock.json`.
2. Run `npm install`.
3. Check `node_modules/@equationalapplications/expo-llm-wiki/CHANGELOG.md` for breaking changes between `2.4.0` and `2.5.0`.
4. Run `npm run typecheck` — verify no import or signature mismatches.
5. Refactor memory reads: Moved `getWiki()?.read(...)` calls from `aiChatService.ts` into `useAIChat.ts` using `useWiki()` + `wiki.read()` + `formatContext()`.
6. Refactor memory writes: Moved `wiki.write(...)` from `aiChatService.ts` into `useAIChat.ts` via `useWikiWrite()` callback.
7. Refactor maintenance: Replace `wiki.runPrune()` with `useWikiMaintenance().runPrune()` in sync flows.
8. Refactor cloud sync: Use `useWikiExport()` + `useWikiMaintenance()` in edit screen and auto-sync.
9. Run `npm run lint` — verify code style.
10. Run `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand` — all tests pass.
11. Manual verification: Premium character chat loads, displays recent facts in context, cloud sync completes without errors.

---

## Notes

- **Hooks-first principle:** All UI code must use React hooks from `WikiProvider` context. Raw `wiki.*()` method calls only acceptable in non-React service-layer code (setup, singletons).
- The implementation uses `useWiki()` + `wiki.read()` in `useAIChat.ts` for pre-turn memory reads (rather than `useMemoryRead`) to retain fine-grained error handling and format control. Both approaches are valid — `useMemoryRead` is an alternative if caller-controlled error/loading state is preferred.
- `formatContext(...)` utility function is a pure helper — called in `useAIChat.ts` after `wiki.read()` to convert the bundle to a string for LLM injection.
- `characters.context` rolling summary is separate from wiki memory; no changes to that flow.
- Custom hooks (e.g., `useWikiMemoryContext`, `useCharacterWikiSync`) may be created to encapsulate repeated patterns, but they must themselves use the exported package hooks.
