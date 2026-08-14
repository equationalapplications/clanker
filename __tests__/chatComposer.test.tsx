import React from 'react'
import { act, create } from 'react-test-renderer'
import { render, fireEvent, waitFor } from '@testing-library/react-native'

const mockHasChanged = jest.fn().mockResolvedValue(true)
const mockForget = jest.fn().mockResolvedValue(undefined)
const mockIngest = jest.fn().mockResolvedValue({ chunks: 1 })
const mockText = jest.fn()
const mockBase64 = jest.fn()
const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockSync = jest.fn()
const mockUseCharacterWikiResult = {
  status: { ingesting: false, librarian: false, heal: false },
  isBusy: false,
  isIngesting: false,
  error: null,
  read: mockRead,
  write: mockWrite,
  ingest: (...args: unknown[]) => mockIngest(...args),
  forget: (...args: unknown[]) => mockForget(...args),
  sync: mockSync,
  hasChanged: (...args: unknown[]) => mockHasChanged(...args),
}
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
}))
jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: () => mockUseCharacterWikiResult,
}))

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
}))

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    text = mockText
    base64 = mockBase64
  },
}))

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('abc123'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

const mockConvertDocumentText = jest.fn()
jest.mock('~/services/apiClient', () => ({
  convertDocumentText: (...args: unknown[]) => mockConvertDocumentText(...args),
}))
const convertDocumentText = mockConvertDocumentText
const ingest = mockIngest
const mockCaptureFromCamera = jest.fn()
const mockPickFromLibrary = jest.fn()
const mockPrepareFromAsset = jest.fn()
jest.mock('~/hooks/useChatPhotoUpload', () => ({
  useChatPhotoUpload: () => ({
    prepareFromAsset: (...args: unknown[]) => mockPrepareFromAsset(...args),
    pickFromLibrary: (...args: unknown[]) => mockPickFromLibrary(...args),
    captureFromCamera: (...args: unknown[]) => mockCaptureFromCamera(...args),
    isPreparing: false,
    error: null,
    clearError: jest.fn(),
  }),
}))
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}))
const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

class MockFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onloadend: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(_blob: unknown) {
    this.result = 'data:application/pdf;base64,d2ViLWJhc2U2NA=='
    this.onload?.()
    this.onloadend?.()
  }
}
global.FileReader = MockFileReader as unknown as typeof FileReader

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: () => ({ isSubscriber: false }),
}))

let capturedSnackbarProps: any = null

jest.mock('react-native-paper', () => {
  const React = require('react')
  const { View, Text: RNText } = require('react-native')
  return {
    IconButton: (props: any) => {
      // Tag the plus button so tests can find the attachment-menu anchor.
      const tag = props.icon === 'plus' ? { __iconButtonMock: true } : {}
      // Same reason as the Button mock: a View ignores `disabled`, so without
      // this a disabled button would still fire its handler under test. No-op
      // rather than `undefined` so RNTL does not climb to an ancestor handler.
      return React.createElement(View, {
        ...tag,
        ...props,
        onPress: props.disabled ? () => {} : props.onPress,
        accessibilityState: { disabled: !!props.disabled },
      })
    },
    Snackbar: (props: any) => {
      capturedSnackbarProps = props
      return null
    },
    Portal: ({ children }: any) => children,
    Button: ({ children, onPress, disabled }: any) =>
      // Honour `disabled` — a bare RNText ignores it, which would let
      // `fireEvent.press` fire handlers the real Paper Button blocks and hide
      // any regression that drops the prop. The disabled case gets a no-op
      // rather than `undefined` because RNTL walks up to an ancestor handler
      // when the pressed element has none, which would defeat the assertion.
      React.createElement(
        RNText,
        {
          onPress: disabled ? () => {} : onPress,
          accessibilityState: { disabled: !!disabled },
        },
        children,
      ),
    Dialog: Object.assign(
      ({ children, visible, onDismiss }: any) =>
        visible ? React.createElement(View, { onDismiss }, children) : null,
      {
        Title: ({ children }: any) => React.createElement(RNText, null, children),
        Content: ({ children }: any) => React.createElement(RNText, null, children),
        Actions: ({ children }: any) => React.createElement(RNText, null, children),
      },
    ),
    Menu: require('./helpers/paperMenuMock').createMenuMock(React, RNText, { tagItems: true }),
    Text: ({ children }: any) => React.createElement(RNText, null, children),
    useTheme: () => ({
      colors: { primary: '#6200ee', surfaceVariant: '#333', onSurfaceVariant: '#fff' },
      roundness: 4,
    }),
  }
})

