# Document Upload Progress Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user phase-by-phase feedback (reading/converting/checking/forgetting) during document ingest, instead of silence until the final `ingest()` call, by adding local `phase` state to `ChatComposer`/`ChatComposer.web` and mirroring it into a `ChatView` banner via a new `onPhaseChange` prop.

**Architecture:** Add a `DocumentUploadPhase` union type defined in `ChatComposer.tsx` (mirrored locally in `ChatComposer.web.tsx`). Each composer keeps local `phase` state, calls an optional `onPhaseChange` prop on every transition, and wraps each step of the existing upload pipeline (read → convert → check → forget → ingest) in its own try/catch so phase resets to `null` and a specific toast fires on every failure path. `ChatView` mirrors that into `documentPhase` state and renders four new banner lines inside the existing live-region container. No changes to `wikiMachine.ts`, `useCharacterWiki.ts`, or `EntityStatus`.

**Tech Stack:** React Native, TypeScript, Jest + react-test-renderer (existing test patterns in `__tests__/chatComposer.test.tsx` and `__tests__/chatViewAccessibility.test.tsx`).

---

## Spec

`docs/superpowers/specs/2026-06-20-document-upload-progress-feedback-design.md`

## Files Touched

- Modify: `src/components/ChatComposer.tsx`
- Modify: `src/components/ChatComposer.web.tsx`
- Modify: `src/components/ChatView.tsx`
- Modify: `__tests__/chatComposer.test.tsx`
- Modify: `__tests__/chatViewAccessibility.test.tsx`

---

### Task 1: `ChatComposer.tsx` (native) — phase state, `onPhaseChange`, per-step error handling

**Files:**
- Modify: `src/components/ChatComposer.tsx`
- Test: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('ChatComposer', ...)` block in `__tests__/chatComposer.test.tsx` (anywhere after the existing `beforeEach`, e.g. right before the closing `})` of the file):

```tsx
  it('emits phase transitions in order reading -> checking -> forgetting -> null, then ingest (native, non-convert)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    const calls: string[] = []
    FileSystemLegacy.readAsStringAsync.mockImplementation(async () => {
      calls.push('read')
      return 'hello world'
    })
    mockHasChanged.mockImplementation(async () => {
      calls.push('hasChanged')
      return true
    })
    mockForget.mockImplementation(async () => {
      calls.push('forget')
    })
    mockIngest.mockImplementation(async () => {
      calls.push('ingest')
      return { chunks: 1 }
    })

    const onPhaseChange = jest.fn((phase: string | null) => calls.push(`phase:${phase}`))
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

    expect(calls).toEqual([
      'phase:reading',
      'read',
      'phase:checking',
      'hasChanged',
      'phase:forgetting',
      'forget',
      'phase:null',
      'ingest',
    ])
  })

  it('emits converting phase before convertDocumentText, then continues through checking/forgetting (native, pdf)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    const calls: string[] = []
    FileSystemLegacy.readAsStringAsync.mockImplementation(async () => {
      calls.push('readBase64')
      return 'base64-bytes'
    })
    mockConvertDocumentText.mockImplementation(async () => {
      calls.push('convert')
      return { data: { text: 'transcribed pdf text', truncated: false } }
    })
    mockHasChanged.mockImplementation(async () => {
      calls.push('hasChanged')
      return true
    })
    mockForget.mockImplementation(async () => {
      calls.push('forget')
    })
    mockIngest.mockImplementation(async () => {
      calls.push('ingest')
      return { chunks: 1 }
    })

    const onPhaseChange = jest.fn((phase: string | null) => calls.push(`phase:${phase}`))
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

    expect(calls).toEqual([
      'phase:reading',
      'readBase64',
      'phase:converting',
      'convert',
      'phase:checking',
      'hasChanged',
      'phase:forgetting',
      'forget',
      'phase:null',
      'ingest',
    ])
  })

  it('resets phase to null and shows a toast when reading the file fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockRejectedValue(new Error('disk error'))

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

    expect(onPhaseChange).toHaveBeenCalledWith('reading')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to read file.')
    expect(mockHasChanged).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when checking for changes fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    mockHasChanged.mockRejectedValue(new Error('boom'))

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

    expect(onPhaseChange).toHaveBeenCalledWith('checking')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to check for changes.')
    expect(mockForget).not.toHaveBeenCalled()
  })

  it('resets phase to null without forgetting/ingesting when document is already up to date (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(false)

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

    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('"doc.txt" is already up to date.')
    expect(mockForget).not.toHaveBeenCalled()
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when removing the stale version fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(true)
    mockForget.mockRejectedValue(new Error('boom'))

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

    expect(onPhaseChange).toHaveBeenCalledWith('forgetting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to remove previous version.')
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null when document conversion fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({ code: 'functions/invalid-argument' })

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

    expect(onPhaseChange).toHaveBeenCalledWith('converting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('File too large or unsupported format.')
  })

  it('shows the spinner while a document phase is active, before isIngesting becomes true (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    mockHasChanged.mockImplementation(() => new Promise(() => {})) // never resolves

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      void plusButton.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    expect(tree.root.findAll((n: any) => n.props?.__iconButtonMock === true).length).toBe(0)
    expect(mockUseCharacterWikiResult.isIngesting).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- __tests__/chatComposer.test.tsx -t "native"`
Expected: FAIL — `onPhaseChange` is never called (prop doesn't exist yet), toast messages don't match ("Failed to read file." etc. aren't produced by current code), and the spinner test fails because the plus button still renders (no `phase` state yet).

- [ ] **Step 3: Implement the phase state and restructured `handlePlusPress`**

In `src/components/ChatComposer.tsx`, replace lines 19–23 (the `ChatComposerProps` type) with:

```tsx
export type DocumentUploadPhase = 'reading' | 'converting' | 'checking' | 'forgetting' | null

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    onPhaseChange?: (phase: DocumentUploadPhase) => void
  }
