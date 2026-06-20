# Document Upload Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a live credit-loss bug in `convertDocumentText` and harden the document-upload client flow against oversized files and stale/late-resolving requests, per `docs/superpowers/specs/2026-06-20-document-upload-reliability-hardening-design.md`.

**Architecture:** Four independent, additive changes layered on the existing callable-based upload flow: (1) raise the Cloud Function's `timeoutSeconds`/`memory` so slow conversions reach the existing refund path instead of being killed; (2) raise the matching client-side callable timeout so the client doesn't give up before the server would; (3) a client-side file-size pre-check that fails fast before any read; (4) a `requestId`-based staleness guard in both `ChatComposer` variants so unmounted/superseded upload flows never mutate state after the fact.

**Tech Stack:** TypeScript, Firebase Cloud Functions v2 (`firebase-functions/v2/https`), `@react-native-firebase/functions` / `firebase/functions` modular SDKs, React Native, Jest + `react-test-renderer`, Node's built-in `node:test` runner (functions package).

---

## Task 1: Cloud Function timeout & memory

**Files:**
- Modify: `functions/src/convertDocumentText.ts:253-261`
- Modify: `functions/src/convertDocumentText.test.ts:7` (import) and end of file (new test)

- [ ] **Step 1: Write the failing test**

In `functions/src/convertDocumentText.test.ts`, change line 7 from:

```ts
const { convertDocumentTextHandler } = await import('./convertDocumentText.js');
```

to:

```ts
const { convertDocumentTextHandler, convertDocumentText } = await import('./convertDocumentText.js');
```

Then append this new test block at the end of the file (after the closing `});` of the `describe('convertDocumentTextHandler', ...)` block):

```ts
describe('convertDocumentText onCall config', () => {
  it('sets timeoutSeconds and memory high enough for slow Gemini conversions', () => {
    const endpoint = (convertDocumentText as unknown as {
      __endpoint: { timeoutSeconds: number; availableMemoryMb: number };
    }).__endpoint;
    assert.equal(endpoint.timeoutSeconds, 540);
    assert.equal(endpoint.availableMemoryMb, 512);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/convertDocumentText.test.js"`
Expected: FAIL — `endpoint.timeoutSeconds` is `undefined` (or 60), not `540`.

- [ ] **Step 3: Write minimal implementation**

In `functions/src/convertDocumentText.ts`, replace lines 253-261:

```ts
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

with:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npm run build && NODE_ENV=test node --test --test-reporter spec "lib/convertDocumentText.test.js"`
Expected: PASS — all tests in the file green, including the new `convertDocumentText onCall config` test.

- [ ] **Step 5: Commit**

```bash
git add functions/src/convertDocumentText.ts functions/src/convertDocumentText.test.ts
git commit -m "fix(functions): raise convertDocumentText timeout so refund path always runs"
```

---

## Task 2: Matching client-side callable timeout

**Files:**
- Modify: `src/config/firebaseConfig.ts:107`
- Modify: `src/config/firebaseConfig.web.ts:163`
- Create: `__tests__/firebaseConfigConvertDocumentTextTimeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/firebaseConfigConvertDocumentTextTimeout.test.ts`:

```ts
jest.mock('firebase/app', () => ({
  getApps: () => [],
  getApp: () => ({ app: 'mock' }),
  initializeApp: () => ({ app: 'mock' }),
}))

jest.mock('firebase/app-check', () => ({
  initializeAppCheck: jest.fn(),
  ReCaptchaEnterpriseProvider: class MockReCaptchaEnterpriseProvider {
    siteKey: string

    constructor(siteKey: string) {
      this.siteKey = siteKey
    }
  },
}))

jest.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(),
}))

jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

describe('convertDocumentText callable timeout', () => {
  const env = process.env as Record<string, string | undefined>
  const originalRecaptchaKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY

  beforeEach(() => {
    process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = 'recaptcha-site-key'
  })

  afterAll(() => {
    env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = originalRecaptchaKey
  })

  it('passes a 540s timeout on web', () => {
    let capturedHttpsCallable: jest.Mock | undefined

    jest.isolateModules(() => {
      jest.doMock('firebase/functions', () => ({
        getFunctions: () => ({}),
        httpsCallable: jest.fn(() => jest.fn()),
      }))
      const functionsModule = require('firebase/functions')
      capturedHttpsCallable = functionsModule.httpsCallable
      require('~/config/firebaseConfig.web')
    })

    expect(capturedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'convertDocumentText',
      { timeout: 540_000 },
    )
  })

  it('passes a 540s timeout on native', () => {
    let capturedHttpsCallable: jest.Mock | undefined

    jest.isolateModules(() => {
      jest.doMock('@react-native-firebase/functions', () => ({
        __esModule: true,
        getFunctions: jest.fn(() => ({})),
        httpsCallable: jest.fn(() => jest.fn()),
      }))
      const functionsModule = require('@react-native-firebase/functions')
      capturedHttpsCallable = functionsModule.httpsCallable
      require('~/config/firebaseConfig')
    })

    expect(capturedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'convertDocumentText',
      { timeout: 540_000 },
    )
  })
})
```

