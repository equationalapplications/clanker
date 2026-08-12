/**
 * Regression: the composer must stay above the keyboard on Android.
 *
 * `KeyboardAvoidingView` from react-native-keyboard-controller only honours
 * `keyboardVerticalOffset` when `behavior` is one of its supported values —
 * with `behavior={undefined}` it emits an empty style and the tab-bar offset is
 * silently dropped, leaving the composer behind the keyboard. Assert both the
 * concrete behavior and the offset that depends on it.
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

jest.mock('react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
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

// The tab bar below ChatView on Android — the offset the KeyboardAvoidingView
// has to pass through.
const TAB_BAR_HEIGHT = 56
jest.mock('~/utils/useTabBarHeight', () => ({
  useTabBarHeight: () => 56,
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
// is unavailable under Jest, so this stub doubles as the assertion probe.
const capturedKavProps: any[] = []
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  return {
    KeyboardAvoidingView: (props: any) => {
      capturedKavProps.push(props)
      return React.createElement('View', props)
    },
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
    create(<ChatView characterId="char-1" />)
  })
  return capturedKavProps[capturedKavProps.length - 1]
}

beforeEach(() => {
  capturedKavProps.length = 0
})

describe('ChatView keyboard avoidance', () => {
  it('uses a supported behavior on Android so the tab bar offset is applied', () => {
    platform.OS = 'android'
    const props = mountChat()

    expect(SUPPORTED_BEHAVIORS).toContain(props.behavior)
    expect(props.keyboardVerticalOffset).toBe(TAB_BAR_HEIGHT)
  })

  it('uses a supported behavior on iOS', () => {
    platform.OS = 'ios'
    const props = mountChat()

    expect(SUPPORTED_BEHAVIORS).toContain(props.behavior)
    // iOS has no tab bar below the chat screen, so no extra offset.
    expect(props.keyboardVerticalOffset).toBe(0)
  })
})