```

Replace lines 25–133 (the component signature through the end of `handlePlusPress`) with:

```tsx
export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onInputSizeChanged,
  onSend,
  onTextChanged,
  text,
  textInputProps,
  characterId,
  userId,
  onPhaseChange,
  ...props
}: ChatComposerProps<TMessage>) {
  const skipNextSubmitRef = useRef(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const { colors, roundness } = useTheme()

  const characterWiki = useCharacterWiki(characterId ?? '')
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      setPhase('reading')
      onPhaseChange?.('reading')

      const asset = pickerResult.assets[0]
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
        setToastMessage('Failed to read file.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

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
        setToastMessage('Failed to check for changes.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

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
        setToastMessage('Failed to remove previous version.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

      setPhase(null)
      onPhaseChange?.(null)

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
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

Then update the plus-button render condition (originally lines 150–171) so `isIngesting ? (...) : (...)` becomes `(isIngesting || phase !== null) ? (...) : (...)`:

```tsx
        {showPlusButton && (
          (isIngesting || phase !== null) ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Adding document to memory"
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <IconButton
              icon="plus"
              size={20}
              onPress={handlePlusPress}
              style={styles.plusButton}
              accessibilityLabel="Add document to memory"
              accessibilityHint="Opens file picker to add a document to this character's memory"
            />
          )
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- __tests__/chatComposer.test.tsx -t "native"`
Expected: PASS for all native tests (existing + the 8 new ones above).

Then run the full file to make sure nothing regressed:

Run: `npm run test -- __tests__/chatComposer.test.tsx`
Expected: All tests PASS (web tests still pass unchanged since `ChatComposer.web.tsx` hasn't been touched yet).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat-composer): add upload phase feedback to native ChatComposer"
```

---

### Task 2: `ChatComposer.web.tsx` — mirror phase state and per-step error handling

**Files:**
- Modify: `src/components/ChatComposer.web.tsx`
- Test: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('ChatComposer', ...)` block in `__tests__/chatComposer.test.tsx` (after the Task 1 tests):

```tsx
  it('emits phase transitions in order reading -> checking -> forgetting -> null, then ingest (web, non-convert)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    const calls: string[] = []
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => {
        calls.push('read')
        return 'hello world'
      },
    })
    mockHasChanged.mockImplementation(async () => {
      calls.push('hasChanged')
      return true
    })
    mockForget.mockImplementation(async () => {
      calls.push('forget')
    })
    mockIngest.mockImplementation(async () => {
      calls.push('ingest')
      return { chunks: 1 }
    })

    const onPhaseChange = jest.fn((phase: string | null) => calls.push(`phase:${phase}`))
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

    expect(calls).toEqual([
      'phase:reading',
      'read',
      'phase:checking',
      'hasChanged',
      'phase:forgetting',
      'forget',
      'phase:null',
      'ingest',
    ])
  })

  it('emits converting phase before convertDocumentText, then continues through checking/forgetting (web, pdf)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    const calls: string[] = []
    mockFetch.mockResolvedValue({
      ok: true,
      blob: async () => {
        calls.push('readBase64')
        return {}
      },
    })
    mockConvertDocumentText.mockImplementation(async () => {
      calls.push('convert')
      return { data: { text: 'transcribed pdf text', truncated: false } }
    })
    mockHasChanged.mockImplementation(async () => {
      calls.push('hasChanged')
      return true
    })
    mockForget.mockImplementation(async () => {
      calls.push('forget')
    })
    mockIngest.mockImplementation(async () => {
      calls.push('ingest')
      return { chunks: 1 }
    })

    const onPhaseChange = jest.fn((phase: string | null) => calls.push(`phase:${phase}`))
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

    expect(calls).toEqual([
      'phase:reading',
      'readBase64',
      'phase:converting',
      'convert',
      'phase:checking',
      'hasChanged',
      'phase:forgetting',
      'forget',
      'phase:null',
      'ingest',
    ])
  })

  it('resets phase to null and shows a toast when reading the file fails (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

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

    expect(onPhaseChange).toHaveBeenCalledWith('reading')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to read file.')
    expect(mockHasChanged).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when checking for changes fails (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })
    mockHasChanged.mockRejectedValue(new Error('boom'))

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

    expect(onPhaseChange).toHaveBeenCalledWith('checking')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to check for changes.')
    expect(mockForget).not.toHaveBeenCalled()
  })

  it('resets phase to null without forgetting/ingesting when document is already up to date (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })
    mockHasChanged.mockResolvedValue(false)

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

    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('"doc.txt" is already up to date.')
    expect(mockForget).not.toHaveBeenCalled()
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when removing the stale version fails (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })
    mockHasChanged.mockResolvedValue(true)
    mockForget.mockRejectedValue(new Error('boom'))

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

    expect(onPhaseChange).toHaveBeenCalledWith('forgetting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to remove previous version.')
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null when document conversion fails (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockFetch.mockResolvedValue({ ok: true, blob: async () => ({}) })
    mockConvertDocumentText.mockRejectedValue({ code: 'functions/invalid-argument' })

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

    expect(onPhaseChange).toHaveBeenCalledWith('converting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('File too large or unsupported format.')
  })

  it('shows the spinner while a document phase is active, before isIngesting becomes true (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'hello world' })
    mockHasChanged.mockImplementation(() => new Promise(() => {})) // never resolves

    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      void plusButton.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    expect(tree.root.findAll((n: any) => n.props?.__iconButtonMock === true).length).toBe(0)
    expect(mockUseCharacterWikiResult.isIngesting).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- __tests__/chatComposer.test.tsx -t "web"`
Expected: FAIL — same reasons as Task 1 (no `onPhaseChange` prop, generic toasts instead of the new specific ones, plus button still shown during the pending `hasChanged` call).

- [ ] **Step 3: Implement the phase state and restructured `handlePlusPress` in the web file**

In `src/components/ChatComposer.web.tsx`, replace lines 18–22 (the `ChatComposerProps` type) with:

```tsx
type DocumentUploadPhase = 'reading' | 'converting' | 'checking' | 'forgetting' | null

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    onPhaseChange?: (phase: DocumentUploadPhase) => void
  }
```

Replace lines 46–151 (the component signature through the end of `handlePlusPress`) with:

```tsx
export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onSend,
  text,
  textInputProps,
  characterId,
  userId,
  onPhaseChange,
  ...props
}: ChatComposerProps<TMessage>) {
  const { colors, roundness } = useTheme()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)

  const characterWiki = useCharacterWiki(characterId ?? '')
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      setPhase('reading')
      onPhaseChange?.('reading')

      const asset = pickerResult.assets[0]
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
        setToastMessage('Failed to read file.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

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
        setToastMessage('Failed to check for changes.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

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
        setToastMessage('Failed to remove previous version.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

      setPhase(null)
      onPhaseChange?.(null)

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
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

Then update the plus-button render condition (originally lines 187–206), same change as Task 1:

```tsx
        {showPlusButton && (
          (isIngesting || phase !== null) ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Adding document to memory"
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <IconButton
              icon="plus"
              size={20}
              onPress={handlePlusPress}
              style={styles.plusButton}
              accessibilityLabel="Add document to memory"
              accessibilityHint="Opens file picker to add a document to this character's memory"
            />
          )
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- __tests__/chatComposer.test.tsx`
Expected: All tests PASS (native + web, old + new).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer.web.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat-composer): mirror upload phase feedback into web ChatComposer"
```

---

### Task 3: `ChatView.tsx` — `documentPhase` state, prop wiring, banner lines

**Files:**
- Modify: `src/components/ChatView.tsx`
- Test: `__tests__/chatViewAccessibility.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `__tests__/chatViewAccessibility.test.tsx`, the current mock for `ChatComposer` (line 129) is `jest.mock('~/components/ChatComposer', () => () => null)`. Replace it so it captures the props `ChatView` passes down:

```tsx
let capturedChatComposerProps: any = null
jest.mock('~/components/ChatComposer', () => (props: any) => {
  capturedChatComposerProps = props
  return null
})
```

In the `beforeEach` block, reset the captured value alongside the existing resets:

```tsx
  beforeEach(() => {
    jest.clearAllMocks()
    capturedGiftedChatProps = null
    capturedChatComposerProps = null
    mockWikiStatus = { ingesting: false, librarian: false, heal: false }
    mockPlatformOS = 'android'
    mockCreditsData = { totalCredits: 10, nextExpiryDate: null }
    withLoggedInUser()
  })
```

Add these tests inside the `describe('ChatView accessibility', ...)` block (e.g. right after the existing "wiki status region" tests):

```tsx
  // ── document upload phase banner ──────────────────────────────────────────
  it.each([
    ['reading', 'Reading file', '⏳ Reading file…'],
    ['converting', 'Converting document', '⏳ Converting document…'],
    ['checking', 'Checking for changes', '⏳ Checking for changes…'],
    ['forgetting', 'Removing previous version', '⏳ Removing previous version…'],
  ])('shows the %s banner with label %s when ChatComposer reports that phase', (phase, label, text) => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { create(capturedGiftedChatProps.renderComposer({ onSend: jest.fn() })) })

    expect(capturedChatComposerProps).not.toBeNull()
    expect(typeof capturedChatComposerProps.onPhaseChange).toBe('function')

    act(() => { capturedChatComposerProps.onPhaseChange(phase) })

    const allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    const phaseText = allTexts.find((t: any) => t.props.accessibilityLabel === label)
    expect(phaseText).toBeDefined()
    expect(phaseText.props.children).toBe(text)
  })

  it('hides the document-phase banner once ChatComposer reports phase null and no other status is active', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { create(capturedGiftedChatProps.renderComposer({ onSend: jest.fn() })) })

    act(() => { capturedChatComposerProps.onPhaseChange('reading') })
    let allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    expect(allTexts.find((t: any) => t.props.accessibilityLabel === 'Reading file')).toBeDefined()

    act(() => { capturedChatComposerProps.onPhaseChange(null) })
    allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    expect(allTexts.find((t: any) => t.props.accessibilityLabel === 'Reading file')).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- __tests__/chatViewAccessibility.test.tsx -t "banner"`
Expected: FAIL — `capturedChatComposerProps.onPhaseChange` is `undefined` (no such prop is passed yet), so calling it throws / the banner text is never found.

- [ ] **Step 3: Implement `documentPhase` state and banner wiring**

In `src/components/ChatView.tsx`:

Change line 1 from:
```tsx
import React, { useCallback } from 'react'
```
to:
```tsx
import React, { useCallback, useState } from 'react'
```

Change line 16 from:
```tsx
import ChatComposer from '~/components/ChatComposer'
```
to:
```tsx
import ChatComposer, { type DocumentUploadPhase } from '~/components/ChatComposer'
```

After line 47 (`const { status: wikiStatus } = useCharacterWiki(characterId)`), add:
```tsx
  const [documentPhase, setDocumentPhase] = useState<DocumentUploadPhase>(null)
```

Replace the `renderComposer` callback (lines 191–198) with:
```tsx
  const renderComposer = useCallback(
    // GiftedChat currently passes full internal input toolbar props to renderComposer,
    // including onSend from SendProps in addition to ComposerProps.
    (props: ComposerProps & Pick<SendProps<IMessage>, 'onSend'>) => (
      <ChatComposer
        {...props}
        characterId={characterId}
        userId={currentUserId ?? undefined}
        onPhaseChange={setDocumentPhase}
      />
    ),
    [characterId, currentUserId],
  )
```

Replace the banner block (lines 324–339) with:
```tsx
        {(wikiStatus.ingesting || wikiStatus.librarian || escalationState === 'escalating' || documentPhase !== null) && (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
          >
            {documentPhase === 'reading' && (
              <Text style={styles.statusText} accessibilityLabel="Reading file">⏳ Reading file…</Text>
            )}
            {documentPhase === 'converting' && (
              <Text style={styles.statusText} accessibilityLabel="Converting document">⏳ Converting document…</Text>
            )}
            {documentPhase === 'checking' && (
              <Text style={styles.statusText} accessibilityLabel="Checking for changes">⏳ Checking for changes…</Text>
            )}
            {documentPhase === 'forgetting' && (
              <Text style={styles.statusText} accessibilityLabel="Removing previous version">⏳ Removing previous version…</Text>
            )}
            {wikiStatus.ingesting && (
              <Text style={styles.statusText} accessibilityLabel="Ingesting document">⏳ Ingesting document…</Text>
            )}
            {wikiStatus.librarian && (
              <Text style={styles.statusText} accessibilityLabel="Updating memory">🧠 Updating memory…</Text>
            )}
            {escalationState === 'escalating' && (
              <Text style={styles.statusText} accessibilityLabel="Thinking deeply">🧠 Thinking deeply…</Text>
            )}
          </View>
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- __tests__/chatViewAccessibility.test.tsx`
Expected: All tests PASS (existing wiki-status/banner tests + the 5 new document-phase tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatView.tsx __tests__/chatViewAccessibility.test.tsx
git commit -m "feat(chat-view): show document upload phase banner alongside ingest status"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: All test suites PASS, including `__tests__/chatComposer.test.tsx` and `__tests__/chatViewAccessibility.test.tsx`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors. In particular, `DocumentUploadPhase` is exported correctly from `ChatComposer.tsx` and the type-only import in `ChatView.tsx` resolves.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Confirm no unintended changes to the shared wiki machine**

Run: `git diff --stat main -- src/machines/wikiMachine.ts src/hooks/useCharacterWiki.ts`
Expected: Empty output (no changes to either file), confirming the Non-Goals constraint from the spec.

- [ ] **Step 5: Commit (only if Steps 1–4 required fixes)**

If any fixes were needed to pass typecheck/lint, commit them:

```bash
git add -A
git commit -m "fix(chat): address typecheck/lint findings for upload phase feedback"
```

If no fixes were needed, skip this step — Task 1–3 commits already cover the change.

---

## Acceptance Criteria (from spec)

- [ ] Spinner on plus button appears immediately after a file is picked, not just during final ingest
- [ ] Top banner shows distinct text for reading/converting/checking/forgetting phases, each with correct `accessibilityLabel`, inside the existing live-region-announced container
- [ ] Each failure-prone step has its own toast message per the spec's error-handling table
- [ ] `phase`/`documentPhase` always resets to `null` on every exit path (success, no-op, every error)
- [ ] No changes to `wikiMachine.ts`, `useCharacterWiki.ts`, or `EntityStatus`
- [ ] `npm run typecheck && npm run lint && npm run test` green at root
