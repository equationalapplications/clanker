import React from 'react'
import { act, create } from 'react-test-renderer'

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')

  return {
    Composer: (props: any) => React.createElement('Composer', { __chatComposerMock: true, ...props }),
  }
})

const mockHasChanged = jest.fn().mockResolvedValue(true)
const mockForget = jest.fn().mockResolvedValue(undefined)
const mockIngest = jest.fn().mockResolvedValue({ chunks: 1 })
const mockText = jest.fn()
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
  },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}))

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}))

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('abc123'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

const mockConvertDocumentText = jest.fn()
jest.mock('~/services/apiClient', () => ({
  convertDocumentText: (...args: unknown[]) => mockConvertDocumentText(...args),
}))
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

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: () => ({ isSubscriber: false }),
}))

let capturedSnackbarProps: any = null

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    IconButton: (props: any) => React.createElement('IconButton', { __iconButtonMock: true, ...props }),
    Snackbar: (props: any) => {
      capturedSnackbarProps = props
      return null
    },
    Portal: ({ children }: any) => children,
    useTheme: () => ({ colors: { primary: '#6200ee', surfaceVariant: '#333', onSurfaceVariant: '#fff' }, roundness: 4 }),
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
    mockConvertDocumentText.mockReset()
    mockFetch.mockReset()
    mockConvertDocumentText.mockResolvedValue({ data: { text: 'converted text', truncated: false } })
    mockUseCharacterWikiResult.status = { ingesting: false, librarian: false, heal: false }
    mockUseCharacterWikiResult.isBusy = false
    mockUseCharacterWikiResult.isIngesting = false
    mockUseCharacterWikiResult.error = null
    capturedSnackbarProps = null
    jest.useRealTimers()
  })

  it('sends on web when Enter is pressed without Shift', () => {
    const onSend = jest.fn()
    const preventDefault = jest.fn()
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(<ChatComposer text="  hello world  " onSend={onSend} />)
    })

    const composer = tree.root.findByProps({ __chatComposerMock: true })

    act(() => {
      composer.props.textInputProps.onKeyPress({
        nativeEvent: {
          key: 'Enter',
          shiftKey: false,
        },
        preventDefault,
      })
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith({ text: 'hello world' }, true)
  })

  it('keeps newline path on web when Shift+Enter is pressed', () => {
    const onSend = jest.fn()
    const preventDefault = jest.fn()
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(<ChatComposer text="hello world" onSend={onSend} />)
    })

    const composer = tree.root.findByProps({ __chatComposerMock: true })

    act(() => {
      composer.props.textInputProps.onKeyPress({
        nativeEvent: {
          key: 'Enter',
          shiftKey: true,
        },
        preventDefault,
      })
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send on web when Enter is pressed with whitespace-only text', () => {
    const onSend = jest.fn()
    const preventDefault = jest.fn()
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(<ChatComposer text="   " onSend={onSend} />)
    })

    const composer = tree.root.findByProps({ __chatComposerMock: true })

    act(() => {
      composer.props.textInputProps.onKeyPress({
        nativeEvent: {
          key: 'Enter',
          shiftKey: false,
        },
        preventDefault,
      })
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })
    it('submits on native when submit editing fires', () => {
        const onSend = jest.fn()
        const ChatComposer = require('~/components/ChatComposer').default
        let tree!: ReturnType<typeof create>

        act(() => {
            tree = create(<ChatComposer text="  hi native  " onSend={onSend} />)
        })

        const composer = tree.root.findByProps({ __chatComposerMock: true })

        expect(composer.props.textInputProps.submitBehavior).toBe('submit')
        expect(composer.props.textInputProps.returnKeyType).toBe('send')

        act(() => {
            composer.props.textInputProps.onSubmitEditing({ nativeEvent: { text: '  hi native  ' } })
        })

        expect(onSend).toHaveBeenCalledWith({ text: 'hi native' }, true)
    })

    it('adds newline on native when Shift+Enter is pressed and skips submit send', () => {
        const onSend = jest.fn()
        const onTextChanged = jest.fn()
        const ChatComposer = require('~/components/ChatComposer').default
        let tree!: ReturnType<typeof create>

        act(() => {
            tree = create(<ChatComposer text="line one" onSend={onSend} onTextChanged={onTextChanged} />)
        })

        const composer = tree.root.findByProps({ __chatComposerMock: true })

        act(() => {
            composer.props.textInputProps.onKeyPress({
                nativeEvent: {
                    key: 'Enter',
                    shiftKey: true,
                },
            })
        })

        expect(onTextChanged).toHaveBeenCalledWith('line one\n')

        act(() => {
            composer.props.textInputProps.onSubmitEditing({ nativeEvent: { text: 'line one' } })
        })

        expect(onSend).not.toHaveBeenCalled()
    })

    it('resets native skip flag when Shift+Enter does not trigger submit event', () => {
        jest.useFakeTimers()

        const onSend = jest.fn()
        const onTextChanged = jest.fn()
        const ChatComposer = require('~/components/ChatComposer').default
        let tree!: ReturnType<typeof create>

        act(() => {
            tree = create(<ChatComposer text="ready" onSend={onSend} onTextChanged={onTextChanged} />)
        })

        const composer = tree.root.findByProps({ __chatComposerMock: true })

        act(() => {
            composer.props.textInputProps.onKeyPress({
                nativeEvent: {
                    key: 'Enter',
                    shiftKey: true,
                },
            })
        })

        act(() => {
            jest.runOnlyPendingTimers()
        })

        act(() => {
            composer.props.textInputProps.onSubmitEditing({ nativeEvent: { text: 'ready' } })
        })

        expect(onSend).toHaveBeenCalledWith({ text: 'ready' }, true)
    })

    it('does not send on native submit when text is whitespace-only', () => {
        const onSend = jest.fn()
        const ChatComposer = require('~/components/ChatComposer').default
        let tree!: ReturnType<typeof create>

        act(() => {
            tree = create(<ChatComposer text="   " onSend={onSend} />)
        })

        const composer = tree.root.findByProps({ __chatComposerMock: true })

        act(() => {
            composer.props.textInputProps.onSubmitEditing({ nativeEvent: { text: '   ' } })
        })

        expect(onSend).not.toHaveBeenCalled()
    })

  it('sets accessibilityLabel on input for native', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(<ChatComposer text="" onSend={jest.fn()} />)
    })

    const composer = tree.root.findByProps({ __chatComposerMock: true })
    expect(composer.props.textInputProps.accessibilityLabel).toBe('Message input')
  })


  it('sets accessibilityLabel on input for web', () => {
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(<ChatComposer text="" onSend={jest.fn()} />)
    })

    const composer = tree.root.findByProps({ __chatComposerMock: true })
    expect(composer.props.textInputProps.accessibilityLabel).toBe('Message input')
  })

  it('native snackbar has accessibilityRole "alert" and polite live region', () => {
    const ChatComposer = require('~/components/ChatComposer').default
    act(() => {
      create(<ChatComposer text="" onSend={jest.fn()} />)
    })

    expect(capturedSnackbarProps).not.toBeNull()
    expect(capturedSnackbarProps.accessibilityRole).toBe('alert')
    expect(capturedSnackbarProps.accessibilityLiveRegion).toBe('polite')
  })

  it('web snackbar has accessibilityRole "alert" and polite live region', () => {
    const ChatComposer = require('~/components/ChatComposer.web').default
    act(() => {
      create(<ChatComposer text="" onSend={jest.fn()} />)
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
          onSend={jest.fn()}
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
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer
          text=""
          onSend={jest.fn()}
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
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const spinner = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Adding document to memory')
    expect(spinner.length).toBeGreaterThan(0)
    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBe(0)
  })

  it('shows an ingest spinner while memory ingest is in progress (web)', () => {
    mockUseCharacterWikiResult.isIngesting = true
    const ChatComposer = require('~/components/ChatComposer.web').default
    let tree!: ReturnType<typeof create>

    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    const spinner = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Adding document to memory')
    expect(spinner.length).toBeGreaterThan(0)
    const plusButton = tree.root.findAll((n: any) => n.props?.__iconButtonMock === true)
    expect(plusButton.length).toBe(0)
  })

  it('delegates ingest flow through useCharacterWiki methods', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.txt', name: 'doc.txt' }],
    })
    FileSystemLegacy.readAsStringAsync.mockResolvedValue('hello world')
    Crypto.digestStringAsync.mockResolvedValue('hash123')

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

  it('converts PDF documents via convertDocumentText when mimeType is missing (native)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const FileSystemLegacy = require('expo-file-system/legacy')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf' }],
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

  it('converts PDF documents via convertDocumentText when mimeType is missing (web)', async () => {
    const DocumentPicker = require('expo-document-picker')
    const Crypto = require('expo-crypto')
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:doc.pdf', name: 'doc.pdf' }],
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

    expect(mockFetch).toHaveBeenCalledWith('blob:doc.pdf')
    expect(mockFetch).toHaveBeenCalledTimes(1)
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

    expect(mockIngest).not.toHaveBeenCalled()
    expect(capturedSnackbarProps.children).toBe('Insufficient credits to convert this document.')
  })
})
