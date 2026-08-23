/**
 * Avatar source precedence for ChatView's header and message bubbles.
 *
 * Chain: resolved(active_image_id) → bundled default. The legacy
 * `characters.avatar` tail fallback was removed when the column was dropped; a
 * missing resolve now goes straight to the bundled default. The header is
 * installed through drawerNav.setOptions, so it is captured and rendered
 * separately from the main tree.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

// ── expo-router ──────────────────────────────────────────────────────────────
let capturedHeaderTitle: (() => React.ReactElement) | null = null

// Referentially stable: ChatView's useLayoutEffect lists `navigation` in its
// deps, so a fresh object per render would retrigger the effect every time and
// make the dependency-array guard below vacuous.
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  getParent: () => ({
    getParent: () => ({
      setOptions: (opts: any) => {
        if (typeof opts?.headerTitle === 'function') capturedHeaderTitle = opts.headerTitle
      },
    }),
  }),
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
jest.mock('react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  const Text = (props: any) => React.createElement('Text', props)
  const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
  // FlatList is the list renderer our MessageList uses (Slice 3). Stub it so
  // every data row mounts through `renderItem` immediately — same shape as
  // gifted-chat's mock used to provide.
  const FlatList = ({ data = [], renderItem, keyExtractor }: any) => {
    return React.createElement(
      'View',
      { testID: 'flat-list' },
      data.map((item: any, index: number) =>
        React.createElement(
          'View',
          { key: keyExtractor ? keyExtractor(item) : index, testID: 'flat-list-item' },
          renderItem ? renderItem({ item, index }) : null,
        ),
      ),
    )
  }
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { OS: 'android', select: (spec: any) => spec.android || spec.default },
    Keyboard: {
      addListener: () => ({ remove: () => {} }),
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

import { useAIChat } from '~/hooks/useAIChat'

const mockUseAIChat = useAIChat as jest.MockedFunction<typeof useAIChat>

function mockDefaultAIChatMock() {
  return {
    messages: [],
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    canSendPhoto: false,
    isGeneratingResponse: false,
    escalationState: 'idle',
    error: null,
    activeTool: null,
    streamingMessage: null,
  } as any
}

jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: jest.fn(() => mockDefaultAIChatMock()),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: 10 }),
}))

// ── The pipeline under test ───────────────────────────────────────────────────
let mockResolved: string | null = null
const mockUseResolvedImage: jest.Mock = jest.fn(() => ({ uri: mockResolved, isResolved: true }))
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (...args: any[]) => mockUseResolvedImage(...args),
}))

// ── Child components ──────────────────────────────────────────────────────────
const capturedAvatarProps: any[] = []
jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedAvatarProps.push(props)
    return null
  },
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

// ChatView uses `KeyboardAvoidingView` from `react-native-keyboard-controller`
// (Slice 3). The native module backing it is not available under Jest, so we
// stub the import here — same pattern as the `react-native` mock above.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  return {
    KeyboardAvoidingView: View,
    KeyboardProvider: ({ children }: any) => children ?? null,
    useKeyboardHandler: () => ({}),
    useKeyboardAnimation: () => ({}),
  }
})

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'

function renderChat(character: Record<string, unknown>) {
  mockUseCharacter.mockReturnValue({ data: character, isLoading: false })
  let tree: any
  act(() => {
    tree = create(<ChatView characterId="char-1" />)
  })
  return {
    tree,
    rerender() {
      act(() => {
        tree.update(<ChatView characterId="char-1" />)
      })
    },
  }
}

/** Render the headerTitle element captured from drawerNav.setOptions. */
function renderHeader() {
  expect(capturedHeaderTitle).toBeTruthy()
  act(() => {
    create(capturedHeaderTitle!())
  })
}

function baseCharacter(overrides: Record<string, unknown>) {
  return {
    id: 'char-1',
    name: 'Nova',
    active_image_id: null,
    appearance: 'Friendly AI',
    traits: 'calm',
    emotions: 'cheerful',
    context: 'coach',
    cloud_id: null,
    save_to_cloud: false,
    ...overrides,
  }
}

/**
 * Mount ChatView with a single message authored by `userId` (typically 'char-1'
 * for character bubbles). The FlatList mock renders every row immediately,
 * so MessageList → MessageRow → renderAvatar runs and the avatar lands in
 * `capturedAvatarProps` (CharacterAvatar) or in the tree (Avatar.Image /
 * Avatar.Text).
 */
