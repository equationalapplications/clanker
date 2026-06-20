# Spec: Cloud Document Format Conversion (PDF / DOCX / Image → Text)

Date: 2026-06-20
Status: Implemented
Branch: TBD (feature branch off `staging`)
Supersedes: [2026-04-28-document-ingest.md](./2026-04-28-document-ingest.md) (its `documentExtract` callable is dead code — see Cleanup)

## Problem

The document-ingest pipeline (`ChatComposer` "+" button → `expo-document-picker` → `useCharacterWiki().ingest`) already works end-to-end, but only for plain-text formats (`.txt`, `.md`). Extraction/fact-tagging is handled entirely by `@equationalapplications/core-llm-wiki`'s `ingestDocument` (via the `wikiLlm` server callable), which natively tags everything it ingests as `source_type: 'immutable_document'` — untouched by `runLibrarian`/`runHeal`. That part needs no changes.

What's missing: users can't upload PDFs, DOCX files, or photographed/scanned documents, because there's no step that turns binary formats into the plain text/markdown string the existing pipeline expects.

A previous spec ([2026-04-28-document-ingest.md](./2026-04-28-document-ingest.md)) added a `documentExtract` Firebase callable to solve a related but different problem (server-side *fact extraction*, pre-dating `core-llm-wiki`). The architecture moved on; `documentExtract` is registered (`functions/src/index.ts`, `firebaseConfig.ts`/`.web.ts`) but never called from any client code path. It is dead code.

## Goals

- New Firebase 2nd-gen callable `convertDocumentText` that converts PDF, DOCX, and image (PNG/JPEG/WEBP) uploads to plain text / markdown, server-side only
- Extend the existing `ChatComposer` "+" picker to accept these formats and route them through the new callable before feeding the existing `hasChanged → forget → ingest` pipeline — unchanged otherwise
- Delete the dead `documentExtract` callable and all its registrations
- Zero API keys anywhere in the new path — Vertex AI via Application Default Credentials (ADC) only, matching every other AI-calling callable in this codebase
- Charge 1 credit per conversion, with refund-on-failure semantics identical to other credit-gated callables

## Non-Goals

- Changing anything in `core-llm-wiki`, `wikiMachine`, or `useCharacterWiki` — `ingestDocument`'s `immutable_document` tagging is already correct and is out of scope
- Legacy `.doc` (binary Word format), `.rtf`, `.odt`, `.pptx`, `.csv` — deferred; `mammoth` only supports `.docx` (OOXML)
- Multi-file batch upload — picker remains single-file, as today
- Server-side persistence of converted text — `convertDocumentText` returns text only; the client owns writing to the wiki, same invariant as the old `documentExtract` had
- Large-file Cloud Storage upload path — v1 stays within a single callable request (inline base64); revisit if real-world file sizes demand it

## Cleanup: Delete Dead `documentExtract`

Confirmed dead: `documentExtractFn` is registered in `src/config/firebaseConfig.ts` / `.web.ts` but never invoked anywhere in `src/`. `ChatComposer.tsx` calls `useCharacterWiki().ingest()` directly with locally-read text — no callable in that path.

Remove:
- `functions/src/documentExtract.ts`
- `functions/src/documentExtract.test.ts`
- `documentExtract` export + import in `functions/src/index.ts`
- `documentExtractFn` declaration + export in `src/config/firebaseConfig.ts` and `src/config/firebaseConfig.web.ts`

## New Callable: `convertDocumentText`

New file `functions/src/convertDocumentText.ts`. Pattern mirrors `documentExtract.ts`/`generateImage.ts`: `onCall({ region: 'us-central1', enforceAppCheck: true, invoker: 'public', secrets: [...CLOUD_SQL_SECRETS] }, (req) => handler(req, deps))`, handler exported separately for tests.

### Signature

```ts
interface ConvertDocumentTextInput {
  filename: string;        // for provenance/error messages only; sanitized server-side
  mimeType: string;        // must be in ALLOWED_MIME_TYPES
  contentBase64: string;   // raw file bytes, base64-encoded
}

interface ConvertDocumentTextOutput {
  text: string;             // extracted/converted markdown or plain text
  truncated: boolean;       // true if output exceeded MAX_DOCUMENT_CHARS and was clipped
}
```

### Allowed MIME types → conversion engine

```ts
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GEMINI_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_MIME_TYPES = new Set([DOCX_MIME, ...GEMINI_MIME_TYPES]);
```

- `DOCX_MIME` → **mammoth** (`mammoth.extractRawText({ buffer })`) — deterministic, no LLM call, no credit-cost variance from model latency/availability. Mammoth has no `convertToMarkdown` API (only `convertToHtml` and `extractRawText`); `extractRawText` returns plain text, which is sufficient — the existing ingest pipeline chunks prose regardless of markdown formatting.
- `GEMINI_MIME_TYPES` (pdf, png, jpeg, webp) → **Gemini multimodal**, inline file part.

