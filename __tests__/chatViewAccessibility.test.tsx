/**
 * Accessibility contract tests for ChatView.
 *
 * Asserts that loading, error, and auth-gate states expose the expected
 * accessibilityLiveRegion / accessibilityLabel to screen readers, that the
 * send button carries the correct label and role, and that the wiki-status
 * region announces changes via a polite live region.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

/** Matches the setInterval period used by ChatView's wiki-status poller. */
const WIKI_STATUS_POLL_INTERVAL_MS = 5000

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
    // Spread sendButtonProps so we can assert on them
    Send: ({ sendButtonProps, children }: any) =>
      React.createElement('View', { testID: 'send-btn', ...sendButtonProps }, children),
  }
})

// ── expo-router ──────────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: Object.assign(
    ({ children }: any) => {
      const React = require('react')
      return React.createElement('View', {}, children)
    },
    { Screen: () => null },
  ),
}))

// ── react-native ─────────────────────────────────────────────────────────────
let mockPlatformOS = 'android'

jest.mock('react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  const Text = (props: any) => React.createElement('Text', props)
  const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { get OS() { return mockPlatformOS } },
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
      Image: ({ accessibilityLabel, ...props }: any) =>
        React.createElement('View', { testID: 'avatar-img', accessibilityLabel }),
    },
  }
})

// ── Auth / XState ─────────────────────────────────────────────────────────────
const mockUseAuthMachine = jest.fn(() => ({}))
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => mockUseAuthMachine(),
}))

const mockSelectorImpl = jest.fn()
jest.mock('@xstate/react', () => ({
  useSelector: (_service: any, selector: any) => mockSelectorImpl(_service, selector),
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
  useAIChat: () => ({ sendMessage: jest.fn() }),
}))

jest.mock('~/hooks/useUserCredits', () => ({
  useUserCredits: () => ({ data: { totalCredits: 10, hasUnlimited: true } }),
}))

// ── Child components / services ───────────────────────────────────────────────
jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('~/components/ChatComposer', () => () => null)

const mockGetWiki = jest.fn()
jest.mock('~/services/wikiService', () => ({
  getWiki: () => mockGetWiki(),
}))

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const defaultCharacter = {
  id: 'char-1',
  name: 'Nova',
  avatar: null,
  appearance: 'Friendly AI',
  traits: 'calm',
  emotions: 'cheerful',
  context: 'coach',
}

function withLoggedInUser() {
  mockSelectorImpl.mockImplementation((_s, sel) =>
    sel({ context: { user: { uid: 'user-1', displayName: 'Test', photoURL: null } } }),
  )
}

function withNoUser() {
  mockSelectorImpl.mockImplementation((_s, sel) =>
    sel({ context: { user: null } }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ChatView accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedGiftedChatProps = null
    mockGetWiki.mockReturnValue(null)
    mockPlatformOS = 'android'
    withLoggedInUser()
  })

  afterEach(() => {
    // Ensure fake timers are always cleaned up if a test leaves them in place
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  // ── loading state ─────────────────────────────────────────────────────────
  it('loading state: accessible with polite live region and "Loading character" label', () => {
    mockUseCharacter.mockReturnValue({ data: null, isLoading: true })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessible).toBe(true)
    expect(liveView.props.accessibilityLabel).toBe('Loading character')
  })

  // ── character not found ───────────────────────────────────────────────────
  it('character not found: accessible with polite live region and "Character not found" label', () => {
    mockUseCharacter.mockReturnValue({ data: null, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessible).toBe(true)
    expect(liveView.props.accessibilityLabel).toBe('Character not found')
  })

  // ── sign in required ──────────────────────────────────────────────────────
  it('sign in required: accessible with polite live region and actionable label', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    withNoUser()

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessible).toBe(true)
    expect(liveView.props.accessibilityLabel).toBe('Please sign in to chat')
  })

  // ── send button ───────────────────────────────────────────────────────────
  it('renderSend: send button has accessibilityLabel "Send message" and role "button"', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    act(() => { create(<ChatView characterId="char-1" />) })

    expect(capturedGiftedChatProps).not.toBeNull()
    const sendEl = capturedGiftedChatProps.renderSend({ text: 'hi', onSend: jest.fn() })

    let sendTree: any
    act(() => { sendTree = create(sendEl) })

    const sendBtn = sendTree.root.find((n: any) => n.props.testID === 'send-btn')
    expect(sendBtn.props.accessibilityLabel).toBe('Send message')
    expect(sendBtn.props.accessibilityRole).toBe('button')
  })

  // ── wiki status region ────────────────────────────────────────────────────
  it('wiki status region: has polite live region when ingestion is active', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    const mockWikiInstance = {
      getEntityStatus: jest.fn().mockReturnValue({ ingesting: true, librarian: false }),
    }
    mockGetWiki.mockReturnValue(mockWikiInstance)

    jest.useFakeTimers()
    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    // Advance past the 5 s interval so wikiStatus state updates
    act(() => { jest.advanceTimersByTime(WIKI_STATUS_POLL_INTERVAL_MS) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const wikiRegion = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(wikiRegion).toBeDefined()

    // Unmount inside act to flush cleanup effects (clearInterval), then drain
    // remaining timers before afterEach restores real timers.
    act(() => { tree.unmount() })
    jest.clearAllTimers()
  })

  // ── web platform: status role on loading states ────────────────────────────
  it('web: loading state uses accessibilityRole "status"', () => {
    mockPlatformOS = 'web'
    mockUseCharacter.mockReturnValue({ data: null, isLoading: true })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessibilityRole).toBe('status')
  })

  it('web: character-not-found state uses accessibilityRole "status"', () => {
    mockPlatformOS = 'web'
    mockUseCharacter.mockReturnValue({ data: null, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessibilityRole).toBe('status')
  })

  // ── avatar speaker identification ─────────────────────────────────────────
  it('renderAvatar: character avatar carries character name as accessibility label', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    act(() => { create(<ChatView characterId="char-1" />) })

    expect(capturedGiftedChatProps).not.toBeNull()
    // Simulate a message from the character (not the current user)
    const avatarEl = capturedGiftedChatProps.renderAvatar({
      currentMessage: { user: { _id: 'char-1' } },
    })

    let avatarTree: any
    act(() => { avatarTree = create(avatarEl) })

    const avatarImg = avatarTree.root.find((n: any) => n.props.testID === 'avatar-img')
    expect(avatarImg.props.accessibilityLabel).toContain('Nova')
  })

  it('renderAvatar: user avatar carries the user display name as accessibility label', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    act(() => { create(<ChatView characterId="char-1" />) })

    expect(capturedGiftedChatProps).not.toBeNull()
    // Simulate a message from the current user
    const avatarEl = capturedGiftedChatProps.renderAvatar({
      currentMessage: { user: { _id: 'user-1' } },
    })

    let avatarTree: any
    act(() => { avatarTree = create(avatarEl) })

    const avatarImg = avatarTree.root.find((n: any) => n.props.testID === 'avatar-img')
    expect(avatarImg.props.accessibilityLabel).toContain('Test')
  })
})