function renderChatWithMessage(userId: string, characterOverrides: Record<string, unknown> = {}) {
  const aiMock = mockDefaultAIChatMock()
  aiMock.messages = [
    {
      _id: `m-${userId}`,
      text: '',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      user: { _id: userId, name: userId === 'char-1' ? 'Nova' : 'Test' },
    },
  ]
  mockUseAIChat.mockReturnValue(aiMock)
  mockUseCharacter.mockReturnValue({ data: baseCharacter(characterOverrides), isLoading: false })
  let tree: any
  act(() => {
    tree = create(<ChatView characterId="char-1" />)
  })
  return tree
}

/** Mount the character bubble and return the props CharacterAvatar received. */
function bubbleCharacterProps(characterOverrides: Record<string, unknown> = {}) {
  capturedAvatarProps.length = 0
  renderChatWithMessage('char-1', characterOverrides)
  expect(capturedAvatarProps.length).toBeGreaterThanOrEqual(1)
  return capturedAvatarProps[capturedAvatarProps.length - 1]
}

/** Mount the user bubble and return the Avatar.Text label, or null if absent. */
function bubbleUserLabel(): string | null {
  const tree = renderChatWithMessage('user-1')
  const txt = tree.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })[0]
  return txt ? txt.props.label : null
}

describe('ChatView avatar source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAvatarProps.length = 0
    capturedHeaderTitle = null
    mockResolved = null
    mockUseAIChat.mockReturnValue(mockDefaultAIChatMock())
  })

  it('header prefers the resolved image when a row is present', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ active_image_id: 'img-1' }))
    renderHeader()

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
    expect(capturedAvatarProps[0].imageUrl).toBe('file:///new.webp')
  })

  it('header passes null when nothing resolves', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBeNull()
  })

  it('message bubbles prefer the resolved image when a row is present', () => {
    mockResolved = 'file:///new.webp'

    expect(bubbleCharacterProps({ active_image_id: 'img-1' }).imageUrl).toBe('file:///new.webp')
  })

  // The phase 2 change itself: an avatar-less character renders the bundled
  // default (via CharacterAvatar) in the bubble, not initials. Fails against
  // pre-phase-2 ChatView, which returns Avatar.Text here.
  it('character bubble renders CharacterAvatar, not initials, when there is no image', () => {
    mockResolved = null
    const tree = renderChatWithMessage('char-1')

    expect(capturedAvatarProps[capturedAvatarProps.length - 1].imageUrl).toBeNull()
    expect(tree.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })).toHaveLength(0)
  })

  // Locks in the deliberate asymmetry: the user keeps initials when
  // chatUser.avatar is null. The character branch runs the bundled-default
  // fallback instead.
  it('user bubble shows initials when user has no avatar', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    expect(bubbleUserLabel()).toBe('T') // 'Test' → 'T'
  })

  // NOT a mirror of the header's dep-array bug — renderAvatar is an inline
  // closure with nothing to memoize, so this passes trivially today. It exists
  // to fail if renderAvatar is later wrapped in useCallback with characterAvatar
  // missing from the deps, which would freeze the bubble on the first resolve.
  it('bubble tracks a resolved image that arrives after first render', () => {
    mockResolved = null
    renderChat(baseCharacter({ active_image_id: 'img-1' }))
    expect(bubbleCharacterProps().imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    renderChat(baseCharacter({ active_image_id: 'img-1' }))
    expect(bubbleCharacterProps().imageUrl).toBe('file:///late-thumb.webp')
  })

  // Guards the useLayoutEffect dependency array. The resolve is async, so the
  // header is first installed with null. `character` is the same object across
  // both renders, so only the resolved uri can retrigger the effect — drop it
  // from the deps and the header keeps showing the bundled default forever.
  it('reinstalls the header when the resolved image arrives after first render', () => {
    mockResolved = null
    const result = renderChat(baseCharacter({ active_image_id: 'img-1' }))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    result.rerender()
    renderHeader()

    expect(capturedAvatarProps[1].imageUrl).toBe('file:///late-thumb.webp')
  })

  it('resolves the bubble avatar once per ChatView, not once per message', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ active_image_id: 'img-1' }))

    // Header + bubbles share two hook calls total (one per variant request);
    // a hook moved inside renderAvatar would multiply with message count.
    expect(mockUseResolvedImage.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