`jest.doMock` (not the hoisted `jest.mock`) is used inside `isolateModules` for the two Firebase-functions variants because each test needs a *different* mock of the same module path depending on which config file it loads, and `doMock` is not hoisted — it applies only within that `isolateModules` sandbox. The `firebase/app`, `firebase/app-check`, `firebase/auth`, and `~/utilities/reportError` mocks stay as top-level `jest.mock` since both config files need the same mocks for those and hoisting them is harmless.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/firebaseConfigConvertDocumentTextTimeout.test.ts`
Expected: FAIL on both assertions — current calls are `httpsCallable(functionsInstance, 'convertDocumentText')` with no third argument.

- [ ] **Step 3: Write minimal implementation**

In `src/config/firebaseConfig.ts`, replace line 107:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText')
```

with:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText', {
  timeout: 540_000,
})
```

In `src/config/firebaseConfig.web.ts`, replace line 163:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText')
```

with:

```ts
const convertDocumentTextFn = httpsCallable(functionsInstance, 'convertDocumentText', {
  timeout: 540_000,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/firebaseConfigConvertDocumentTextTimeout.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full existing suite to check for regressions**

Run: `npm test -- __tests__/firebaseConfigWebVoiceCallable.test.ts __tests__/firebaseConfigWebAppCheck.test.ts`
Expected: PASS — unaffected by this change.

- [ ] **Step 6: Commit**

```bash
git add src/config/firebaseConfig.ts src/config/firebaseConfig.web.ts __tests__/firebaseConfigConvertDocumentTextTimeout.test.ts
git commit -m "fix(config): match client convertDocumentText timeout to server's 540s"
```

---

## Task 3: Shared file-size constant

**Files:**
- Modify: `src/components/documentMimeTypes.ts`

- [ ] **Step 1: Add the constant**

No test for this step alone — it's a pure constant with no behavior, exercised by Tasks 4 and 5's tests. Add to the top of `src/components/documentMimeTypes.ts` (after existing imports/before `TEXT_MIME_TYPES`, there are no imports in this file today, so add at the very top):

```ts
// Mirrors functions/src/convertDocumentText.ts's MAX_BASE64_LENGTH (12,000,000 base64
// chars ≈ 9,000,000 raw bytes). Kept in sync manually — functions/ and app src/ are
// separate deployables with no shared module between them.
export const MAX_DOCUMENT_RAW_BYTES = 9_000_000

export const TEXT_MIME_TYPES = ['text/plain', 'text/markdown'] as const
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — new export doesn't break anything yet (unused until Tasks 4/5).

- [ ] **Step 3: Commit**

```bash
git add src/components/documentMimeTypes.ts
git commit -m "feat(chat): add shared MAX_DOCUMENT_RAW_BYTES constant"
```

---

## Task 4: Native `ChatComposer.tsx` — size pre-check + staleness guard

**Files:**
- Modify: `src/components/ChatComposer.tsx`
- Modify: `__tests__/chatComposer.test.tsx`

### Part A: size pre-check

- [ ] **Step 1: Write the failing test**

Append to `__tests__/chatComposer.test.tsx`, inside the `describe('ChatComposer', ...)` block (e.g. after the `'resets phase to null when document conversion fails (native)'` test, around line 996):