jest.mock('~/components/composer/IngestProgressBar', () => () => null)

describe('ChatComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasChanged.mockResolvedValue(true)
    mockForget.mockResolvedValue(undefined)
    mockIngest.mockResolvedValue({ chunks: 1 })
    mockRead.mockReset()
    mockWrite.mockReset()
    mockSync.mockReset()
    mockText.mockReset()
    mockBase64.mockReset()
    mockConvertDocumentText.mockReset()
    mockFetch.mockReset()
    mockConvertDocumentText.mockResolvedValue({
      data: { text: 'converted text', truncated: false },
    })
    mockUseCharacterWikiResult.status = { ingesting: false, librarian: false, heal: false }
    mockUseCharacterWikiResult.isBusy = false
    mockUseCharacterWikiResult.isIngesting = false
    mockUseCharacterWikiResult.error = null
    capturedSnackbarProps = null
    jest.useRealTimers()
  })

  // Drive the attachment menu the way a user does: open it from the plus
  // anchor, then act on an item. All document-ingest tests share this path —
  // the behavior under test starts at DocumentPicker.
  async function openAttachMenu(tree: ReturnType<typeof create>): Promise<any> {
    const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
    await act(async () => {
      plusButton.props.onPress()
    })
    return tree.root.find((n: any) => n.props?.__attachMenuItemMock === 'Add document')
  }

  async function pressPlusAndPickDocument(tree: ReturnType<typeof create>) {
    const addDocumentItem = await openAttachMenu(tree)
    await act(async () => {
      await addDocumentItem.props.onPress()
    })
  }

  it('sends on web when Enter is pressed without Shift', () => {
    // Force Platform.OS to 'web' so the onKeyPress handler the wrapper
    // installs on web fires; the same code path is a no-op on native.
    const Platform = require('react-native').Platform
    const originalOs = Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })

    const onSend = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text="  hello world  "
          onChangeText={jest.fn()}
          onSubmit={onSend}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })

    // react-native-web ignores `submitBehavior`, so the wrapper installs an
    // onKeyPress handler that fires `onSubmit` on Enter without Shift.
    act(() => {
      composer.props.onKeyPress({ nativeEvent: { key: 'Enter', shiftKey: false } })
    })

    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true })
    expect(onSend).toHaveBeenCalled()
  })

  it('keeps newline path on web when Shift+Enter is pressed', () => {
    const Platform = require('react-native').Platform
    const originalOs = Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })

    const onSend = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text="hello world"
          onChangeText={jest.fn()}
          onSubmit={onSend}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })

    // Shift+Enter must NOT fire onSubmit — the wrapper's onKeyPress handler
    // only submits on Enter without Shift.
    act(() => {
      composer.props.onKeyPress({ nativeEvent: { key: 'Enter', shiftKey: true } })
    })
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true })
    expect(onSend).not.toHaveBeenCalled()

    // Sanity-check the wrapper still exposes the multiline contract that
    // the native TextInput relies on for Shift+Enter → newline.
    expect(composer.props.multiline).toBe(true)
    expect(composer.props.submitBehavior).toBe('submit')
    expect(composer.props.returnKeyType).toBe('send')
  })

  it('does not send on web when Enter is pressed with whitespace-only text', () => {
    // The unified composer no longer trims inside its onSubmitEditing — that
    // check moved up to ChatInputBar's handleSubmit, which owns the text
    // state. The wrapper exposes the prop chain that lets the parent decide:
    // onSubmitEditing fires unconditionally; the parent decides what to send.
    // Verify that contract by passing an onSubmit that mirrors the ChatInputBar
    // behaviour — refuse to forward when trimmed is empty.
    const onSend = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    const onSubmit = jest.fn((trimmed: string) => {
      if (trimmed) onSend({ text: trimmed }, true)
    })
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text="   "
          onChangeText={jest.fn()}
          onSubmit={onSubmit}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })

    act(() => {
      composer.props.onSubmitEditing()
    })

    expect(onSubmit).toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
  it('submits on native when submit editing fires', () => {
    const onSend = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text="  hi native  "
          onChangeText={jest.fn()}
          onSubmit={onSend}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })

    expect(composer.props.submitBehavior).toBe('submit')
    expect(composer.props.returnKeyType).toBe('send')

    act(() => {
      composer.props.onSubmitEditing()
    })

    expect(onSend).toHaveBeenCalled()
  })

  it('does not send on native submit when text is whitespace-only', () => {
    // Same as the web whitespace case above: ChatComposer no longer trims.
    // ChatInputBar does the trim-and-skip-empty gate. Verify the
    // wrapper's contract: it fires onSubmitEditing; the parent decides.
    const onSend = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    const onSubmit = jest.fn((trimmed: string) => {
      if (trimmed) onSend({ text: trimmed }, true)
    })
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text="   "
          onChangeText={jest.fn()}
          onSubmit={onSubmit}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })

    act(() => {
      composer.props.onSubmitEditing()
    })

    expect(onSubmit).toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sets accessibilityLabel on input for native', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    expect(composer.props.accessibilityLabel).toBe('Message input')
  })

  it('sets accessibilityLabel on input for web', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const composer = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    expect(composer.props.accessibilityLabel).toBe('Message input')
  })

  it('native snackbar has accessibilityRole "alert" and polite live region', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    act(() => {
      create(<ChatComposer text="" onChangeText={jest.fn()} onSubmit={jest.fn()} />)
    })

    expect(capturedSnackbarProps).not.toBeNull()
    expect(capturedSnackbarProps.accessibilityRole).toBe('alert')
    expect(capturedSnackbarProps.accessibilityLiveRegion).toBe('polite')
  })

  it('web snackbar has accessibilityRole "alert" and polite live region', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    act(() => {
      create(<ChatComposer text="" onChangeText={jest.fn()} onSubmit={jest.fn()} />)
    })

    expect(capturedSnackbarProps).not.toBeNull()
    expect(capturedSnackbarProps.accessibilityRole).toBe('alert')
    expect(capturedSnackbarProps.accessibilityLiveRegion).toBe('polite')
  })

  it('renders + ingest button for free-tier users (native) when characterId and userId are provided', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBeGreaterThan(0)
    expect(plusButton[0].props.icon).toBe('plus')
  })

  it('renders + ingest button for free-tier users (web) when characterId and userId are provided', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBeGreaterThan(0)
    expect(plusButton[0].props.icon).toBe('plus')
  })

  it('shows an ingest spinner while memory ingest is in progress (native)', () => {
    mockUseCharacterWikiResult.isIngesting = true
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBe(0)
  })

  it('shows an ingest spinner while memory ingest is in progress (web)', () => {
    mockUseCharacterWikiResult.isIngesting = true
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBe(0)
  })

  it('delegates ingest flow through useCharacterWiki methods', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    Crypto.digestStringAsync.mockResolvedValue('hash123')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockHasChanged).toHaveBeenCalledWith('doc.txt', 'hash123')
    expect(mockForget).toHaveBeenCalledWith({ sourceRef: 'doc.txt' })
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'doc.txt',
        sourceHash: 'hash123',
        documentChunk: 'hello world',
        promptOverride: expect.any(String),
      }),
    )
  })

  it('converts PDF documents via convertDocumentText before ingesting (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockBase64.mockResolvedValue('base64-bytes')
    Crypto.digestStringAsync.mockResolvedValue('hash456')
    mockConvertDocumentText.mockResolvedValue({
      data: { text: 'transcribed pdf text', truncated: false },
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockBase64).toHaveBeenCalled()
    expect(mockText).not.toHaveBeenCalled()
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

  it('converts PDF documents via convertDocumentText when mimeType is missing (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf' }],
    })
    mockBase64.mockResolvedValue('base64-bytes')
    Crypto.digestStringAsync.mockResolvedValue('hash456')
    mockConvertDocumentText.mockResolvedValue({
      data: { text: 'transcribed pdf text', truncated: false },
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockBase64).toHaveBeenCalled()
    expect(mockText).not.toHaveBeenCalled()
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

  it('converts PDF documents via convertDocumentText when mimeType is missing (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf' }],
    })
    // The unified composer reads via ExpoFile.base64() on both web and native;
    // the old web-specific fetch + FileReader path is gone.
    mockBase64.mockResolvedValue('base64-bytes')
    Crypto.digestStringAsync.mockResolvedValue('hash789')
    mockConvertDocumentText.mockResolvedValue({
      data: { text: 'transcribed pdf text', truncated: false },
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockBase64).toHaveBeenCalled()
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

  it('converts PDF documents via convertDocumentText before ingesting (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    // Unified composer uses ExpoFile.base64() on web too; see the (native)
    // counterpart above for the same flow.
    mockBase64.mockResolvedValue('base64-bytes')
    Crypto.digestStringAsync.mockResolvedValue('hash789')
    mockConvertDocumentText.mockResolvedValue({
      data: { text: 'transcribed pdf text', truncated: false },
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockBase64).toHaveBeenCalled()
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
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockBase64.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'Insufficient credits to convert document.',
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockIngest).not.toHaveBeenCalled()
    expect(capturedSnackbarProps.children).toBe('Out of Power — recharge to keep chatting.')
  })

  it('maps non-credit failed-precondition from convertDocumentText to a generic toast (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockBase64.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'Account setup incomplete.',
    })

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockIngest).not.toHaveBeenCalled()
    expect(capturedSnackbarProps.children).toBe('Failed to convert document.')
  })

  it('emits phase transitions in order reading -> checking -> forgetting -> null, then ingest (native, non-convert)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    const calls: string[] = []
    mockText.mockImplementation(async () => {
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
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    const calls: string[] = []
    mockBase64.mockImplementation(async () => {
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
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockRejectedValue(new Error('disk error'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenCalledWith('reading')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to read file.')
    expect(mockHasChanged).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when checking for changes fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockRejectedValue(new Error('boom'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenCalledWith('checking')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to check for changes.')
    expect(mockForget).not.toHaveBeenCalled()
  })

  it('resets phase to null without forgetting/ingesting when document is already up to date (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(false)

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('"doc.txt" is already up to date.')
    expect(mockForget).not.toHaveBeenCalled()
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null and shows a toast when removing the stale version fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(true)
    mockForget.mockRejectedValue(new Error('boom'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenCalledWith('forgetting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('Failed to remove previous version.')
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('resets phase to null when document conversion fails (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }],
    })
    mockBase64.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({ code: 'functions/invalid-argument' })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenCalledWith('converting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('File too large or unsupported format.')
  })

  it('rejects oversized files before any read (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 9_000_001 },
      ],
    })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(capturedSnackbarProps.children).toBe('File too large.')
    expect(onPhaseChange).not.toHaveBeenCalled()
    expect(mockText).not.toHaveBeenCalled()
    expect(mockBase64).not.toHaveBeenCalled()
  })

  it('proceeds normally when asset.size is at or below the threshold (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://small.txt', name: 'small.txt', size: 9_000_000 }],
    })
    mockText.mockResolvedValue('hello world')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'small.txt' }))
  })

  it('ignores a superseded request when a second pick starts before the first resolves (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://first.txt', name: 'first.txt' }],
      })
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file://second.txt', name: 'second.txt' }],
      })
    mockText.mockResolvedValue('hello world')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    await act(async () => {
      const firstPress = addDocumentItem.props.onPress()
      const secondPress = addDocumentItem.props.onPress()
      await Promise.all([firstPress, secondPress])
    })

    expect(mockIngest).toHaveBeenCalledTimes(1)
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'second.txt' }))
    expect(capturedSnackbarProps.children).not.toBe('"first.txt" is already up to date.')
  })

  it('ignores an in-flight request after the component unmounts (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    let resolveForget: () => void = () => {}
    mockForget.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveForget = resolve
        }),
    )

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    let pressPromise!: Promise<void>
    await act(async () => {
      pressPromise = addDocumentItem.props.onPress()
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

  it('shows the spinner while a document phase is active, before isIngesting becomes true (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockImplementation(() => new Promise(() => {})) // never resolves

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    await act(async () => {
      void addDocumentItem.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    expect(tree.root.findAll((n: any) => n.props?.__iconButtonMock === true).length).toBe(0)
    expect(mockUseCharacterWikiResult.isIngesting).toBe(false)
  })

  it('emits phase transitions in order reading -> checking -> forgetting -> null, then ingest (web, non-convert)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    const calls: string[] = []
    // Unified composer reads text via ExpoFile.text() on web too.
    mockText.mockImplementation(async () => {
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
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    // Unified composer reads PDFs via ExpoFile.base64() on web too.
    mockBase64.mockImplementation(async () => {
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
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    // Unified composer reads via ExpoFile.text() on web too — reject it.
    mockText.mockRejectedValue(new Error('disk error'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockRejectedValue(new Error('boom'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(false)

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockResolvedValue(true)
    mockForget.mockRejectedValue(new Error('boom'))

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

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
    mockBase64.mockResolvedValue('base64-bytes')
    mockConvertDocumentText.mockRejectedValue({ code: 'functions/invalid-argument' })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(onPhaseChange).toHaveBeenCalledWith('converting')
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
    expect(capturedSnackbarProps.children).toBe('File too large or unsupported format.')
  })

  it('rejects oversized files before any read (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'blob:big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 9_000_001 },
      ],
    })

    const onPhaseChange = jest.fn()
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onPhaseChange={onPhaseChange}
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(capturedSnackbarProps.children).toBe('File too large.')
    expect(onPhaseChange).not.toHaveBeenCalled()
    expect(mockBase64).not.toHaveBeenCalled()
    expect(mockText).not.toHaveBeenCalled()
  })

  it('proceeds normally when asset.size is at or below the threshold (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:small.txt', name: 'small.txt', size: 9_000_000 }],
    })
    mockText.mockResolvedValue('hello world')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    await pressPlusAndPickDocument(tree)

    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'small.txt' }))
  })

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
    mockText.mockResolvedValue('hello world')

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    await act(async () => {
      const firstPress = addDocumentItem.props.onPress()
      const secondPress = addDocumentItem.props.onPress()
      await Promise.all([firstPress, secondPress])
    })

    expect(mockIngest).toHaveBeenCalledTimes(1)
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'second.txt' }))
  })

  it('ignores an in-flight request after the component unmounts (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    let resolveForget: () => void = () => {}
    mockForget.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveForget = resolve
        }),
    )

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    let pressPromise!: Promise<void>
    await act(async () => {
      pressPromise = addDocumentItem.props.onPress()
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

  it('shows the spinner while a document phase is active, before isIngesting becomes true (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.txt', name: 'doc.txt' }],
    })
    mockText.mockResolvedValue('hello world')
    mockHasChanged.mockImplementation(() => new Promise(() => {})) // never resolves

    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )
    })

    const addDocumentItem = await openAttachMenu(tree)
    await act(async () => {
      void addDocumentItem.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const spinner = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Adding document to memory',
    )
    expect(spinner.length).toBeGreaterThan(0)
    expect(tree.root.findAll((n: any) => n.props?.__iconButtonMock === true).length).toBe(0)
    expect(mockUseCharacterWikiResult.isIngesting).toBe(false)
  })

  describe('image pick: send vs memory (Task 15)', () => {
    beforeEach(() => {
      mockCaptureFromCamera.mockReset()
      mockPickFromLibrary.mockReset()
      mockPrepareFromAsset.mockReset()
    })

    it('prompts send-vs-memory when the pick is an image', async () => {
      const DocumentPicker = require('expo-document-picker')
      DocumentPicker.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          { uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 },
        ],
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, findByText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      fireEvent.press(await findByText('Add document'))

      expect(await findByText('Send in chat')).toBeTruthy()
      expect(await findByText('Add to memory')).toBeTruthy()
      expect(convertDocumentText).not.toHaveBeenCalled()
    })

    it('does not prompt for a text document and still ingests it', async () => {
      const DocumentPicker = require('expo-document-picker')
      DocumentPicker.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          { uri: 'file:///notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 100 },
        ],
      })
      mockText.mockResolvedValue('hello world')

      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, getByText, queryByText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByText('Add document'))
      })

      expect(queryByText('Send in chat')).toBeNull()
      await waitFor(() => expect(ingest).toHaveBeenCalled())
    })

    it('offers no photo option when the character cannot use the cloud agent', async () => {
      const DocumentPicker = require('expo-document-picker')
      DocumentPicker.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          { uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 },
        ],
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, findByText, queryByText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto={false}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      fireEvent.press(await findByText('Add document'))

      // Never silently degraded to a text-only turn: the option is present and
      // disabled with a reason, so the user is not left with a character that
      // answers confidently about an image it never received.
      expect(await findByText(/only cloud-synced characters can see photos/i)).toBeTruthy()
      expect(queryByText('Add to memory')).toBeTruthy()

      // The disabled button must actually block the send, not merely look
      // disabled — this is what the Button mock's `disabled` handling pins.
      fireEvent.press(await findByText('Send in chat'))
      expect(mockPrepareFromAsset).not.toHaveBeenCalled()
    })

    it('blocks photo entry while a turn is in flight, without blaming cloud sync', async () => {
      const DocumentPicker = require('expo-document-picker')
      DocumentPicker.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          { uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 },
        ],
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const { getByLabelText, findByText, queryByText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto
          isSending
          onSendPhoto={onSendPhoto}
        />,
      )

      // The menu's photo items are direct-to-chat entry points, so they must
      // be inert while busy.
      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Take photo'))
        fireEvent.press(getByLabelText('Choose from library'))
      })
      expect(mockCaptureFromCamera).not.toHaveBeenCalled()
      expect(mockPickFromLibrary).not.toHaveBeenCalled()

      fireEvent.press(getByLabelText('Add document'))
      fireEvent.press(await findByText('Send in chat'))
      expect(mockPrepareFromAsset).not.toHaveBeenCalled()
      expect(onSendPhoto).not.toHaveBeenCalled()

      // The reason shown must be the real one. Reusing the cloud-sync copy here
      // would tell a cloud-synced user their character cannot see photos.
      expect(await findByText(/wait for the current reply to finish/i)).toBeTruthy()
      expect(queryByText(/only cloud-synced characters can see photos/i)).toBeNull()

      // Filing a document into memory is unrelated to the chat turn.
      expect(queryByText('Add to memory')).toBeTruthy()
    })

    it('sends a captured photo straight to chat', async () => {
      mockCaptureFromCamera.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///snap.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const { getByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Take photo'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(convertDocumentText).not.toHaveBeenCalled()
    })

    it('keeps the typed caption when onSendPhoto rejects the photo turn', async () => {
      // Pre-fix: onSendPhoto fired and then onChangeText('') wiped the input
      // unconditionally. If the cloud turn failed (network, credits, etc.)
      // the user lost their typed caption. The fix is to await onSendPhoto
      // and only clear on success — a regression here would force the user
      // to retype their caption after a transient failure.
      mockCaptureFromCamera.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///snap.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(false)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Take photo'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(onChangeText).not.toHaveBeenCalled()
    })

    it('clears the typed caption when onSendPhoto accepts the photo turn', async () => {
      mockCaptureFromCamera.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///snap.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Take photo'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      await waitFor(() => expect(onChangeText).toHaveBeenCalledWith(''))
    })
  })

  describe('attachment menu', () => {
    beforeEach(() => {
      mockCaptureFromCamera.mockReset()
      mockPickFromLibrary.mockReset()
      mockPrepareFromAsset.mockReset()
    })

    it('opens the attachment menu with all three actions when photos are supported', () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, queryByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto
          onSendPhoto={jest.fn()}
        />,
      )

      // A closed menu exposes no actions.
      expect(queryByLabelText('Take photo')).toBeNull()
      expect(queryByLabelText('Choose from library')).toBeNull()
      expect(queryByLabelText('Add document')).toBeNull()

      fireEvent.press(getByLabelText('Attach a photo or document'))

      expect(getByLabelText('Take photo')).toBeTruthy()
      expect(getByLabelText('Choose from library')).toBeTruthy()
      expect(getByLabelText('Add document')).toBeTruthy()
    })

    it('sends a library photo straight to chat', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const { getByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(mockCaptureFromCamera).not.toHaveBeenCalled()
    })

    it('keeps the typed caption when a library photo send is rejected', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(false)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(onChangeText).not.toHaveBeenCalled()
    })

    it('clears the typed caption when a library photo send succeeds', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      await waitFor(() => expect(onChangeText).toHaveBeenCalledWith(''))
    })

    it('hides the photo items when the character cannot use the cloud agent', () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, queryByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto={false}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))

      expect(queryByLabelText('Take photo')).toBeNull()
      expect(queryByLabelText('Choose from library')).toBeNull()
      expect(getByLabelText('Add document')).toBeTruthy()
    })

    it('disables the photo items while a reply is in flight but keeps Add document enabled', async () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto
          isSending
          onSendPhoto={jest.fn()}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))

      const takePhoto = getByLabelText('Take photo')
      const chooseFromLibrary = getByLabelText('Choose from library')
      expect(takePhoto.props.accessibilityState).toEqual({ disabled: true })
      expect(chooseFromLibrary.props.accessibilityState).toEqual({ disabled: true })
      expect(getByLabelText('Add document').props.accessibilityState).toEqual({ disabled: false })

      // Disabled must actually block the handlers, not merely look disabled.
      await act(async () => {
        fireEvent.press(takePhoto)
        fireEvent.press(chooseFromLibrary)
      })
      expect(mockCaptureFromCamera).not.toHaveBeenCalled()
      expect(mockPickFromLibrary).not.toHaveBeenCalled()
    })
  })
})