Any other `mimeType` → `HttpsError('invalid-argument', 'Unsupported file type.')` before any credit charge.

### Server pipeline

1. **Auth check** — same `request.auth` + decoded-token UID match as `documentExtract`/`generateImage`.
2. **Parse + validate input** — `filename` non-empty string (sanitize: strip everything outside `[A-Za-z0-9._\- ]`, truncate to 255 chars, same regex as old `documentExtract`); `mimeType` must be in `ALLOWED_MIME_TYPES`; `contentBase64` must be a non-empty string matching base64 charset.
3. **Size cap** — `contentBase64.length > MAX_BASE64_LENGTH` (`12_000_000`, ~9MB raw) → `HttpsError('invalid-argument', 'File too large.')`. Rejected before any credit charge or decode. Mirrors `generateImage.ts`'s `MAX_BASE64_LENGTH = 8_000_000` constant for output; input cap set slightly higher since source documents run larger than generated images.
4. **User identity** — `userRepository.getOrCreateUserByFirebaseIdentity`, same as every other callable.
5. **Charge 1 credit** — `creditService.spendCredits(userId, 1)`; insufficient balance → `HttpsError('failed-precondition', 'Insufficient credits to convert document.')`. Charged *before* conversion (matches old `documentExtract`'s `chargeForDocumentExtract`), refunded on any failure in the try/catch below.
6. **Decode + convert**:
   - DOCX → `Buffer.from(contentBase64, 'base64')` → `mammoth.extractRawText({ buffer })` → `.value` is the plain text. Mammoth conversion errors (corrupt/non-OOXML file) caught and rethrown as `HttpsError('invalid-argument', 'Could not read DOCX file.')`.
   - PDF/image → Gemini multimodal call: `ai.models.generateContent({ model: 'gemini-3.5-flash', contents: [{ inlineData: { mimeType, data: contentBase64 } }, { text: CONVERSION_PROMPT }] })`. `CONVERSION_PROMPT`: "Transcribe all text content from this document into clean markdown. Preserve headings, lists, and tables where present. Output only the transcribed markdown — no commentary, no preamble." No structured-output schema needed (output is markdown text, not JSON) — use default `responseMimeType` (text).
7. **Validate output** — empty/whitespace-only result → `HttpsError('internal', 'Conversion produced no text.')` (triggers refund below, same as a thrown error).
8. **Truncate** — `text.length > MAX_DOCUMENT_CHARS (200_000)` → slice + `truncated = true`. Same constant as old `documentExtract`.
9. **Return** `{ text, truncated }`.
10. **On any failure** after the credit charge (step 5) — catch, call `creditService.refundCredit(userId, transactionId, 1)`, log refund (warn) or refund failure (error), rethrow original error. Identical try/catch/refund shape to `documentExtract.ts`'s `chargeForDocumentExtract` + outer catch block.

### Logging

Metadata only, no content: `filename` length, `mimeType`, `contentBase64.length`, which engine was used, `truncated`, output `text.length`. Never log `contentBase64` or `text`.

### Vertex AI / ADC enforcement

Reuses the exact `GoogleGenAI` client construction pattern already in `documentExtract.ts`/`generateImage.ts`:

```ts
new GoogleGenAI({
  vertexai: true,
  project: getProjectId(), // GCLOUD_PROJECT / GCP_PROJECT / GOOGLE_CLOUD_PROJECT
  location: 'global',      // Gemini 3.5 family is global-only on Vertex AI
});
```

No API key anywhere — authentication is ADC (metadata server in deployed Cloud Functions, same as `cloud-agent`). Model: `gemini-3.5-flash`, matching the rest of the codebase's current model choice.

### Constants

```ts
const MAX_BASE64_LENGTH = 12_000_000;   // ~9MB raw file
const MAX_DOCUMENT_CHARS = 200_000;     // matches old documentExtract cap
const CONVERT_MODEL = 'gemini-3.5-flash';
const GEMINI_LOCATION = 'global';
```

## Client: `ChatComposer.tsx` / `ChatComposer.web.tsx`

### Picker MIME filter

Extend `DocumentPicker.getDocumentAsync({ type: [...] })`:

```ts
type: [
  'text/plain', 'text/markdown',                                              // existing
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'image/png', 'image/jpeg', 'image/webp',
]
```

### Branch on MIME type

```
asset.mimeType === 'text/plain' | 'text/markdown'
  → read as UTF-8 text                              [existing path, unchanged per platform]
  → documentChunk = normalize(raw)

else (pdf / docx / image)
  → read as base64                                  [new — platform-specific, see below]
  → convertDocumentText({ filename: sourceRef, mimeType: asset.mimeType, contentBase64 })
  → documentChunk = normalize(result.text)
```

`ChatComposer.tsx` (native) and `ChatComposer.web.tsx` already use different file-read mechanics for the existing text path — native uses `readAsStringAsync` from `expo-file-system/legacy`, web uses `fetch(uri).text()` (the legacy module's web shim does not implement `readAsStringAsync`). The new base64 read needs the same per-platform split:

- **Native**: `readAsStringAsync(uri, { encoding: 'base64' })` from `expo-file-system/legacy` — same module already imported, just a different `encoding` option (confirmed supported in its `ReadingOptions` type).
- **Web**: no equivalent in `expo-file-system`'s web shim. Use `fetch(uri).then(r => r.blob())`, then `FileReader.readAsDataURL(blob)`, then strip the `data:...;base64,` prefix to get the raw base64 string. Plain browser APIs, no new dependency.

From `documentChunk` onward, **zero changes** — same `sourceHash` computation (`expo-crypto` SHA-256), same `hasChanged` → `forget({ sourceRef })` → `ingest({ sourceRef, sourceHash, documentChunk, promptOverride: ingestPromptOverride })` call sequence already in `handlePlusPress`.

### Error handling

Add one more `catch` arm in `handlePlusPress`, mapping `convertDocumentText` `HttpsError` codes to toast copy:
- `failed-precondition` → "Insufficient credits to convert this document."
- `invalid-argument` → "File too large or unsupported format."
- anything else → "Failed to convert document."

Existing `WikiBusyError` / JSON-parse-error toast branches (for the `ingest` call) are unaffected.

### New client service

`src/services/convertDocumentTextService.ts` (or extend `apiClient.ts` alongside `wikiLlm`/`generateEmbedding`): thin `httpsCallable` wrapper, `await appCheckReady` before calling, identical shape to other callable wrappers in `apiClient.ts`.

## Files Touched

**New**:
- `functions/src/convertDocumentText.ts`
- `functions/src/convertDocumentText.test.ts`
- `src/services/convertDocumentTextService.ts` (or addition to `src/services/apiClient.ts`)

**Modified**:
- `functions/src/index.ts` — remove `documentExtract` export, add `convertDocumentText` export
- `src/config/firebaseConfig.ts` / `.web.ts` — remove `documentExtractFn`, add `convertDocumentTextFn`
- `src/components/ChatComposer.tsx` / `.web.tsx` — extend picker MIME filter, add base64-read + convert branch, add error-toast mapping
- `functions/package.json` — add `mammoth` dependency

**Deleted**:
- `functions/src/documentExtract.ts`
- `functions/src/documentExtract.test.ts`

**Unchanged**:
- `@equationalapplications/core-llm-wiki`, `wikiMachine.ts`, `useCharacterWiki.ts` — `ingestDocument`'s `source_type: 'immutable_document'` tagging and `runLibrarian`/`runHeal` skip behavior already correct, verified against package `.d.ts`
- `wikiLlm.ts`, `wikiSync.ts` — unrelated callables, no changes

## Tests

- **Backend handler** (`node:test`, mirror `documentExtract.test.ts` / `generateImage.test.ts` shape): auth check, MIME allow-list rejection, base64 size cap rejection (before credit charge — assert `spendCredits` not called), credit charge + refund-on-failure (mammoth throws, Gemini throws, empty-output case), DOCX happy path via fixture `.docx` buffer through real `mammoth`, PDF/image happy path with mocked `generateContent` dep, truncation flag when output exceeds `MAX_DOCUMENT_CHARS`, filename sanitization, no `contentBase64`/`text` in log calls (assert via mocked logger)
- **Client** (`ChatComposer.test.tsx`, if present, or new test file): picker MIME list includes new types, base64 read path invoked only for non-text/markdown mime types, `convertDocumentText` result feeds into existing `hasChanged`/`forget`/`ingest` calls unchanged, error-toast mapping per `HttpsError` code
- **Regression**: existing `.txt`/`.md` path in `ChatComposer.test.tsx` continues to pass unchanged (no regression in the already-working flow)

## Acceptance Criteria

- [ ] `functions/src/documentExtract.ts` and `.test.ts` deleted; no remaining imports/exports/registrations anywhere (`index.ts`, `firebaseConfig.ts`, `firebaseConfig.web.ts`)
- [ ] `convertDocumentText` callable: enforces MIME allow-list, base64 size cap (before credit charge), credit charge (1) + refund-on-failure, DOCX via `mammoth`, PDF/image via Gemini (Vertex AI, ADC, `gemini-3.5-flash`, `location: 'global'`), output truncation flag
- [ ] No API keys anywhere in the new path — `GoogleGenAI({ vertexai: true, ... })` only, verified by grep for hardcoded keys / `process.env` API key vars in the new file
- [ ] `ChatComposer.tsx` / `.web.tsx` picker accepts pdf/docx/image types; routes binary formats through `convertDocumentText`, text formats through existing local-read path
- [ ] Converted text flows into existing `hasChanged → forget → ingest` calls unchanged — `source_type: 'immutable_document'` tagging confirmed via existing `core-llm-wiki` behavior (no new test needed there, already covered by that package)
- [ ] `npm run typecheck && npm run lint && npm run test` green at root
- [ ] `cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/convertDocumentText.test.js` green; confirm `documentExtract.test.js` no longer exists/runs
