import React from 'react'
import { act, create } from 'react-test-renderer'

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')

  return {
    Composer: (props: any) => React.createElement('Composer', { __chatComposerMock: true, ...props }),
  }
})

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useWikiIngest: () => ({ execute: jest.fn().mockResolvedValue({ chunks: 1 }), isPending: false }),
  useWikiHasChanged: () => ({ execute: jest.fn().mockResolvedValue(true) }),
  useWikiForget: () => ({ execute: jest.fn().mockResolvedValue({ deleted: { entries: 0, tasks: 0 } }), lastResult: null }),
  WikiBusyError: class WikiBusyError extends Error {},
}))

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
}))

jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}))

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('abc123'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: () => ({ isSubscriber: false }),
}))

jest.mock('react-native-paper', () => ({
  IconButton: () => null,
  Snackbar: () => null,
  Portal: ({ children }: any) => children,
  useTheme: () => ({ colors: { primary: '#6200ee' } }),
}))

jest.mock('~/components/composer/IngestProgressBar', () => () => null)

describe('ChatComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})