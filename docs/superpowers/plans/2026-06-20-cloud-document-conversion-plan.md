# Cloud Document Format Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload PDF, DOCX, and image (PNG/JPEG/WEBP) documents through the existing `ChatComposer` "+" picker by adding a new `convertDocumentText` Firebase callable that converts them to plain text/markdown server-side, then deleting the dead `documentExtract` callable it replaces.

**Architecture:** New callable `convertDocumentText` (Vertex AI Gemini for PDF/image, `mammoth` for DOCX, ADC-only, 1 credit charged with refund-on-failure) sits in front of the already-working `hasChanged → forget → ingest` pipeline in `ChatComposer.tsx`/`.web.tsx`. No changes to `core-llm-wiki`, `wikiMachine`, or `useCharacterWiki` — `ingestDocument`'s `source_type: 'immutable_document'` tagging is already correct.

**Tech Stack:** Firebase Functions v2 (`onCall`), `@google/genai` (Vertex AI, ADC), `mammoth` (DOCX text extraction), `expo-document-picker`, `expo-file-system/legacy`, `expo-crypto`.

**Spec:** [docs/superpowers/specs/2026-06-20-cloud-document-conversion-design.md](../specs/2026-06-20-cloud-document-conversion-design.md)

---

## Task 1: Add `mammoth` dependency

**Files:**
- Modify: `functions/package.json`

- [ ] **Step 1: Add the dependency**

In `functions/package.json`, add `mammoth` to `dependencies` (alphabetically, after `firebase-functions`):

```json
    "firebase-functions": "^7.2.5",
    "mammoth": "^1.12.0",
    "pg": "^8.20.0",
```

- [ ] **Step 2: Install**

