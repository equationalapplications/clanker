/**
 * Regression: the composer must stay above the keyboard on both platforms.
 *
 * `KeyboardAvoidingView` from react-native-keyboard-controller computes the
 * overlap as `frame.y + frame.height - keyboardTop` plus
 * `keyboardVerticalOffset`, and the `frame.y` from onLayout is
 * parent-relative. The view's screen-absolute top (status bar + header) must
 * therefore be supplied as the offset. The library's native `automaticOffset`
 * measurement rejects while the screen is still transitioning in and silently
 * falls back to the parent-relative frame (upstream
 * kirillzyusko/react-native-keyboard-controller#1594), so ChatView measures
 * the same delta in JS: measureInWindow y minus onLayout y, re-measured when
 * the keyboard opens. `behavior` must also stay a concrete supported value —
 * with `undefined` the component emits an empty style and never avoids at all.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

// ── expo-router ──────────────────────────────────────────────────────────────
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  getParent: () => ({ getParent: () => ({ setOptions: jest.fn() }) }),
  addListener: jest.fn(() => jest.fn()),
}

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => mockNavigation,
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    setParams: jest.fn(),
  }),
  Stack: Object.assign(
    ({ children }: any) => {
      const React = require('react')
      return React.createElement('View', {}, children)
    },
    { Screen: () => null },
  ),
}))

// ── react-native ─────────────────────────────────────────────────────────────
// `Platform.OS` is read at render time by ChatView; a mutable holder lets each
// test flip the platform before mounting.
const platform = { OS: 'android' as 'android' | 'ios' }

// The keyboard-avoidance offset is measured through the mocked View and the
// Keyboard event emitter. Mutable holders let each test choose the absolute y
// `measureInWindow` reports and fire the captured keyboard listeners.
const mockMeasuredAbsoluteY = { value: 0 }
const mockKeyboardListeners: Record<string, Array<() => void>> = {}

jest.mock('react-native', () => {
  const React = require('react')
  // ChatView re-measures its keyboard-avoidance offset through this view's
  // `measureInWindow`, so the mock exposes one driven by
  // `mockMeasuredAbsoluteY`.
  const View = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      measureInWindow: (callback: any) => callback(0, mockMeasuredAbsoluteY.value, 0, 0),
    }))
    return React.createElement('View', props)
  })
  const Text = (props: any) => React.createElement('Text', props)
  const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
  const FlatList = ({ data = [], renderItem, keyExtractor }: any) =>
    React.createElement(
      'View',
      { testID: 'flat-list' },
      data.map((item: any, index: number) =>
        React.createElement(
          'View',
          { key: keyExtractor ? keyExtractor(item) : index },
          renderItem ? renderItem({ item, index }) : null,
        ),
      ),
    )
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: {
      get OS() {
        return platform.OS
      },
      select: (spec: any) => spec[platform.OS] ?? spec.default,
    },
    Keyboard: {
      addListener: (event: string, callback: () => void) => {
        ;(mockKeyboardListeners[event] ??= []).push(callback)
        return { remove: () => {} }
      },
    },
    View,
    Text,
    TouchableOpacity,
    FlatList,
  }
})

// ── react-native-paper ───────────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ActivityIndicator: (props: any) =>
      React.createElement('View', { testID: 'activity-indicator', ...props }),
    useTheme: () => ({
      colors: {
        primary: '#6200ee',
        onPrimary: '#fff',
        primaryContainer: '#e9d5ff',
        secondary: '#00c',
        onSecondary: '#fff',
        surface: '#1e1e1e',
        outlineVariant: '#444',
      },
      roundness: 4,
    }),
    Avatar: {
      Image: (props: any) => React.createElement('View', { testID: 'avatar-img', ...props }),
      Text: (props: any) => React.createElement('View', { testID: 'avatar-text', ...props }),
    },
  }
})

// ── Auth / XState ─────────────────────────────────────────────────────────────
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({}),
}))

jest.mock('@xstate/react', () => ({
  useSelector: (_service: any, selector: any) =>
    selector({ context: { user: { uid: 'user-1', displayName: 'Test', photoURL: null } } }),
}))

// ── Data hooks ────────────────────────────────────────────────────────────────
const mockUseCharacter = jest.fn()
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: (...args: any[]) => mockUseCharacter(...args),
}))

jest.mock('~/hooks/useMessages', () => ({
  useChatMessages: () => [],
}))

jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: jest.fn(() => ({
    messages: [],
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    canSendPhoto: false,
    isGeneratingResponse: false,
    escalationState: 'idle',
    error: null,
    activeTool: null,
    streamingMessage: null,
  })),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: 10 }),
}))

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: () => ({ uri: null, isResolved: true }),
}))

jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('~/components/ChatComposer', () => ({
  __esModule: true,
  COMPOSER_VERTICAL_PADDING: 8,
  MIN_INPUT_HEIGHT: 71,
  MAX_INPUT_HEIGHT: 148,
  default: () => null,
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => ({ ingesting: false, librarian: false, heal: false }),
}))

// Capture the props ChatView hands to KeyboardAvoidingView. The native module
// is unavailable under Jest, so this stub doubles as the assertion probe. It
// renders the mocked react-native View so ChatView's ref reaches the mocked
// `measureInWindow`.
const capturedKavProps: any[] = []
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardAvoidingView: React.forwardRef((props: any, ref: any) => {
      capturedKavProps.push(props)
      return React.createElement(View, { ...props, ref })
    }),
    KeyboardProvider: ({ children }: any) => children ?? null,
    useKeyboardHandler: () => ({}),
    useKeyboardAnimation: () => ({}),
  }
})

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'

// The behaviors KeyboardAvoidingView actually implements. `undefined` produces
// an empty style, which is exactly the regression this test guards.
const SUPPORTED_BEHAVIORS = ['height', 'padding', 'position', 'translate-with-padding']

function mountChat() {
  mockUseCharacter.mockReturnValue({
    data: {
      id: 'char-1',
      name: 'Nova',
      avatar: null,
      active_image_id: null,
      appearance: '',
      traits: '',
      emotions: '',
      context: '',
      cloud_id: null,
      save_to_cloud: false,
    },
    isLoading: false,
  })
  act(() => {
    mountedChat = create(<ChatView characterId="char-1" />)
  })
  return capturedKavProps[capturedKavProps.length - 1]
}

// Kept alive between mount and the assertions so the offset `setState` inside
// the measurement callbacks can re-render the tree.
let mountedChat: ReturnType<typeof create> | null = null

beforeEach(() => {
  capturedKavProps.length = 0
  mockMeasuredAbsoluteY.value = 0
  for (const event of Object.keys(mockKeyboardListeners)) {
    delete mockKeyboardListeners[event]
  }
})

afterEach(() => {
  act(() => {
    mountedChat?.unmount()
  })
  mountedChat = null
})

describe('ChatView keyboard avoidance', () => {
  it('uses a supported behavior and the JS-measured offset on Android', () => {
    platform.OS = 'android'
    const props = mountChat()

    expect(SUPPORTED_BEHAVIORS).toContain(props.behavior)
    // The native `automaticOffset` measurement silently falls back to the
    // parent-relative frame when the view is not resolvable yet (upstream
    // #1594), so it must stay off.
    expect(props.automaticOffset).toBeUndefined()
    expect(typeof props.onLayout).toBe('function')
    expect(props.keyboardVerticalOffset).toBe(0)
  })

  it('uses a supported behavior and the JS-measured offset on iOS', () => {
    platform.OS = 'ios'
    const props = mountChat()

    expect(SUPPORTED_BEHAVIORS).toContain(props.behavior)
    expect(props.automaticOffset).toBeUndefined()
    expect(typeof props.onLayout).toBe('function')
    expect(props.keyboardVerticalOffset).toBe(0)
  })

  it('feeds the screen-absolute top into the offset, re-measured on keyboard open', () => {
    platform.OS = 'android'
    const props = mountChat()

    // The view lays out at y=0 relative to its parent, but absolutely it sits
    // 140 below the screen top (status bar + header). The offset handed to
    // KeyboardAvoidingView must equal that delta.
    mockMeasuredAbsoluteY.value = 140
    act(() => {
      props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 640 } } })
    })
    expect(capturedKavProps[capturedKavProps.length - 1].keyboardVerticalOffset).toBe(140)

    // Opening the keyboard re-measures, covering a mount-time measurement
    // that landed mid-transition.
    mockMeasuredAbsoluteY.value = 141
    act(() => {
      for (const listener of mockKeyboardListeners['keyboardDidShow'] ?? []) listener()
    })
    expect(capturedKavProps[capturedKavProps.length - 1].keyboardVerticalOffset).toBe(141)
  })
})
