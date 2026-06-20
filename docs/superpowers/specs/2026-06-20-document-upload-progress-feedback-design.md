# Spec: Document Upload Progress Feedback

Date: 2026-06-20
Status: Implemented
Branch: fix/doc-uploads

## Problem

The document-ingest pipeline (`ChatComposer` "+" button → picker → optional `convertDocumentText` → `hasChanged` → `forget` → `ingest`) gives the user no feedback until the very last step. The plus-button spinner and the `ChatView` top banner ("⏳ Ingesting document…") are both driven solely by `useCharacterWiki().isIngesting` / `status.ingesting`, which only becomes true once the final `ingest()` call starts. Picking a file, reading it, converting it (pdf/docx/image), and checking/removing a stale prior version all happen silently first — for a multi-second conversion call, the user sees nothing and then either a success/failure toast.

## Goals

- Spinner on the plus button starts the instant a file is picked, not just during the final `ingest()` call
- Top banner in `ChatView` shows a distinct, accessible message for each phase: reading the file, converting it (when applicable), checking for changes, removing a stale prior version, and (unchanged) ingesting
- Each phase that can fail gets its own toast message, so the user knows which step broke
- No changes to the shared wiki machine or `EntityStatus` shape — this is local UI state only

## Non-Goals

- Changing `wikiMachine.ts`, `useCharacterWiki.ts`, or `@equationalapplications/core-llm-wiki` — the existing `isIngesting`/`status.ingesting` mechanism for the final ingest phase is unchanged and untouched
- Progress percentage / byte-level upload progress — phase labels only, no progress bars
- Retrying failed steps automatically — toasts inform, they don't retry

## Design

### Type

`DocumentUploadPhase = 'reading' | 'converting' | 'checking' | 'forgetting' | null`, defined and exported directly from `ChatComposer.tsx` (and mirrored in `ChatComposer.web.tsx`) — no new shared file, to keep the file count down. `ChatView.tsx` imports the type from `~/components/ChatComposer`.

### `ChatComposer.tsx` / `ChatComposer.web.tsx`

- New local `const [phase, setPhase] = useState<DocumentUploadPhase>(null)`.
- New optional prop `onPhaseChange?: (phase: DocumentUploadPhase) => void`. Every local `setPhase(x)` call is paired with `onPhaseChange?.(x)` so `ChatView` mirrors composer-local state without new global/shared state.
- Plus-button render condition changes from `isIngesting ? <spinner> : <IconButton>` to `(isIngesting || phase !== null) ? <spinner> : <IconButton>`.
- `handlePlusPress` phase sequence:
  1. Picker resolves to an asset → `setPhase('reading')` (and mirror) before any file read.
  2. Read file bytes (text path or base64 path). On failure: toast `"Failed to read file."`, `setPhase(null)`, return.
  3. If mime type is in `CONVERT_MIME_TYPES` → `setPhase('converting')` before calling `convertDocumentText`. Existing per-`HttpsError`-code toast mapping (insufficient credits / file too large / generic) is unchanged; each of those early-return branches also calls `setPhase(null)` first.
  4. After `rawText` is available (whichever path) → `setPhase('checking')` before hashing (`Crypto.digestStringAsync`) and calling `hasChanged`. On failure (hash or `hasChanged` throws): toast `"Failed to check for changes."`, `setPhase(null)`, return. The existing "already up to date" early return also calls `setPhase(null)` first.
  5. If changed → `setPhase('forgetting')` before `forget({ sourceRef })`. On failure: toast `"Failed to remove previous version."`, `setPhase(null)`, return.
  6. Before calling `ingest(...)` → `setPhase(null)` (and mirror). From here, the existing `wikiStatus.ingesting`-driven banner line and `isIngesting`-driven spinner take over exactly as today — fully unchanged code path.
  7. The outer `catch` (existing `WikiBusyError` / JSON-parse-error / generic "Failed to ingest document." handling) additionally calls `setPhase(null)` first, covering any unexpected throw between steps that isn't already caught by the per-step handling above.

### `ChatView.tsx`

