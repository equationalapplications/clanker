import React from 'react'
import { act, create } from 'react-test-renderer'

// Regression coverage for ChatComposer.web.tsx specifically: the platform-bare
// `~/components/ChatComposer` import used by chatComposer.test.tsx resolves to
// the native module under jest's default haste platform, so it never exercised
// this file. Importing the .web module directly here closes that gap.

// Simulates the real browser: react-native-web's TextInput re-measures its own
// scrollHeight whenever the CSS `height` (composerHeight) changes, and reports
// it via onContentSizeChange → onInputSizeChanged. A static mock can't exercise
// the feedback loop this causes, so this one re-fires onInputSizeChanged with an
// alternating height every time it receives a new composerHeight — exactly the
// adversarial sequence a real textarea produces when our own state update is
// what caused the next measurement to differ.
// Module-level switch so the growth test (which wants one clean measurement,
// not an adversarial feedback simulation) can opt out.
;(globalThis as any).__composerMockAdversarial__ = true

jest.mock('react-native-gifted-chat', () => {
  const ReactLib = require('react')
  // Plain module-scoped toggle rather than a ref: only one composer mounts at
  // a time in these tests, and a ref mutation here trips react-compiler's
  // "don't mutate a hook's return value" rule for what is test-only scaffolding.
  let bumped = false
  const MockComposer = (props: any) => {
    ReactLib.useEffect(() => {
      if (!(globalThis as any).__composerMockAdversarial__) return
      const delta = bumped ? -20 : 20
      bumped = !bumped
      props.onInputSizeChanged?.({ width: 300, height: props.composerHeight + delta })
    }, [props.composerHeight, props.onInputSizeChanged])
    return ReactLib.createElement('Composer', { __chatComposerMock: true, ...props })
  }
  return { Composer: MockComposer }
})

jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: () => ({
    hasChanged: jest.fn().mockResolvedValue(false),
    forget: jest.fn(),
    ingest: jest.fn(),
    isIngesting: false,
  }),
}))

jest.mock('~/hooks/useChatPhotoUpload', () => ({
  useChatPhotoUpload: () => ({
    prepareFromAsset: jest.fn(),
    pickFromLibrary: jest.fn(),
    captureFromCamera: jest.fn(),
    isPreparing: false,
    error: null,
    clearError: jest.fn(),
  }),
}))

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
}))
jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

jest.mock('react-native-paper', () => {
  const ReactLib = require('react')
  const { View, Text: RNText } = require('react-native')
  return {
    IconButton: (props: any) => ReactLib.createElement(View, props),
    Snackbar: () => null,
    Portal: ({ children }: any) => children,
    Button: ({ children, onPress }: any) => ReactLib.createElement(RNText, { onPress }, children),
    Dialog: Object.assign(
      ({ children, visible }: any) => (visible ? ReactLib.createElement(View, null, children) : null),
      {
        Title: ({ children }: any) => ReactLib.createElement(RNText, null, children),
        Content: ({ children }: any) => ReactLib.createElement(RNText, null, children),
        Actions: ({ children }: any) => ReactLib.createElement(RNText, null, children),
      },
    ),
    Text: ({ children }: any) => ReactLib.createElement(RNText, null, children),
    useTheme: () => ({
      colors: { primary: '#6200ee', surfaceVariant: '#333', onSurfaceVariant: '#fff' },
      roundness: 4,
    }),
  }
})

jest.mock('~/components/composer/IngestProgressBar', () => () => null)

import ChatComposerWeb, { MIN_INPUT_HEIGHT } from '~/components/ChatComposer.web'

describe('ChatComposer.web — composer height / onInputSizeChanged', () => {
  // Reproduces the production crash: gifted-chat's Composer only re-fires
  // onInputSizeChanged when the measured dimensions differ from what it last
  // reported — it does not know or care that our own state update is what
  // caused the next measurement to differ. Before the fix, feeding it a
  // measurement while text is empty fed straight into setInputHeight, which
  // the collapse-effect immediately fought back to MIN_INPUT_HEIGHT, which
  // (in a real browser) changes the textarea's own scrollHeight and re-fires
  // onInputSizeChanged — an infinite loop that trips React error #185
  // ("Maximum update depth exceeded") on every empty-composer mount.
  it('ignores size measurements while the input is empty, so the mock browser feedback cannot drive an update loop', () => {
    // With an empty composer, mounting alone is enough to trigger the loop
    // pre-fix: the mock's effect fires on the initial composerHeight, reports
    // a different size, the (old) handler applies it, the collapse-effect
    // fights it back to MIN_INPUT_HEIGHT, which is itself a composerHeight
    // change that re-fires the mock's effect — forever. Pre-fix, this mount
    // throws React's real "Maximum update depth exceeded" invariant.
    let tree: ReturnType<typeof create>
    expect(() => {
      act(() => {
        tree = create(
          <ChatComposerWeb text="" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
        )
      })
    }).not.toThrow()

    const composer = tree!.root.findByProps({ __chatComposerMock: true })
    expect(composer.props.composerHeight).toBe(MIN_INPUT_HEIGHT)
  })

  it('still grows the composer for non-empty text', () => {
    ;(globalThis as any).__composerMockAdversarial__ = false
    let tree: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposerWeb text="hello" onSend={jest.fn()} characterId="char-1" userId="user-1" />,
      )
    })

    act(() => {
      tree!.root
        .findByProps({ __chatComposerMock: true })
        .props.onInputSizeChanged({ width: 300, height: MIN_INPUT_HEIGHT + 20 })
    })

    const composerAfter = tree!.root.findByProps({ __chatComposerMock: true })
    expect(composerAfter.props.composerHeight).toBeGreaterThan(MIN_INPUT_HEIGHT)
  })
})
