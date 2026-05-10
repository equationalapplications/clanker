# LLM Wiki Phase 3 - Wire Call Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all chat and sync call sites through the Phase 2 `wikiMachine`/`wikiOrchestrator` path and remove direct package-hook usage plus 5s status polling.

**Architecture:** Keep `wikiMachine` and `wikiOrchestrator` as the single execution path for read/write/ingest/forget/sync. Refactor hooks and components to consume one character-scoped API (`useCharacterWiki`), preserving existing UX while removing polling and scattered error handling.

**Tech Stack:** React Native (Expo), XState v5, React Query, `@equationalapplications/expo-llm-wiki@4.1.0`, Jest.

**Spec:** `docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md` (Phase 3 section).

---

## File Structure

**Modify**
- `src/hooks/useCharacterWiki.ts` - expose orchestrator-backed read/write/ingest/sync/forget API + status selectors.
- `src/hooks/useAIChat.ts` - replace direct `wiki.read`/`useWikiWrite` with `useCharacterWiki(characterId)`.
- `src/components/ChatView.tsx` - remove `setInterval` polling and bind status banner to hook status.
- `src/components/ChatComposer.tsx` - replace `useWikiIngest/useWikiHasChanged/useWikiForget` with `useCharacterWiki`.
- `src/services/characterSyncService.ts` - route per-character sync work through orchestrator actors.
- `__tests__/useAIChat.test.ts` (or nearest existing test file) - assert READ + WRITE routing through hook.
- `__tests__/ChatView.test.tsx` - assert banner reacts to pushed status without polling.
- `__tests__/ChatComposer.test.tsx` - assert ingest flow delegates through `useCharacterWiki`.
- `__tests__/characterSyncService.test.ts` - assert sync path uses orchestrator sync/serialization behavior.

**Verify / adjust if needed**
- `src/services/wikiOrchestrator.ts` - ensure API remains sufficient for call-site wiring.
- `src/machines/wikiMachine.ts` - only minimal changes if uncovered by wiring/tests (no Phase 4 scope creep).

---

### Task 1: Build the canonical `useCharacterWiki(entityId)` API

- [ ] Add a single hook return shape used by all call sites: `status`, `isBusy`, `error`, `read`, `write`, `ingest`, `forget`, `sync`.
- [ ] Internally bind `wikiOrchestrator.getOrSpawn(entityId, wiki)` once and use selectors for `context.status`, machine state, and `lastError`.
- [ ] Keep read/write/ingest/forget/sync semantics aligned with `wikiMachine` event contracts (`READ`, `WRITE`, `INGEST`, `FORGET`, `SYNC`).
- [ ] Preserve wrappers for backward compatibility only if still needed by consumers; otherwise remove dead exports in this phase.
- [ ] Ensure all errors continue to flow via machine + existing `reportError` behavior (no new `console.warn`).

### Task 2: Rewire `useAIChat` to the new hook

- [ ] Replace direct `useWiki` + `useWikiWrite` usage with `const characterWiki = useCharacterWiki(character.id)`.
- [ ] Pre-turn memory block: call `characterWiki.read(message.text)` and format with `formatContext`.
- [ ] Post-turn observation write: call `characterWiki.write(text)` as fire-and-forget.
- [ ] Maintain existing fail-soft behavior for busy/operational errors and keep message send UX unchanged.
- [ ] Keep subscription/credit gating behavior introduced in Phase 2b unchanged.

### Task 3: Remove polling from `ChatView` and bind live status

- [ ] Delete `useWiki`, `useEffect`, and `setInterval` polling logic.
- [ ] Use `useCharacterWiki(characterId).status` to drive the ingest/librarian banner.
- [ ] Keep the same status text UX and accessibility labels.
- [ ] Confirm banner updates from machine `STATUS` events without interval-driven re-renders.

### Task 4: Rewire `ChatComposer` ingest path

- [ ] Replace `useWikiIngest`, `useWikiHasChanged`, and `useWikiForget` hook usage with `useCharacterWiki(characterId)`.
- [ ] Keep current file picker, hash, and duplicate-detection behavior; only change operation dispatch path.
- [ ] Route forget-before-ingest through `characterWiki.forget(...)` and ingest through `characterWiki.ingest(...)`.
- [ ] Preserve busy-message behavior and current toast copy.

### Task 5: Route character cloud sync through machine/orchestrator

- [ ] Update `syncWikiForCloud` flow to use per-character machine/orchestrator sync instead of direct `wiki.exportDump/importDump/runPrune` calls.
- [ ] Preserve cloud ID remap logic and `wikiSync` callable contract.
- [ ] Maintain existing skip/fail-soft behavior for characters that are not cloud-linked.
- [ ] Keep concurrency behavior safe; do not expand into Phase 4a orchestration redesign beyond this wiring requirement.

### Task 6: Tests and regression coverage

- [ ] Add/adjust hook and component tests to assert no direct package hooks are called from rewired files.
- [ ] Add ChatView test proving no interval polling and status updates are selector-driven.
- [ ] Add useAIChat test proving READ happens before send and WRITE happens post-send via character hook.
- [ ] Add ChatComposer test proving ingest path delegates to character hook methods.
- [ ] Add/adjust characterSyncService tests proving orchestration-based sync path executes and handles failures fail-soft.

### Task 7: Verification and documentation touch-up

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] If behavior changes materially from spec wording, update `docs/LLM_WIKI_MEMORY.md` and/or the phase spec notes with concise implementation deltas.

---

## Execution Notes and Boundaries

- Keep scope strictly to Phase 3 wiring. Do not implement memory inspector UI (Phase 4b) or broad sync concurrency redesign (Phase 4a).
- Preserve existing user-facing copy and interaction patterns unless tests require a targeted fix.
- Prefer minimal adapter changes over modifying stable machine/orchestrator internals.
- Treat `WikiBusyError` as recoverable; avoid introducing new hard-failure paths.

---

## Suggested Commit Sequence

1. `refactor(wiki): expose orchestrator-backed useCharacterWiki API`
2. `refactor(chat): route ai chat memory through character wiki hook`
3. `refactor(chat): remove chatview wiki polling`
4. `refactor(chat): route composer ingest through character wiki hook`
5. `refactor(sync): route wiki cloud sync through orchestrator`
6. `test(wiki): add phase 3 wiring regression coverage`

