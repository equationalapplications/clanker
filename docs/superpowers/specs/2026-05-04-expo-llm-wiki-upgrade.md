# Spec: Upgrade @equationalapplications/expo-llm-wiki + Hooks-First Refactor

**Date:** 2026-05-04
**Status:** Draft
**Branch:** feature/upgrade-expo-llm-wiki

---

## Background

Clanker integrates `@equationalapplications/expo-llm-wiki` v2.4.0 for local wiki memory. The package now provides comprehensive React hooks (`useMemoryRead`, `useWikiWrite`, `useWikiMaintenance`, etc.) that offer better lifecycle management, centralized error/loading state, and context integration compared to direct service-layer `wiki.*()` method calls.

This upgrade bumps to v2.5.0 and refactors all wiki access to use React hooks *everywhere* (except service-layer setup code), improving long-term maintainability and consistency.

## Goals

- Bump `@equationalapplications/expo-llm-wiki` from `^2.4.0` to `^2.5.0`.
- **Architectural shift:** Prefer React hooks over raw `wiki.*()` method calls in all components and UI logic.
- Replace `getWiki()?.read(...)` with `useMemoryRead()` in chat UI.
- Replace `wiki.write()` post-turn calls with `useWikiWrite()`.
- Replace `wiki.runPrune()` / `wiki.runLibrarian()` / `wiki.runHeal()` with `useWikiMaintenance()`.
- Refactor cloud sync flows (`characterSyncService.ts`, edit screen) to use `useWikiExport()` and `useWikiMaintenance()` where UI-driven or extract to custom hooks.
- Keep `createWiki(...)` and `wiki.setup()` in the service layer (non-React context; raw methods acceptable here).
- Verify package v2.5.0 compatibility and all tests pass.

## Scope

### Included

- Dependency bump to v2.5.0.
- Refactor chat message context reading: `aiChatService.ts` `useMemoryRead()` instead of `getWiki()?.read()`.
- Refactor post-turn memory writes: `useWikiWrite()` instead of `wiki.write()`.
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
  - **Currently:** `getWiki()?.read(character.id, userMessage.text)` → **Refactor to:** Extract into a custom hook or move memory read into the component that renders the chat context.
  - **Currently:** `wiki.write(character.id, { event_type: 'observation', summary: ... })` → **Refactor to:** Use `useWikiWrite()` in a component effect or custom hook wrapping chat submission.

- `src/components/ChatView.tsx` (or caller)
  - Add memory read via `useMemoryRead(characterId, userMessage)` to fetch bundle inline.
  - Format with `formatContext(bundle, ...)` for LLM injection.
  - Bind formatting result into the chat prompt.
  
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
- `useWiki()` — access wiki instance directly if needed
- `useMemoryRead(entityId, query)` — fetch facts/tasks/events for LLM context
- `useWikiWrite()` — fire-and-forget or awaited memory writes
- `useWikiMaintenance()` — `runLibrarian()`, `runHeal()`, `runPrune()` with shared loading/error state
- `useWikiIngest()` — document ingestion (already in use)
- `useWikiHasChanged()` — skip-unchanged-file check (already in use)
- `useWikiForget()` — forget specific facts/tasks (already in use)
- `useWikiExport()` — export dumps for cloud sync (replace direct `exportWiki` calls)

## Risk areas

- Package API surface changed between `2.4.0` and `2.5.0`.
- Hook signatures or context behavior changed.
- `WikiProvider` mount point or context depth affects hook availability.
- `useMemoryRead`, `useWikiWrite`, `useWikiMaintenance` error handling or loading state semantics differ.
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

**Phase 2: Move memory reads into UI**
- Identify where `aiChatService.ts` calls `getWiki()?.read(...)`.
- If called during message send or chat render, move into a component hook or custom effect.
- Use `useMemoryRead(characterId, userMessage)` to fetch bundle with proper loading/error states.

**Phase 3: Move memory writes into UI**
- Replace `wiki.write()` post-turn fire-and-forget with `useWikiWrite()`.
- Wrap in a `useEffect` that runs after AI response is saved.
- Handle `isPending` and `error` states gracefully.

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
5. Refactor memory reads: Move `getWiki()?.read(...)` calls from service to component hooks using `useMemoryRead()`.
6. Refactor memory writes: Replace `wiki.write(...)` with `useWikiWrite()` in effects/hooks.
7. Refactor maintenance: Replace `wiki.runPrune()` with `useWikiMaintenance().runPrune()` in sync flows.
8. Refactor cloud sync: Use `useWikiExport()` + `useWikiMaintenance()` in edit screen and auto-sync.
9. Run `npm run lint` — verify code style.
10. Run `npm test -- wikiService characterSyncWiki aiChatService chatComposer --runInBand` — all tests pass.
11. Manual verification: Premium character chat loads, displays recent facts in context, cloud sync completes without errors.

---

## Notes

- **Hooks-first principle:** All UI code must use React hooks from `WikiProvider` context. Raw `wiki.*()` method calls only acceptable in non-React service-layer code (setup, singletons).
- The package provides `useWiki()` as an escape hatch if hooks are insufficient, but prefer specialized hooks (`useMemoryRead`, `useWikiWrite`, etc.) for clarity and better state management.
- `formatContext(...)` utility function remains the same — used to format bundle output for LLM injection. Call from a component after `useMemoryRead()` fetches the bundle.
- `characters.context` rolling summary is separate from wiki memory; no changes to that flow.
- Custom hooks (e.g., `useWikiMemoryContext`, `useCharacterWikiSync`) may be created to encapsulate repeated patterns, but they must themselves use the exported package hooks.