```ts
  it('rejects oversized files before any read (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 9_000_001 }],
    })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onSend={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      await plusButton.props.onPress()
    })

    expect(capturedSnackbarProps.children).toBe('File too large.')
    expect(onPhaseChange).not.toHaveBeenCalled()
    expect(FileSystemLegacy.readAsStringAsync).not.toHaveBeenCalled()
  })

  it('proceeds normally when asset.size is at or below the threshold (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://small.txt', name: 'small.txt', size: 9_000_000 }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')

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

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'small.txt' }),
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "oversized files before any read"`
Expected: FAIL — no size check exists yet, so `readAsStringAsync` is called and the toast/ingest assertions don't match.

- [ ] **Step 3: Write minimal implementation**

In `src/components/ChatComposer.tsx`, add the import (line 13-17 currently imports from `./documentMimeTypes`):

```ts
import {
  CONVERT_MIME_TYPES,
  MAX_DOCUMENT_RAW_BYTES,
  resolveDocumentMimeType,
  TEXT_MIME_TYPES,
} from './documentMimeTypes'
```

Then in `handlePlusPress`, insert the size check right after `const asset = pickerResult.assets[0]` (currently line 60) and before the `sourceRef`/mime-type resolution:

```ts
      const asset = pickerResult.assets[0]
      if (typeof asset.size === 'number' && asset.size > MAX_DOCUMENT_RAW_BYTES) {
        setToastMessage('File too large.')
        return
      }
      const uri = asset.uri
```

(This intentionally runs before `setPhase('reading')` is ever called, per the spec — the spinner never flashes for a pick that's guaranteed to be rejected.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "oversized files before any read|at or below the threshold"`
Expected: PASS for both new tests.

- [ ] **Step 5: Run the full file to check for regressions**

Run: `npm test -- __tests__/chatComposer.test.tsx`
Expected: PASS — all existing tests (the ones with no `size` field on the asset) continue to pass unchanged, since `typeof asset.size === 'number'` is `false` for them.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatComposer.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): reject oversized documents client-side before reading them"
```

### Part B: staleness guard

- [ ] **Step 7: Write the failing test**

Append to `__tests__/chatComposer.test.tsx`:

```ts
  it('ignores a superseded request when a second pick starts before the first resolves (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://first.txt', name: 'first.txt' }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://second.txt', name: 'second.txt' }],
      })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      const firstPress = plusButton.props.onPress()
      const secondPress = plusButton.props.onPress()
      await Promise.all([firstPress, secondPress])
    })

    expect(mockIngest).toHaveBeenCalledTimes(1)
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'second.txt' }),
    )
    expect(capturedSnackbarProps.children).not.toBe('"first.txt" is already up to date.')
  })

  it('ignores an in-flight request after the component unmounts (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    let resolveForget: () => void = () => {}
    mockForget.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveForget = resolve
      }),
    )

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    let pressPromise!: Promise<void>
    await act(async () => {
      pressPromise = plusButton.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    act(() => {
      tree.unmount()
    })

    await act(async () => {
      resolveForget()
      await pressPromise
    })

    expect(mockIngest).not.toHaveBeenCalled()
  })
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "superseded request|after the component unmounts"`
Expected: FAIL — without a staleness guard, the first request's `'first.txt' is already up to date.'`-style resolution (or, for the unmount test, the resumed `forget` continuation) still runs through to completion, so `mockIngest` is called for both / the unmount test calls `ingest` after unmount.

(Note: in the superseded-request test, since `mockHasChanged` defaults to resolving `true` for both requests, both *would* otherwise reach `forget`/`ingest` — the assertion `mockIngest).toHaveBeenCalledTimes(1)` is what catches the missing guard.)

- [ ] **Step 9: Write minimal implementation**

In `src/components/ChatComposer.tsx`:

1. Add `useEffect` to the React import (line 1):

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
```

2. Add a new ref alongside `skipNextSubmitRef` (after line 39):

```ts
  const skipNextSubmitRef = useRef(false)
  const activeRequestIdRef = useRef(0)
```

3. Add an unmount effect (after the `characterWiki`/`hasChanged` destructuring, before `handlePlusPress`, i.e. after line 45):

```ts
  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])