Run: `cd functions && npm install`
Expected: `package-lock.json` updates, no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "build(functions): add mammoth for DOCX text extraction"
```

---

## Task 2: `convertDocumentText` backend handler

**Files:**
- Create: `functions/src/convertDocumentText.ts`
- Create: `functions/src/convertDocumentText.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `functions/src/convertDocumentText.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';

process.env.NODE_ENV = 'test';

const { convertDocumentTextHandler } = await import('./convertDocumentText.js');

function makeRequest(data: unknown, uid = 'uid-1') {
  return {
    auth: { uid, token: { uid, email: 'test@example.com', name: 'Test User' } },
    data,
    rawRequest: {},
  } as never;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VALID_BASE64 = Buffer.from('hello world').toString('base64');

function makeDeps(options: {
  spendCreditsImpl?: (userId: string, amount: number) => Promise<string | null>;
  refundCreditImpl?: (userId: string, transactionId: string, amount: number) => Promise<void>;
  convertDocxImpl?: (buffer: Buffer) => Promise<string>;
  generateFromGeminiImpl?: (mimeType: string, base64: string) => Promise<string>;
} = {}) {
  return {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: 'user-1',
        firebaseUid: 'firebase-uid-1',
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    },
    creditService: {
      spendCredits: options.spendCreditsImpl ?? (async () => 'mock-tx-id'),
      refundCredit: options.refundCreditImpl ?? (async () => {}),
    },
    convertDocx: options.convertDocxImpl ?? (async () => 'Converted docx text.'),
    generateFromGemini: options.generateFromGeminiImpl ?? (async () => 'Converted gemini text.'),
  };
}

describe('convertDocumentTextHandler', () => {
  it('rejects unauthenticated requests', async () => {
    await assert.rejects(
      () => convertDocumentTextHandler({ auth: null, data: {}, rawRequest: {} } as never, makeDeps() as never),
      (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
    );
  });

  it('rejects missing filename', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects unsupported mime type', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.csv', mimeType: 'text/csv', contentBase64: VALID_BASE64 }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects contentBase64 exceeding size cap', async () => {
    const oversize = 'A'.repeat(12_000_001);
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: oversize }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects malformed base64', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: 'not base64!!' }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('does not charge credits when validation fails', async () => {
    let spendCalled = false;
    const deps = makeDeps({
      spendCreditsImpl: async () => {
        spendCalled = true;
        return 'tx';
      },
    });
    await assert.rejects(() =>
      convertDocumentTextHandler(
        makeRequest({ filename: 'f.csv', mimeType: 'text/csv', contentBase64: VALID_BASE64 }),
        deps as never,
      ),
    );
    assert.equal(spendCalled, false);
  });

  it('rejects when credits are insufficient', async () => {
    const deps = makeDeps({ spendCreditsImpl: async () => null });
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
          deps as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'failed-precondition',
    );
  });

  it('converts DOCX via mammoth and returns text', async () => {
    const deps = makeDeps({ convertDocxImpl: async () => 'Extracted docx paragraph text.' });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, 'Extracted docx paragraph text.');
    assert.equal(result.truncated, false);
  });

  it('converts PDF via Gemini and returns text', async () => {
    let capturedMime = '';
    const deps = makeDeps({
      generateFromGeminiImpl: async (mimeType: string) => {
        capturedMime = mimeType;
        return '# Transcribed markdown';
      },
    });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, '# Transcribed markdown');
    assert.equal(capturedMime, 'application/pdf');
  });

  it('converts image via Gemini and returns text', async () => {
    const deps = makeDeps({ generateFromGeminiImpl: async () => 'Transcribed image text.' });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.png', mimeType: 'image/png', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, 'Transcribed image text.');
  });

  it('refunds credit when mammoth conversion throws', async () => {
    let refunded = false;
    const deps = makeDeps({
      convertDocxImpl: async () => {
        throw new HttpsError('invalid-argument', 'Could not read DOCX file.');
      },
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(() =>
      convertDocumentTextHandler(
        makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
        deps as never,
      ),
    );
    assert.equal(refunded, true);
  });

  it('refunds credit when Gemini conversion throws', async () => {
    let refunded = false;
    const deps = makeDeps({
      generateFromGeminiImpl: async () => {
        throw new Error('Vertex AI unavailable');
      },
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(() =>
      convertDocumentTextHandler(
        makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
        deps as never,
      ),
    );
    assert.equal(refunded, true);
  });

  it('refunds credit and rejects when conversion produces empty text', async () => {
    let refunded = false;
    const deps = makeDeps({
      generateFromGeminiImpl: async () => '   ',
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
          deps as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'internal',
    );
    assert.equal(refunded, true);
  });

  it('truncates output exceeding MAX_DOCUMENT_CHARS and sets truncated flag', async () => {
    const longText = 'a'.repeat(200_001);
    const deps = makeDeps({ generateFromGeminiImpl: async () => longText });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text.length, 200_000);
    assert.equal(result.truncated, true);
  });

  it('sanitizes filename without throwing', async () => {
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: '../../../etc/passwd.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
      makeDeps() as never,
    );
    assert.ok(result.text.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './convertDocumentText.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `functions/src/convertDocumentText.ts`:

```ts
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI } from '@google/genai';
import * as mammoth from 'mammoth';

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';
import { userRepository } from './services/userRepository.js';
import { creditService } from './services/creditService.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_REGION = 'us-central1';
// Gemini 3 family is global-only on Vertex AI; DEFAULT_REGION above still
// governs this Cloud Function's own deploy region, unrelated to this.
const GEMINI_LOCATION = 'global';
const CONVERT_MODEL = 'gemini-3.5-flash';
const MAX_BASE64_LENGTH = 12_000_000; // ~9MB raw file
const MAX_DOCUMENT_CHARS = 200_000;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GEMINI_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_MIME_TYPES = new Set<string>([DOCX_MIME, ...GEMINI_MIME_TYPES]);

const CONVERSION_PROMPT =
  'Transcribe all text content from this document into clean markdown. ' +
  'Preserve headings, lists, and tables where present. ' +
  'Output only the transcribed markdown — no commentary, no preamble.';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ConvertDocumentTextOutput {
  text: string;
  truncated: boolean;
}

interface ConvertDocumentTextInput {
  filename?: unknown;
  mimeType?: unknown;
  contentBase64?: unknown;
}

interface ConvertDocumentTextDeps {
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>;
  creditService: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>;
  convertDocx: (buffer: Buffer) => Promise<string>;
  generateFromGemini: (mimeType: string, base64: string) => Promise<string>;
}

let genAIClient: GoogleGenAI | undefined;