- New local `const [documentPhase, setDocumentPhase] = useState<DocumentUploadPhase>(null)`.
- `renderComposer` passes `onPhaseChange={setDocumentPhase}` into `<ChatComposer>` alongside the existing `characterId`/`userId` props; add `setDocumentPhase` is stable (from `useState`) so no new deps needed beyond what's already in the `useCallback` array.
- Banner visibility condition extends from `wikiStatus.ingesting || wikiStatus.librarian || escalationState === 'escalating'` to also include `documentPhase !== null`.
- Four new `Text` lines added inside the existing banner wrapper `View` (which already carries `accessibilityLiveRegion="polite"` and the web-only `accessibilityRole="status"`, per `docs/ACCESSIBILITY.md`'s documented Live Regions pattern — live-region/status props belong on the container, not per-line, and native `accessibilityRole="status"` support is explicitly called out there as inconsistent). New lines added inside that container are announced automatically on both platforms without per-line role/live-region props:
  - `documentPhase === 'reading'` → `"⏳ Reading file…"` (`accessibilityLabel="Reading file"`)
  - `documentPhase === 'converting'` → `"⏳ Converting document…"` (`accessibilityLabel="Converting document"`)
  - `documentPhase === 'checking'` → `"⏳ Checking for changes…"` (`accessibilityLabel="Checking for changes"`)
  - `documentPhase === 'forgetting'` → `"⏳ Removing previous version…"` (`accessibilityLabel="Removing previous version"`)
  - Existing `wikiStatus.ingesting` → `"⏳ Ingesting document…"` line is unchanged and unaffected.

### Error handling summary

| Step | Toast on failure |
|---|---|
| Read file | "Failed to read file." |
| Convert (pdf/docx/image) | existing per-code mapping (unchanged) |
| Check for changes (hash + `hasChanged`) | "Failed to check for changes." |
| Forget stale version | "Failed to remove previous version." |
| Ingest | existing (`WikiBusyError` / JSON-parse / generic) (unchanged) |

Every path — success, "already up to date", and every failure — resets `phase`/`documentPhase` to `null`, so the spinner and banner never get stuck.

## Files Touched

**Modified**:
- `src/components/ChatComposer.tsx` — phase state, `onPhaseChange` prop, per-step try/catch + toasts, spinner condition
- `src/components/ChatComposer.web.tsx` — same, mirrored for the web file-read path
- `src/components/ChatView.tsx` — `documentPhase` state, prop wiring in `renderComposer`, 4 new banner lines

**Unchanged**:
- `src/machines/wikiMachine.ts`, `src/hooks/useCharacterWiki.ts`, `@equationalapplications/core-llm-wiki` — final-ingest status mechanism untouched

## Tests

- `ChatComposer.test.tsx` (+ web variant): `onPhaseChange` fires `'reading'` synchronously right after picking a file (before any async read/convert resolves); fires `'converting'` only for pdf/docx/image mime types, not for `.txt`/`.md`; fires `'checking'` and `'forgetting'` at the right points; fires `null` before every toast (read/check/forget/convert/ingest failure paths) and on the "already up to date" early return; plus-button shows spinner once phase is non-null even before `isIngesting` becomes true.
- `ChatView` test: mock `ChatComposer` to synchronously invoke `onPhaseChange` with each phase value in turn, assert the corresponding banner `Text` (and `accessibilityLabel`) appears for each, and disappears when phase returns to `null` (and `wikiStatus.ingesting`/`librarian`/escalation are all falsy).
- Regression: existing ingest-success and ingest-error toast assertions in current test suites continue to pass unchanged.

## Acceptance Criteria

- [ ] Spinner on plus button appears immediately after a file is picked, not just during final ingest
- [ ] Top banner shows distinct text for reading/converting/checking/forgetting phases, each with correct `accessibilityLabel`, inside the existing live-region-announced container
- [ ] Each failure-prone step has its own toast message per the table above
- [ ] `phase`/`documentPhase` always resets to `null` on every exit path (success, no-op, every error)
- [ ] No changes to `wikiMachine.ts`, `useCharacterWiki.ts`, or `EntityStatus`
- [ ] `npm run typecheck && npm run lint && npm run test` green at root