```

4. Replace the entire `handlePlusPress` function with this final version. `requestId` is declared with `let` at the top (defaulting to `0`, meaning "not yet claimed") so `isStaleRequest` is safe to call from the outer `catch` even if the picker itself throws before any request id was ever claimed — `isStaleRequest()` is `false` whenever `requestId` is still `0`. This is the complete, final function — it replaces lines 47-186 of `src/components/ChatComposer.tsx` in their entirety:

```ts
  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    let requestId = 0
    const isStaleRequest = () => requestId !== 0 && activeRequestIdRef.current !== requestId

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      if (typeof asset.size === 'number' && asset.size > MAX_DOCUMENT_RAW_BYTES) {
        setToastMessage('File too large.')
        return
      }
      if (activeRequestIdRef.current === -1) return
      requestId = ++activeRequestIdRef.current

      setPhase('reading')
      onPhaseChange?.('reading')

      const uri = asset.uri
      // Sanitize filename: strip control chars, cap length for stable sourceRef
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      const resolvedMimeType = resolveDocumentMimeType(sourceRef, asset.mimeType)
      const normalizedMimeType = resolvedMimeType?.trim().toLowerCase()
      const isConvertType = Boolean(normalizedMimeType && CONVERT_MIME_TYPES.has(normalizedMimeType))

      let fileContent: string
      try {
        fileContent = isConvertType
          ? await readAsStringAsync(uri, { encoding: 'base64' })
          : await readAsStringAsync(uri)
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to read file.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      let rawText: string
      if (isConvertType && normalizedMimeType) {
        setPhase('converting')
        onPhaseChange?.('converting')
        try {
          const convertResult = await convertDocumentText({
            filename: sourceRef,
            mimeType: normalizedMimeType,
            contentBase64: fileContent,
          })
          rawText = convertResult.data.text
        } catch (error) {
          if (isStaleRequest()) return
          const firebaseCode = (error as { code?: unknown } | null)?.code
          const message = (error as { message?: unknown } | null)?.message
          if (
            firebaseCode === 'functions/failed-precondition' &&
            typeof message === 'string' &&
            message.toLowerCase().includes('insufficient credits')
          ) {
            setToastMessage('Insufficient credits to convert this document.')
          } else if (firebaseCode === 'functions/invalid-argument') {
            setToastMessage('File too large or unsupported format.')
          } else {
            setToastMessage('Failed to convert document.')
          }
          setPhase(null)
          onPhaseChange?.(null)
          return
        }
        if (isStaleRequest()) return
      } else {
        rawText = fileContent
      }

      setPhase('checking')
      onPhaseChange?.('checking')

      let documentChunk: string
      let sourceHash: string
      let changed: boolean
      try {
        // Strip BOM/null bytes and normalize to NFC for consistent cross-platform
        // hashing regardless of editor/OS encoding quirks or conversion source.
        documentChunk = rawText
          .replace(/^\uFEFF/, '')   // strip UTF-8 BOM
          .replace(/\0/g, '')       // strip null bytes
          .normalize('NFC')         // canonical Unicode form
          .replace(/\r\n/g, '\n').replace(/\r/g, '\n')  // normalize line endings
        sourceHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          documentChunk,
        )
        changed = await hasChanged(sourceRef, sourceHash)
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to check for changes.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      if (!changed) {
        setToastMessage(`"${sourceRef}" is already up to date.`)
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

      setPhase('forgetting')
      onPhaseChange?.('forgetting')
      try {
        // Remove stale facts from a previous version of this document before re-ingesting.
        await forget({ sourceRef })
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to remove previous version.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      setPhase(null)
      onPhaseChange?.(null)

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      if (isStaleRequest()) return
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
      if (isStaleRequest()) return
      setPhase(null)
      onPhaseChange?.(null)
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest, onPhaseChange])
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "superseded request|after the component unmounts"`
Expected: PASS for both new tests.

- [ ] **Step 11: Run the full file to check for regressions**

Run: `npm test -- __tests__/chatComposer.test.tsx`
Expected: PASS — every existing native test still passes (single in-flight requests always have `requestId === activeRequestIdRef.current`, so `isStaleRequest()` is always `false` for them).

- [ ] **Step 12: Commit**

```bash
git add src/components/ChatComposer.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): ignore superseded or post-unmount document upload requests"
```

---

## Task 5: Web `ChatComposer.web.tsx` — size pre-check + staleness guard

**Files:**
- Modify: `src/components/ChatComposer.web.tsx`
- Modify: `__tests__/chatComposer.test.tsx`

This mirrors Task 4 exactly, applied to the web variant. The web file has no `readAsStringAsync` (it uses `fetch`/`FileReader` via `readAsBase64Web`), but the size check and staleness guard logic are identical.

### Part A: size pre-check

- [ ] **Step 1: Write the failing test**

Append to `__tests__/chatComposer.test.tsx`:

```ts
  it('rejects oversized files before any read (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 9_000_001 }],
    })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onSend={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      await plusButton.props.onPress()
    })

    expect(capturedSnackbarProps.children).toBe('File too large.')
    expect(onPhaseChange).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('proceeds normally when asset.size is at or below the threshold (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:small.txt', name: 'small.txt', size: 9_000_000 }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })

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

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'small.txt' }),
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "oversized files before any read \\(web\\)"`
Expected: FAIL — no size check yet, so `mockFetch` is called and the toast doesn't match.

- [ ] **Step 3: Write minimal implementation**

In `src/components/ChatComposer.web.tsx`, update the import block (lines 12-16):

```ts
import {
  CONVERT_MIME_TYPES,
  MAX_DOCUMENT_RAW_BYTES,
  resolveDocumentMimeType,
  TEXT_MIME_TYPES,
} from './documentMimeTypes'
```

Then insert the size check right after `const asset = pickerResult.assets[0]` (currently line 78), before `const uri = asset.uri`:

```ts
      const asset = pickerResult.assets[0]
      if (typeof asset.size === 'number' && asset.size > MAX_DOCUMENT_RAW_BYTES) {
        setToastMessage('File too large.')
        return
      }
      const uri = asset.uri
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "oversized files before any read \\(web\\)|at or below the threshold \\(web\\)"`
Expected: PASS for both.

- [ ] **Step 5: Run the full file to check for regressions**

Run: `npm test -- __tests__/chatComposer.test.tsx`
Expected: PASS — all tests, native and web.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatComposer.web.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): reject oversized documents client-side before reading them (web)"
```