function getProjectId(): string {
  const value = [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map((v) => v?.trim())
    .find((v): v is string => Boolean(v));
  if (!value) {
    throw new HttpsError(
      'failed-precondition',
      'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for document conversion.',
    );
  }
  return value;
}

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }
  genAIClient = new GoogleGenAI({
    vertexai: true,
    project: getProjectId(),
    location: GEMINI_LOCATION,
  });
  return genAIClient;
}

async function defaultGenerateFromGemini(mimeType: string, base64: string): Promise<string> {
  const ai = getGenAIClient();
  const result = await ai.models.generateContent({
    model: CONVERT_MODEL,
    contents: [{ inlineData: { mimeType, data: base64 } }, { text: CONVERSION_PROMPT }],
    config: { maxOutputTokens: 8192 },
  });
  const candidates = result.candidates ?? [];
  for (const candidate of candidates) {
    const text = (candidate.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  throw new HttpsError('internal', 'Model returned empty conversion response.');
}

async function defaultConvertDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw new HttpsError('invalid-argument', 'Could not read DOCX file.');
  }
}

// ─── Input parsing ────────────────────────────────────────────────────────────
function parseInput(data: unknown): {
  filename: string;
  mimeType: string;
  contentBase64: string;
} {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'Valid payload is required.');
  }
  const payload = data as ConvertDocumentTextInput;

  if (typeof payload.filename !== 'string' || !payload.filename.trim()) {
    throw new HttpsError('invalid-argument', 'filename is required.');
  }
  const filename = payload.filename
    .replace(/[^A-Za-z0-9._\- ]/g, '')
    .trim()
    .slice(0, 255);
  if (!filename) {
    throw new HttpsError('invalid-argument', 'filename is required after sanitization.');
  }

  if (typeof payload.mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(payload.mimeType)) {
    throw new HttpsError('invalid-argument', 'Unsupported file type.');
  }

  if (typeof payload.contentBase64 !== 'string' || !payload.contentBase64) {
    throw new HttpsError('invalid-argument', 'contentBase64 must be a non-empty string.');
  }
  if (payload.contentBase64.length > MAX_BASE64_LENGTH) {
    throw new HttpsError('invalid-argument', 'File too large.');
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(payload.contentBase64)) {
    throw new HttpsError('invalid-argument', 'contentBase64 must be valid base64.');
  }

  return { filename, mimeType: payload.mimeType, contentBase64: payload.contentBase64 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function convertDocumentTextHandler(
  request: CallableRequest,
  deps: ConvertDocumentTextDeps = {
    userRepository,
    creditService,
    convertDocx: defaultConvertDocx,
    generateFromGemini: defaultGenerateFromGemini,
  },
): Promise<ConvertDocumentTextOutput> {
  // 1. Auth check
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const decoded = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase authentication token.');
  }

  // 2. Parse + validate input (before any credit charge)
  const { filename, mimeType, contentBase64 } = parseInput(request.data);

  // 3. User identity
  const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email: decoded.email ?? '',
    displayName: decoded.name,
  });

  // 4. Charge 1 credit before conversion; refunded on any failure below.
  const transactionId = await deps.creditService.spendCredits(user.id, 1);
  if (!transactionId) {
    throw new HttpsError('failed-precondition', 'Insufficient credits to convert document.');
  }

  logger.info('convertDocumentText start', {
    filenameLen: filename.length,
    mimeType,
    base64Len: contentBase64.length,
    userId: user.id,
  });

  try {
    let text: string;
    if (mimeType === DOCX_MIME) {
      const buffer = Buffer.from(contentBase64, 'base64');
      text = await deps.convertDocx(buffer);
    } else {
      text = await deps.generateFromGemini(mimeType, contentBase64);
    }

    if (!text.trim()) {
      throw new HttpsError('internal', 'Conversion produced no text.');
    }

    let truncated = false;
    if (text.length > MAX_DOCUMENT_CHARS) {
      text = text.slice(0, MAX_DOCUMENT_CHARS);
      truncated = true;
    }

    logger.info('convertDocumentText done', {
      mimeType,
      outputLen: text.length,
      truncated,
      userId: user.id,
    });

    return { text, truncated };
  } catch (error) {
    try {
      await deps.creditService.refundCredit(user.id, transactionId, 1);
      logger.warn('convertDocumentText refunded credit after conversion failure', {
        userId: user.id,
        transactionId,
      });
    } catch (refundError) {
      logger.error('convertDocumentText failed to refund credit after failure', {
        userId: user.id,
        transactionId,
        error: refundError instanceof Error ? refundError.message : String(refundError),
      });
    }
    throw error;
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const convertDocumentText = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => convertDocumentTextHandler(request),
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec lib/convertDocumentText.test.js`
Expected: PASS — all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/convertDocumentText.ts functions/src/convertDocumentText.test.ts
git commit -m "feat(functions): add convertDocumentText callable for PDF/DOCX/image conversion"
```

---

## Task 3: Register `convertDocumentText`, delete dead `documentExtract`

**Files:**
- Modify: `functions/src/index.ts`
- Delete: `functions/src/documentExtract.ts`
- Delete: `functions/src/documentExtract.test.ts`

- [ ] **Step 1: Update the export list**

In `functions/src/index.ts`, replace:

```ts
export {
  documentExtract,
} from "./documentExtract.js";
```

with:

```ts
export {
  convertDocumentText,
} from "./convertDocumentText.js";
```

- [ ] **Step 2: Delete the dead files**

```bash
git rm functions/src/documentExtract.ts functions/src/documentExtract.test.ts
```

- [ ] **Step 3: Verify the build is clean**

Run: `cd functions && npm run build && npm run lint`
Expected: PASS — no references to `documentExtract` remain, no lint errors.

- [ ] **Step 4: Run the full functions test suite**

Run: `cd functions && npm run test`
Expected: PASS — `documentExtract.test.js` no longer exists/runs; `convertDocumentText.test.js` passes alongside the rest.

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): register convertDocumentText, remove dead documentExtract callable"
```

---

## Task 4: Wire `convertDocumentText` into client Firebase config + `apiClient`

**Files:**
- Modify: `src/config/firebaseConfig.ts`
- Modify: `src/config/firebaseConfig.web.ts`
- Modify: `src/services/apiClient.ts`

- [ ] **Step 1: Replace `documentExtractFn` in `firebaseConfig.ts`**

In `src/config/firebaseConfig.ts`, replace:

```ts
const documentExtractFn = httpsCallable(functionsInstance, 'documentExtract')
```

with:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText')
```

