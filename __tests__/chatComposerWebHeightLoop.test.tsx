/**
 * Height-loop regression tests for ChatComposer.
 *
 * With the unified ChatComposer, height is internal state derived from
 * `onContentSizeChange` and clamped to `[MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT]`.
 * There is deliberately no `composerHeight` prop coming in — that is what
 * kills the height-on-height feedback loop that gifted-chat's Composer
 * triggered on web. These tests pin that invariant against the real
 * ChatComposer: it grows with text, clamps at MAX, collapses when emptied,
 * and terminates under a hostile onContentSizeChange cycle.
 */

import React from 'react'
import { act, create } from 'react-test-renderer'

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

import ChatComposer, { MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT } from '~/components/ChatComposer'

const noop = () => {}
const asyncNoop = async () => true
const baseProps = {
  text: '',
  onChangeText: noop,
  onSubmit: noop,
  characterId: 'c',
  userId: 'u',
  onSendPhoto: asyncNoop,
}

describe('ChatComposer — composer height loop', () => {
  // The unified composer measures via plain TextInput.onContentSizeChange and
  // clamps the resulting height to [MIN, MAX]. While text is empty, the
  // collapse pass is the sole authority on the idle height — measurements
  // do NOT trigger a re-render. Pre-fix (height fed by a composerHeight prop
  // while the browser re-measured and re-fired), this caused an infinite
  // render loop (React error #185) on every empty-composer mount.
  it('ignores size measurements while the input is empty, so the browser feedback cannot drive an update loop', () => {
    let tree!: ReturnType<typeof create>
    expect(() => {
      act(() => {
        tree = create(
          <ChatComposer {...baseProps} text="" />,
        )
      })
    }).not.toThrow()

    const input = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    // The mount-time height is the idle size — but the test must also
    // exercise the measurement path it claims to cover. Fire a measurement
    // while text is empty and assert the height stays at MIN: a regression
    // that fed the measurement back as the new height would push it above
    // MIN and the assertion below would fail.
    act(() => {
      input.props.onContentSizeChange({ nativeEvent: { contentSize: { width: 300, height: 400 } } })
    })
    expect(input.props.style.height).toBe(MIN_INPUT_HEIGHT)
  })

  it('still grows the composer for non-empty text', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer {...baseProps} text="hello" />,
      )
    })

    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Message input' }).props
        .onContentSizeChange({ nativeEvent: { contentSize: { width: 300, height: MIN_INPUT_HEIGHT + 20 } } })
    })

    const input = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    expect(input.props.style.height).toBeGreaterThan(MIN_INPUT_HEIGHT)
  })

  it('clamps to MAX_INPUT_HEIGHT when contentSize reports a huge height', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer {...baseProps} text="hello" />,
      )
    })

    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Message input' }).props
        .onContentSizeChange({ nativeEvent: { contentSize: { width: 300, height: 9999 } } })
    })

    const input = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    expect(input.props.style.height).toBe(MAX_INPUT_HEIGHT)
  })

  it('collapses to MIN when text empties after growth', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer {...baseProps} text="hello" />,
      )
    })

    // Grow first so the collapse pass has something to fold back down.
    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Message input' }).props
        .onContentSizeChange({ nativeEvent: { contentSize: { width: 300, height: MIN_INPUT_HEIGHT + 40 } } })
    })

    act(() => {
      tree.update(
        <ChatComposer {...baseProps} text="" />,
      )
    })

    const input = tree.root.findByProps({ accessibilityLabel: 'Message input' })
    expect(input.props.style.height).toBe(MIN_INPUT_HEIGHT)
  })

  it('terminates under an adversarial onContentSizeChange cycle (no infinite re-render)', () => {
    // The pre-fix loop: TextInput re-measures its own height whenever the
    // CSS height changes; the wrapper would re-fire onContentSizeChange with
    // a different contentSize, which the wrapper would feed back as the
    // next height, ad infinitum. With the unified composer, every height
    // passes through the [MIN, MAX] clamp and the empty-text collapse is
    // the only authority on the idle height — so the cycle has nowhere to
    // close. Verify the loop terminates: a fixed number of
    // onContentSizeChange calls produces a bounded render count.
    //
    // Counting renders of ChatComposer itself (not a wrapper) — ChatComposer
    // updates its `inputHeight` state internally, which does not re-render
    // any parent. React.Profiler counts every commit of its subtree, so its
    // onRender fires once for the initial mount and once for each internal
    // re-render.
    let renderCount = 0
    const onProfileRender = () => {
      renderCount += 1
    }

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <React.Profiler id="ChatComposer" onRender={onProfileRender}>
          <ChatComposer {...baseProps} text="hello" />
        </React.Profiler>,
      )
    })

    // Hostile sequence: alternates ±50 to drive the measurements back and forth.
    const heights = [MIN_INPUT_HEIGHT + 50, MIN_INPUT_HEIGHT + 100, MIN_INPUT_HEIGHT + 50, MIN_INPUT_HEIGHT + 200]
    act(() => {
      for (const h of heights) {
        tree.root.findByProps({ accessibilityLabel: 'Message input' }).props
          .onContentSizeChange({ nativeEvent: { contentSize: { width: 300, height: h } } })
      }
    })

    // After the cycle, the height must be one of the clamped values,
    // and the render count must be bounded (no infinite loop). An infinite
    // loop would blow past this bound immediately; a healthy cycle clamps
    // to a handful of distinct heights so the render count is small.
    const finalHeight = tree.root.findByProps({ accessibilityLabel: 'Message input' }).props.style.height
    expect(finalHeight).toBeGreaterThanOrEqual(MIN_INPUT_HEIGHT)
    expect(finalHeight).toBeLessThanOrEqual(MAX_INPUT_HEIGHT)
    expect(renderCount).toBeLessThan(50)
  })
})