### Part B: staleness guard

- [ ] **Step 7: Write the failing test**

Append to `__tests__/chatComposer.test.tsx`:

```ts
  it('ignores a superseded request when a second pick starts before the first resolves (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'blob:first.txt', name: 'first.txt' }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'blob:second.txt', name: 'second.txt' }],
      })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })

    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      const firstPress = plusButton.props.onPress()
      const secondPress = plusButton.props.onPress()
      await Promise.all([firstPress, secondPress])
    })

    expect(mockIngest).toHaveBeenCalledTimes(1)
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'second.txt' }),
    )
  })

  it('ignores an in-flight request after the component unmounts (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })
    let resolveForget: () => void = () => {}
    mockForget.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveForget = resolve
      }),
    )

    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    let pressPromise!: Promise<void>
    await act(async () => {
      pressPromise = plusButton.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    act(() => {
      tree.unmount()
    })

    await act(async () => {
      resolveForget()
      await pressPromise
    })

    expect(mockIngest).not.toHaveBeenCalled()
  })
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "superseded request.*\\(web\\)|after the component unmounts \\(web\\)"`
Expected: FAIL — same reasoning as Task 4 Step 8.

- [ ] **Step 9: Write minimal implementation**

In `src/components/ChatComposer.web.tsx`:

1. Update the React import (line 1):

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
```

2. Add the ref after `const [phase, setPhase] = useState<DocumentUploadPhase>(null)` (line 60):

```ts
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const activeRequestIdRef = useRef(0)
```

3. Add the unmount effect after the `characterWiki` destructuring (after line 63):

```ts
  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])