And in the `export { ... }` block, replace `documentExtractFn,` with `convertDocumentTextFn,`.

- [ ] **Step 2: Replace `documentExtractFn` in `firebaseConfig.web.ts`**

Same change in `src/config/firebaseConfig.web.ts`: replace the `documentExtractFn` declaration line and its entry in the `export { ... }` block with `convertDocumentTextFn`.

- [ ] **Step 3: Add the `apiClient.ts` wrapper**

In `src/services/apiClient.ts`, add `convertDocumentTextFn as convertDocumentTextCallable` to the import block from `~/config/firebaseConfig`:

```ts
import {
  appCheckReady,
  acceptTermsFn as acceptTermsCallable,
  deleteCharacterFn as deleteCharacterCallable,
  getPublicCharacterFn as getPublicCharacterCallable,
  getUserCharactersFn as getUserCharactersCallable,
  syncCharacterFn as syncCharacterCallable,
  updateUserProfileFn as updateUserProfileCallable,
  wikiLlmFn as wikiLlmCallable,
  wikiSyncFn as wikiSyncCallable,
  generateEmbeddingFn as generateEmbeddingCallable,
  convertDocumentTextFn as convertDocumentTextCallable,
} from '~/config/firebaseConfig'
```

Then add, after the `generateEmbedding` export at the end of the file:

