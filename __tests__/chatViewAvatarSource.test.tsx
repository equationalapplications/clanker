/**
 * Avatar source precedence for ChatView's header and message bubbles.
 *
 * Chain: resolved(active_image_id) → legacy characters.avatar → bundled default.
 * The header is installed through drawerNav.setOptions, so it is captured and
 * rendered separately from the main tree.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

// ── Gifted-Chat ─────────────────────────────────────────────────────────────
let capturedGiftedChatProps: any = null

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')
  return {
    GiftedChat: (props: any) => {
      capturedGiftedChatProps = props
      return React.createElement('View', { testID: 'gifted-chat' })
    },
    Bubble: () => null,
    InputToolbar: () => null,
    Send: ({ sendButtonProps, children }: any) =>
      React.createElement('View', { testID: 'send-btn', ...sendButtonProps }, children),
  }
})

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
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { OS: 'android', select: (spec: any) => spec.android || spec.default },
    View,
    Text,
    TouchableOpacity,
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
  useAIChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    isGeneratingResponse: false,
    escalationState: 'idle',
    error: null,
    activeTool: null,
    streamingMessage: null,
  }),
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
  MIN_INPUT_HEIGHT: 74,
  MAX_INPUT_HEIGHT: 151,
  default: () => null,
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => ({ ingesting: false, librarian: false, heal: false }),
}))

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'

function renderChat(character: Record<string, unknown>) {
  mockUseCharacter.mockReturnValue({ data: character, isLoading: false })
  let tree: any
  act(() => { tree = create(<ChatView characterId="char-1" />) })
  return {
    tree,
    rerender() {
      act(() => { tree.update(<ChatView characterId="char-1" />) })
    },
  }
}

/** Render the headerTitle element captured from drawerNav.setOptions. */
function renderHeader() {
  expect(capturedHeaderTitle).toBeTruthy()
  act(() => { create(capturedHeaderTitle!()) })
}

function baseCharacter(overrides: Record<string, unknown>) {
  return {
    id: 'char-1',
    name: 'Nova',
    avatar: null,
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

/** Mount the character bubble and return the props CharacterAvatar received. */
function bubbleCharacterProps() {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'char-1' } },
  })
  capturedAvatarProps.length = 0
  act(() => { create(rendered) })
  expect(capturedAvatarProps).toHaveLength(1)
  return capturedAvatarProps[0]
}

/** Mount the user bubble and return the Avatar.Text label, or null if absent. */
function bubbleUserLabel(): string | null {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'user-1' } },
  })
  let holder: any
  act(() => { holder = create(rendered) })
  const txt = holder.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })[0]
  return txt ? txt.props.label : null
}

describe('ChatView avatar source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAvatarProps.length = 0
    capturedGiftedChatProps = null
    capturedHeaderTitle = null
    mockResolved = null
  })

  it('header prefers the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))
    renderHeader()

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
    expect(capturedAvatarProps[0].imageUrl).toBe('file:///new.webp')
  })

  it('header falls back to the legacy avatar URL when nothing resolves', () => {
    mockResolved = null
    renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBe('https://old.example/legacy.png')
  })

  it('header passes null when there is neither a row nor a legacy URL', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBeNull()
  })

  it('message bubbles prefer the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))

    expect(bubbleCharacterProps().imageUrl).toBe('file:///new.webp')
  })

  it('message bubbles fall back to the legacy avatar URL', () => {
    mockResolved = null
    renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(bubbleCharacterProps().imageUrl).toBe('https://old.example/legacy.png')
  })

  // The phase 2 change itself: an avatar-less character renders the bundled
  // default (via CharacterAvatar) in the bubble, not initials. Fails against
  // pre-phase-2 ChatView, which returns Avatar.Text here.
  it('character bubble renders CharacterAvatar, not initials, when there is no image', () => {
    mockResolved = null
    renderChat(baseCharacter({}))

    const rendered = capturedGiftedChatProps.renderAvatar({
      currentMessage: { user: { _id: 'char-1' } },
    })
    capturedAvatarProps.length = 0
    let holder: any
    act(() => { holder = create(rendered) })

    expect(capturedAvatarProps).toHaveLength(1)
    expect(capturedAvatarProps[0].imageUrl).toBeNull()
    expect(holder.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })).toHaveLength(0)
  })

  // Locks in the deliberate asymmetry: the user keeps initials when
  // chatUser.avatar is null. The character branch runs the bundled-default
  // fallback instead.
  it('user bubble shows initials when user has no avatar', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    expect(bubbleUserLabel()).toBe('T')  // 'Test' → 'T'
  })

  // NOT a mirror of the header's dep-array bug — renderAvatar is an inline
  // closure with nothing to memoize, so this passes trivially today. It exists
  // to fail if renderAvatar is later wrapped in useCallback with characterAvatar
  // missing from the deps, which would freeze the bubble on the first resolve.
  it('bubble tracks a resolved image that arrives after first render', () => {
    mockResolved = null
    const result = renderChat(baseCharacter({ active_image_id: 'img-1' }))
    expect(bubbleCharacterProps().imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    result.rerender()
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