```

4. Replace the entire `handlePlusPress` function with this final version — the same `requestId`/`isStaleRequest` pattern as the native file in Task 4 Step 9, adapted to this file's `fetch`/`readAsBase64Web` read path (this file has no `skipNextSubmitRef`, so there's nothing else above it to preserve). This is the complete, final function — it replaces lines 65-206 of `src/components/ChatComposer.web.tsx` in their entirety:

```ts
  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    let requestId = 0
    const isStaleRequest = () => requestId !== 0 && activeRequestIdRef.current !== requestId

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      if (typeof asset.size === 'number' && asset.size > MAX_DOCUMENT_RAW_BYTES) {
        setToastMessage('File too large.')
        return
      }
      if (activeRequestIdRef.current === -1) return
      requestId = ++activeRequestIdRef.current

      setPhase('reading')
      onPhaseChange?.('reading')

      const uri = asset.uri
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      const resolvedMimeType = resolveDocumentMimeType(sourceRef, asset.mimeType)
      const normalizedMimeType = resolvedMimeType?.trim().toLowerCase()
      const isConvertType = Boolean(normalizedMimeType && CONVERT_MIME_TYPES.has(normalizedMimeType))

      let fileContent: string
      try {
        if (isConvertType) {
          fileContent = await readAsBase64Web(uri)
        } else {
          const response = await fetch(uri)
          if (!response.ok) {
            throw new Error(`Failed to read file (HTTP ${response.status})`)
          }
          fileContent = await response.text()
        }
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to read file.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      let rawText: string
      if (isConvertType && normalizedMimeType) {
        setPhase('converting')
        onPhaseChange?.('converting')
        try {
          const convertResult = await convertDocumentText({
            filename: sourceRef,
            mimeType: normalizedMimeType,
            contentBase64: fileContent,
          })
          rawText = convertResult.data.text
        } catch (error) {
          if (isStaleRequest()) return
          const firebaseCode = (error as { code?: unknown } | null)?.code
          const message = (error as { message?: unknown } | null)?.message
          if (
            firebaseCode === 'functions/failed-precondition' &&
            typeof message === 'string' &&
            message.toLowerCase().includes('insufficient credits')
          ) {
            setToastMessage('Insufficient credits to convert this document.')
          } else if (firebaseCode === 'functions/invalid-argument') {
            setToastMessage('File too large or unsupported format.')
          } else {
            setToastMessage('Failed to convert document.')
          }
          setPhase(null)
          onPhaseChange?.(null)
          return
        }
        if (isStaleRequest()) return
      } else {
        rawText = fileContent
      }

      setPhase('checking')
      onPhaseChange?.('checking')

      let documentChunk: string
      let sourceHash: string
      let changed: boolean
      try {
        documentChunk = rawText
          .replace(/^\uFEFF/, '')
          .replace(/\0/g, '')
          .normalize('NFC')
          .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        sourceHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          documentChunk,
        )
        changed = await hasChanged(sourceRef, sourceHash)
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to check for changes.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      if (!changed) {
        setToastMessage(`"${sourceRef}" is already up to date.`)
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

      setPhase('forgetting')
      onPhaseChange?.('forgetting')
      try {
        await forget({ sourceRef })
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to remove previous version.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      setPhase(null)
      onPhaseChange?.(null)

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      if (isStaleRequest()) return
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
      if (isStaleRequest()) return
      setPhase(null)
      onPhaseChange?.(null)
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest, onPhaseChange])
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test -- __tests__/chatComposer.test.tsx -t "superseded request.*\\(web\\)|after the component unmounts \\(web\\)"`
Expected: PASS for both.

- [ ] **Step 11: Run the full file to check for regressions**

Run: `npm test -- __tests__/chatComposer.test.tsx`
Expected: PASS — every test in the file, native and web, old and new.

- [ ] **Step 12: Commit**

```bash
git add src/components/ChatComposer.web.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): ignore superseded or post-unmount document upload requests (web)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full root test suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS — no regressions anywhere in the app test suite.

- [ ] **Step 2: Run the full functions test suite**

Run: `cd functions && npm run typecheck && npm run lint && npm run test`
Expected: PASS — no regressions in the functions package.

- [ ] **Step 3: Re-check acceptance criteria from the spec**

Go through `docs/superpowers/specs/2026-06-20-document-upload-reliability-hardening-design.md`'s Acceptance Criteria checklist and confirm each item is satisfied by the tests added in Tasks 1-5. Check the boxes in the spec file itself.

- [ ] **Step 4: Commit the checked-off spec**

```bash
git add docs/superpowers/specs/2026-06-20-document-upload-reliability-hardening-design.md
git commit -m "docs(spec): check off completed reliability hardening acceptance criteria"
```