```ts
export interface ConvertDocumentTextRequest {
  filename: string
  mimeType: string
  contentBase64: string
}

export interface ConvertDocumentTextResponse {
  text: string
  truncated: boolean
}

export const convertDocumentText = withAppCheck(
  convertDocumentTextCallable as Callable<ConvertDocumentTextRequest, ConvertDocumentTextResponse>,
)
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS — no references to `documentExtractFn` remain anywhere in `src/`.

- [ ] **Step 5: Commit**

```bash
git add src/config/firebaseConfig.ts src/config/firebaseConfig.web.ts src/services/apiClient.ts
git commit -m "feat(client): wire convertDocumentText callable into apiClient"
```

---

## Task 5: `ChatComposer.tsx` (native) — binary format support

**Files:**
- Modify: `src/components/ChatComposer.tsx`
- Test: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Write the failing test**

In `__tests__/chatComposer.test.tsx`, add this test inside the `describe('ChatComposer', ...)` block, after the existing `'delegates ingest flow through useCharacterWiki methods'` test. First add a mock for `~/services/apiClient` near the top of the file (after the `expo-crypto` mock block):

```ts
const mockConvertDocumentText = jest.fn()
jest.mock('~/services/apiClient', () => ({
  convertDocumentText: (...args: unknown[]) => mockConvertDocumentText(...args),
}))
```

Then add to the `beforeEach`:

```ts
mockConvertDocumentText.mockReset()
mockConvertDocumentText.mockResolvedValue({ data: { text: 'converted text', truncated: false } })
```

Then add the test:

```ts
  it('converts PDF documents via convertDocumentText before ingesting (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('base64-bytes')
    Crypto.digestStringAsync.mockResolvedValue('hash456')
    mockConvertDocumentText.mockResolvedValue({ data: { text: 'transcribed pdf text', truncated: false } })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      await plusButton.props.onPress()
    })

    expect(FileSystemLegacy.readAsStringAsync).toHaveBeenCalledWith(
      'file://doc.pdf',
      { encoding: 'base64' },
    )
    expect(mockConvertDocumentText).toHaveBeenCalledWith({
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      contentBase64: 'base64-bytes',
    })
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'doc.pdf',
        documentChunk: 'transcribed pdf text',
      }),
    )
  })

  it('maps insufficient-credit error from convertDocumentText to a toast (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({ code: 'functions/failed-precondition', message: 'Insufficient credits to convert document.' })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      await plusButton.props.onPress()
    })

    expect(capturedSnackbarProps.children).toBe('Insufficient credits to convert this document.')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/chatComposer.test.tsx`
Expected: FAIL — `mockConvertDocumentText` never called (component doesn't import/use it yet); `readAsStringAsync` not called with a base64 encoding option.

- [ ] **Step 3: Implement the binary-format branch**

In `src/components/ChatComposer.tsx`, add the import:

```ts
import { convertDocumentText } from '~/services/apiClient'
```

Add these two constants above the component (after the `ChatComposerProps` type):

```ts
const TEXT_MIME_TYPES = ['text/plain', 'text/markdown']
const CONVERT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
])
```

Replace the body of `handlePlusPress` (from the `DocumentPicker.getDocumentAsync` call through the `sourceHash` computation) with:

```ts
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      const uri = asset.uri
      // Sanitize filename: strip control chars, cap length for stable sourceRef
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      let rawText: string
      if (asset.mimeType && CONVERT_MIME_TYPES.has(asset.mimeType)) {
        const contentBase64 = await readAsStringAsync(uri, { encoding: 'base64' })
        const convertResult = await convertDocumentText({
          filename: sourceRef,
          mimeType: asset.mimeType,
          contentBase64,
        })
        rawText = convertResult.data.text
      } else {
        rawText = await readAsStringAsync(uri)
      }

      // Strip BOM/null bytes and normalize to NFC for consistent cross-platform
      // hashing regardless of editor/OS encoding quirks or conversion source.
      const documentChunk = rawText
        .replace(/^\uFEFF/, '')   // strip UTF-8 BOM
        .replace(/\0/g, '')       // strip null bytes
        .normalize('NFC')         // canonical Unicode form
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')  // normalize line endings
      const sourceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        documentChunk,
      )
