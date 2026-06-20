# Spec: Document Upload Reliability Hardening

Date: 2026-06-20
Status: Approved
Branch: fix/doc-uploads

## Problem

A code review of the document-upload phase-feedback work (`docs/superpowers/specs/2026-06-20-document-upload-progress-feedback-design.md`) raised several reliability concerns about the underlying upload/conversion pipeline (`ChatComposer` → `convertDocumentText` Cloud Function → Gemini). Triage against the actual code:

1. **Confirmed live bug:** `convertDocumentText` (`functions/src/convertDocumentText.ts`) sets no `timeoutSeconds`, so it defaults to 60s (2nd-gen Cloud Functions). The conversion call uses `maxOutputTokens: 65,536`, which can take Gemini well past 60s for large documents. If the platform kills the function instance on timeout, the function's `catch` block — which calls `creditService.refundCredit` — never runs. The user is charged a credit and never refunded, with no error surfaced.
2. **Real gap, no current mitigation:** the client never cancels or ignores a stale in-flight request. If `ChatComposer` unmounts mid-conversion (user navigates away) or a new pick somehow starts before the prior one resolves, the late-resolving promise can still call `setPhase`/toast/`ingest` against unmounted state or a no-longer-relevant flow.
3. **Real gap:** the picker accepts files of any size; the client reads the full file into memory via `readAsStringAsync` before the server's 9MB-equivalent size check ever runs, wasting memory and bandwidth on oversized files that are always going to be rejected.
4. **Already mitigated, not a bug:** reviewer flagged a concurrency race where picking a second file while one is in flight could clobber state. In the shipped code (`ChatComposer.tsx:204`), the plus-button `IconButton` is unconditionally replaced by a non-interactive spinner whenever `isIngesting || phase !== null`, so there is no way to trigger a second pick while one is in flight today. No fix needed; item 4 above (stale-response guard) is added as defense-in-depth anyway, since it's cheap and also covers the unmount case.
5. **Out of scope for this spec:** a credit-reservation system (reserve → commit/release, surviving instance kills the `catch` block itself can't reach) and a direct-to-storage upload architecture (signed URLs, GCS streaming, replacing the base64-over-callable contract) are both real, larger improvements. They are deferred to a separate follow-up spec — see Non-Goals.

## Goals

- Fix the credit-loss bug: failures during conversion always reach the existing refund path.
- Stop reading oversized files into memory client-side; fail fast with a toast before any read.
- Stale/late-resolving upload requests (from unmount or any other source) never mutate state or trigger toasts/ingest after they're no longer relevant.
- No changes to `wikiMachine.ts`, `useCharacterWiki.ts`, `@equationalapplications/core-llm-wiki`, or the `DocumentUploadPhase` UI added in the prior spec.

## Non-Goals

- Credit-reservation system (reserve/commit/release across instance kills/cold starts) — separate, larger change to `creditService`; deferred.
- Direct-to-storage upload (signed URL + GCS streaming, replacing the base64 callable payload) — separate architecture change; deferred to its own spec.
- True request cancellation (aborting the in-flight HTTP call). Firebase's `httpsCallable` client SDK has no `AbortSignal` option, only a `timeout` (ms) option. This spec uses a stale-response guard (ignore the result) instead of actually canceling the network call or the server-side work/credit spend.
- Any change to the concurrency guard — already correctly blocks re-entry via the spinner swap; not touched.

## Design

### 1. Cloud Function timeout & memory (`functions/src/convertDocumentText.ts`)

Add explicit config to the `onCall` options so the function has enough wall-clock time for slow Gemini conversions to finish and hit the existing `catch`/refund path normally, instead of being killed by the platform default:

```ts
export const convertDocumentText = onCall(
  {
    region: DEFAULT_REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => convertDocumentTextHandler(request),
);
```

`540` is the max `timeoutSeconds` for an `onCall` (HTTPS) 2nd-gen function. `memory` raised from the implicit default (256MiB) to 512MiB to comfortably hold a ~9MB base64 payload plus the Gemini SDK response buffer; the prior `generateEmbedding.ts` function uses an explicit `memory: "256MiB"` for a lighter workload, so 512MiB here is proportionate, not arbitrary.

### 2. Matching client-side callable timeout (`src/config/firebaseConfig.ts`, `src/config/firebaseConfig.web.ts`)

The Firebase callable client SDK defaults to a 70-second timeout independent of the server's `timeoutSeconds`. Raising only the server timeout without raising the client's means the client now gives up *before* the server would — the user sees a spurious failure (and, worse, no refund, since the server call may still succeed after the client stopped listening). Both config files change:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText', {
  timeout: 540_000,
})
```

Only this callable's timeout changes; every other `httpsCallable` call in both files is untouched.

### 3. Client-side file size pre-check (`src/components/documentMimeTypes.ts`, `ChatComposer.tsx`, `ChatComposer.web.tsx`)

New exported constant in `documentMimeTypes.ts`:

```ts
// Mirrors functions/src/convertDocumentText.ts's MAX_BASE64_LENGTH (12,000,000 base64
// chars ≈ 9,000,000 raw bytes). Kept in sync manually — functions/ and app src/ are
// separate deployables with no shared module between them.
export const MAX_DOCUMENT_RAW_BYTES = 9_000_000
```

In both `ChatComposer.tsx` and `ChatComposer.web.tsx`, immediately after the picker resolves to an asset and before `setPhase('reading')`/any read: if `asset.size` is a number and exceeds `MAX_DOCUMENT_RAW_BYTES`, show toast `"File too large."` (matching the server's existing error string for the same condition) and return — no phase transition happens at all, so the spinner never flashes for a pick that's guaranteed to fail. If `asset.size` is undefined (some pickers/platforms don't always populate it), skip the check and let the existing server-side validation catch it as today — no regression, just no early-exit optimization for that case.

### 4. Stale-response guard (`ChatComposer.tsx`, `ChatComposer.web.tsx`)

New `const requestIdRef = useRef(0)` alongside the existing `skipNextSubmitRef`. At the top of `handlePlusPress`, after a valid asset is picked: `const requestId = ++requestIdRef.current`. After every subsequent `await` in the function (read, convert, hash/`hasChanged`, `forget`, `ingest`), check `if (requestIdRef.current !== requestId) return` before doing anything else — including before any `setPhase`, toast, or the next step's call. A `useEffect` cleanup on unmount also increments `requestIdRef.current` (or a separate `mountedRef.current = false` checked alongside the id check) so any in-flight request silently no-ops on unmount.

This makes every step idempotent against staleness without touching the existing per-step try/catch/toast structure — it's purely an early-return guard inserted before each step's existing logic.

## Files Touched

**Modified**:
- `functions/src/convertDocumentText.ts` — `timeoutSeconds`, `memory` on the `onCall` export
- `src/config/firebaseConfig.ts`, `src/config/firebaseConfig.web.ts` — `timeout` option on `convertDocumentTextFn`
- `src/components/documentMimeTypes.ts` — new `MAX_DOCUMENT_RAW_BYTES` export
- `src/components/ChatComposer.tsx`, `src/components/ChatComposer.web.tsx` — size pre-check, `requestIdRef` staleness guard

**Unchanged**:
- `src/machines/wikiMachine.ts`, `src/hooks/useCharacterWiki.ts`, `@equationalapplications/core-llm-wiki`
- `DocumentUploadPhase` type, banner rendering in `ChatView.tsx`
- Plus-button spinner/concurrency-guard logic (already correct)

## Tests

- `functions/src/convertDocumentText.test.ts`: assert `convertDocumentText.__endpoint.timeoutSeconds === 540` and `convertDocumentText.__endpoint.availableMemoryMb` (or the equivalent field `firebase-functions` v2's `onCall` attaches to `__endpoint` for the `memory` option) matches 512MiB. No existing test in this codebase asserts `onCall` runtime config today, so this is a new, narrowly-scoped test — not a regression risk to existing tests.
- New test in `__tests__/firebaseConfigWebVoiceCallable.test.ts`-style module (or a new file) asserting `httpsCallable` is called with `('convertDocumentText', { timeout: 540_000 })` for both `firebaseConfig.ts` and `firebaseConfig.web.ts`.
- `ChatComposer.test.tsx` + web variant:
  - Picker resolves with `assets[0].size` above `MAX_DOCUMENT_RAW_BYTES` → toast `"File too large."`, `onPhaseChange` never called, `readAsStringAsync`/`fetch` never called.
  - Picker resolves with `assets[0].size` at or below the threshold → existing flow proceeds unchanged.
  - Picker resolves with `assets[0].size` undefined → existing flow proceeds unchanged (no early exit).
  - Stale-response guard: start a pick, then trigger unmount (or a second pick, simulating the id changing) before the in-flight promise resolves; assert that when the first promise resolves afterward, no `setPhase`, toast, or `ingest` call happens from it.
- Regression: existing ingest-success and ingest-error toast assertions in current test suites continue to pass unchanged.

## Acceptance Criteria

- [x] `convertDocumentText` Cloud Function has `timeoutSeconds: 540` and `memory: '512MiB'`
- [x] Client `convertDocumentTextFn` (both platforms) has matching `timeout: 540_000`
- [x] Files larger than `MAX_DOCUMENT_RAW_BYTES` are rejected client-side with a toast before any read, on both platforms
- [x] A stale (unmounted or superseded) upload request never calls `setPhase`, shows a toast, or calls `ingest` after it resolves
- [x] No changes to `wikiMachine.ts`, `useCharacterWiki.ts`, `EntityStatus`, or the existing phase-feedback UI from the prior spec
- [x] `npm run typecheck && npm run lint && npm run test` green at root