```

Update the `catch` block: add two new `else if` arms before the existing `SyntaxError` check:

```ts
    } catch (error) {
      const firebaseCode = (error as { code?: unknown } | null)?.code
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (firebaseCode === 'functions/failed-precondition') {
        setToastMessage('Insufficient credits to convert this document.')
      } else if (firebaseCode === 'functions/invalid-argument') {
        setToastMessage('File too large or unsupported format.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/chatComposer.test.tsx`
Expected: PASS — all tests in the file green, including the two new ones and the original `.txt` ingest test (unaffected since `.txt`/`.md` still take the `else` branch).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(client): route PDF/DOCX/image uploads through convertDocumentText (native)"
```

---

## Task 6: `ChatComposer.web.tsx` — binary format support

**Files:**
- Modify: `src/components/ChatComposer.web.tsx`
- Test: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/chatComposer.test.tsx`, after the native tests added in Task 5. First, add a `global.fetch` and `global.FileReader` mock setup — add this near the top of the file alongside the other module mocks:

```ts
const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

class MockFileReader {
  result: string | null = null
  onloadend: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(_blob: unknown) {
    this.result = 'data:application/pdf;base64,d2ViLWJhc2U2NA=='
    this.onloadend?.()
  }
}
global.FileReader = MockFileReader as unknown as typeof FileReader
```

Then add the test:

```ts
  it('converts PDF documents via convertDocumentText before ingesting (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockFetch.mockResolvedValue({
      ok: true,
      blob: async () => ({}),
    })
    Crypto.digestStringAsync.mockResolvedValue('hash789')
    mockConvertDocumentText.mockResolvedValue({ data: { text: 'transcribed pdf text', truncated: false } })

    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      await plusButton.props.onPress()
    })

    expect(mockConvertDocumentText).toHaveBeenCalledWith({
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      contentBase64: 'd2ViLWJhc2U2NA==',
    })
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'doc.pdf',
        documentChunk: 'transcribed pdf text',
      }),
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/chatComposer.test.tsx`
Expected: FAIL — `mockConvertDocumentText` never called (web component doesn't have a binary branch yet).

- [ ] **Step 3: Implement the binary-format branch**

In `src/components/ChatComposer.web.tsx`, add the import:

```ts
import { convertDocumentText } from '~/services/apiClient'
```

Add a module-level helper function above the component, and the same two MIME constants from Task 5:

```ts
const TEXT_MIME_TYPES = ['text/plain', 'text/markdown']
const CONVERT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
])

async function readAsBase64Web(uri: string): Promise<string> {
  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error(`Failed to read file (HTTP ${response.status})`)
  }
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(blob)
  })
}
```

Replace the body of `handlePlusPress` (from the `DocumentPicker.getDocumentAsync` call through the `sourceHash` computation) with:

```ts
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      const uri = asset.uri
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      let rawText: string
      if (asset.mimeType && CONVERT_MIME_TYPES.has(asset.mimeType)) {
        const contentBase64 = await readAsBase64Web(uri)
        const convertResult = await convertDocumentText({
          filename: sourceRef,
          mimeType: asset.mimeType,
          contentBase64,
        })
        rawText = convertResult.data.text
      } else {
        const response = await fetch(uri)
        if (!response.ok) {
          throw new Error(`Failed to read file (HTTP ${response.status})`)
        }
        rawText = await response.text()
      }

      const documentChunk = rawText
        .replace(/^\uFEFF/, '')
        .replace(/\0/g, '')
        .normalize('NFC')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const sourceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        documentChunk,
      )
```

Update the `catch` block the same way as Task 5:

```ts
    } catch (error) {
      const firebaseCode = (error as { code?: unknown } | null)?.code
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (firebaseCode === 'functions/failed-precondition') {
        setToastMessage('Insufficient credits to convert this document.')
      } else if (firebaseCode === 'functions/invalid-argument') {
        setToastMessage('File too large or unsupported format.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/chatComposer.test.tsx`
Expected: PASS — full file green, including all native and web tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer.web.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(client): route PDF/DOCX/image uploads through convertDocumentText (web)"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Root typecheck, lint, test**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS, zero errors.

- [ ] **Step 2: Functions typecheck, lint, build, test**

Run: `cd functions && npm run typecheck && npm run lint && npm run build && npm run test`
Expected: PASS, zero errors. Confirm `documentExtract` no longer appears in `functions/lib/`.

- [ ] **Step 3: Grep for leftover references**

Run: `grep -rn "documentExtract" src/ functions/src/ --include="*.ts" --include="*.tsx"`
Expected: no output (zero matches).

- [ ] **Step 4: Confirm no API keys in the new path**

Run: `grep -n "apiKey\|API_KEY" functions/src/convertDocumentText.ts`
Expected: no output — only `vertexai: true` / ADC-based `GoogleGenAI` construction.
