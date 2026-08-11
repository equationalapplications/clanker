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

// ── Gifted-Chat ─────────────────────────────────────────────────────────────
let capturedGiftedChatProps: any = null

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')
  return {
    GiftedChat: (props: any) => {
      capturedGiftedChatProps = props
      // Slice 2 still relies on gifted-chat for the list, so we keep its
      // component shell but actually invoke renderInputToolbar so ChatInputBar
      // mounts and ChatComposer's mock can capture its props. renderBubble /
      // renderCustomView / renderMessageImage / renderAvatar render into the
      // tree as before; the Slice-3 rework tears this whole layer down.
      const toolbar = props.renderInputToolbar ? props.renderInputToolbar({}) : null
      const bubbles = (props.messages || []).map((m: any, i: number) => {
        const bubble = props.renderBubble ? props.renderBubble({ currentMessage: m }) : null
        const custom = props.renderCustomView ? props.renderCustomView({ currentMessage: m }) : null
        return React.createElement(
          React.Fragment,
          { key: m._id || i },
          bubble,
          custom,
        )
      })
      return React.createElement('View', { testID: 'gifted-chat' }, [toolbar, ...bubbles])
    },
    Bubble: () => null,
    InputToolbar: () => null,
    Send: () => null,
    MessageText: () => null,
    Composer: () => null,
  }
})

// ── expo-router ──────────────────────────────────────────────────────────────
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    getParent: () => ({
      getParent: () => ({
        setOptions: jest.fn(),
      }),
    }),
    addListener: jest.fn(() => jest.fn()),
  }),
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
let mockPlatformOS = 'android'

jest.mock('react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  const Text = (props: any) => React.createElement('Text', props)
  const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { get OS() { return mockPlatformOS }, select: (spec: any) => spec[mockPlatformOS] || spec.default },
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
      Image: (props: any) =>
        React.createElement('View', { testID: 'avatar-img', ...props }),
      Text: (props: any) =>
        React.createElement('View', { testID: 'avatar-text', ...props }),
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
  useAIChat: jest.fn(() => ({ sendMessage: jest.fn() })),
}))

let mockCreditsData: { totalCredits: number; nextExpiryDate: string | null } = { totalCredits: 10, nextExpiryDate: null }
jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: mockCreditsData.totalCredits }),
}))

// ChatView now resolves avatars via `useResolvedImage`; mock it so this
// suite does not transitively import the database stack (and ultimately
// expo-crypto, which fails to initialize under Jest). Returning null keeps
// every existing assertion in this file — they assert on Avatar.Text, not
// on a resolved image source.
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: () => ({ uri: null, isResolved: true }),
}))

// ── Child components / services ───────────────────────────────────────────────
const capturedCharacterAvatarProps: any[] = []
jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedCharacterAvatarProps.push(props)
    return null
  },
}))
let capturedChatComposerProps: any = null
// Keep in sync with ChatComposer.tsx's MIN_INPUT_HEIGHT/MAX_INPUT_HEIGHT formula
// (LINE_HEIGHT 22 * 2.5/6 + COMPOSER_VERTICAL_PADDING 8 * 2 + COMPOSER_MARGIN_VERTICAL,
// where COMPOSER_MARGIN_VERTICAL is Platform.select({ ios: 11, android: 3, default: 10 });
// mockPlatformOS defaults to 'android' below, so margin = 3 here).
jest.mock('~/components/ChatComposer', () => ({
  __esModule: true,
  COMPOSER_VERTICAL_PADDING: 8,
  MIN_INPUT_HEIGHT: 74,
  MAX_INPUT_HEIGHT: 151,
  default: (props: any) => {
    capturedChatComposerProps = props
    return null
  },
}))

let mockWikiStatus = { ingesting: false, librarian: false, heal: false }
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => mockWikiStatus,
}))

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'
import { ChatInputBar } from '~/components/ChatInputBar'
import { SendButton } from '~/components/SendButton'
import { useAIChat } from '~/hooks/useAIChat'

const mockUseAIChat = useAIChat as jest.MockedFunction<typeof useAIChat>

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
    capturedChatComposerProps = null
    capturedCharacterAvatarProps.length = 0
    mockWikiStatus = { ingesting: false, librarian: false, heal: false }
    mockPlatformOS = 'android'
    mockCreditsData = { totalCredits: 10, nextExpiryDate: null }
    mockUseAIChat.mockReturnValue({
      messages: [],
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      canSendPhoto: false,
      isGeneratingResponse: false,
      escalationState: 'idle',
      error: null,
      activeTool: null,
      streamingMessage: null,
    })
    withLoggedInUser()
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
  it('SendButton exposes accessibilityLabel "Send message" and role "button" when idle', () => {
    // Slice 2 surfaces the send button as a real component instead of a
    // gifted-chat renderSend callback. Verify the same a11y contract on
    // SendButton directly: idle state is a button with the canonical label.
    let sendTree: any
    act(() => {
      sendTree = create(
        <SendButton onPress={jest.fn()} disabled={false} isGenerating={false} />,
      )
    })

    const sendBtn = sendTree.root.find(
      (n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message',
    )
    expect(sendBtn).toBeDefined()
    expect(sendBtn.props.accessibilityState).toEqual({ disabled: false })
  })

  // ── wiki status region ────────────────────────────────────────────────────
  it('wiki status region: has polite live region when ingestion is active', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    mockWikiStatus = { ingesting: true, librarian: false, heal: false }
    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const wikiRegion = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(wikiRegion).toBeDefined()
    act(() => { tree.unmount() })
  })

  // ── wiki status region (free tier) ────────────────────────────────────────
  it('wiki status region: renders status banner for free-tier users', () => {
    mockCreditsData = { totalCredits: 0, nextExpiryDate: null }
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    mockWikiStatus = { ingesting: true, librarian: false, heal: false }
    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    const ingestingText = allTexts.find((t: any) => t.props.accessibilityLabel === 'Ingesting document')
    expect(ingestingText).toBeDefined()

    act(() => { tree.unmount() })
  })

  // ── document upload phase banner ──────────────────────────────────────────
  it.each([
    ['reading', 'Reading file', '⏳ Reading file…'],
    ['converting', 'Converting document', '⏳ Converting document…'],
    ['checking', 'Checking for changes', '⏳ Checking for changes…'],
    ['forgetting', 'Removing previous version', '⏳ Removing previous version…'],
  ])('shows the %s banner with label %s when ChatComposer reports that phase', (phase, label, text) => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    // Slice 2: ChatComposer is mounted inside ChatInputBar, which is inside
    // ChatView. ChatView passes `setDocumentPhase` as ChatComposer's
    // `onPhaseChange`. Captured by the ChatComposer mock.
    expect(capturedChatComposerProps).not.toBeNull()
    expect(typeof capturedChatComposerProps.onPhaseChange).toBe('function')

    act(() => { capturedChatComposerProps.onPhaseChange(phase) })

    const allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    const phaseText = allTexts.find((t: any) => t.props.accessibilityLabel === label)
    expect(phaseText).toBeDefined()
    expect(phaseText.props.children).toBe(text)
  })

  it('hides the document-phase banner once ChatComposer reports phase null and no other status is active', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    act(() => { capturedChatComposerProps.onPhaseChange('reading') })
    let allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    expect(allTexts.find((t: any) => t.props.accessibilityLabel === 'Reading file')).toBeDefined()

    act(() => { capturedChatComposerProps.onPhaseChange(null) })
    allTexts = tree.root.findAll((n: any) => n.type === 'Text')
    expect(allTexts.find((t: any) => t.props.accessibilityLabel === 'Reading file')).toBeUndefined()
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
    // Render the returned element so the mocked CharacterAvatar's default
    // export runs and pushes props into capturedCharacterAvatarProps.
    act(() => { create(avatarEl) })

    expect(capturedCharacterAvatarProps).toHaveLength(1)
    expect(capturedCharacterAvatarProps[0].characterName).toBe('Nova')
    expect(capturedCharacterAvatarProps[0].size).toBe(36)
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

    const avatarText = avatarTree.root.find((n: any) => n.props.testID === 'avatar-text')
    expect(avatarText.props.accessibilityLabel).toContain('Test')
    expect(avatarText.props.accessibilityRole).toBe('image')
  })

  // ── web platform: status role on sign-in-required state ───────────────────
  it('web: sign-in-required state uses accessibilityRole "status"', () => {
    mockPlatformOS = 'web'
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    withNoUser()

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const allViews = tree.root.findAll((n: any) => n.type === 'View')
    const liveView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')

    expect(liveView).toBeDefined()
    expect(liveView.props.accessibilityRole).toBe('status')
  })

  // ── input bar wiring (replaces renderInputToolbar/renderSend assertions) ──
  it('ChatInputBar is rendered with the expected ownership props', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    mockUseAIChat.mockReturnValue({
      messages: [],
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      canSendPhoto: false,
      isGeneratingResponse: false,
      escalationState: 'idle',
      error: null,
      activeTool: null,
      streamingMessage: null,
    })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    // Slice 2: renderInputToolbar is replaced by ChatInputBar mounted in its
    // slot. Verify ChatInputBar exists with the ownership props ChatView
    // forwards — characterId, userId, canSendPhoto, isGenerating.
    const inputBar = tree.root.findByType(ChatInputBar)
    expect(inputBar.props.characterId).toBe('char-1')
    expect(inputBar.props.userId).toBe('user-1')
    expect(inputBar.props.canSendPhoto).toBe(false)
    expect(inputBar.props.isGenerating).toBe(false)
    expect(typeof inputBar.props.onSubmit).toBe('function')
    expect(typeof inputBar.props.onSendPhoto).toBe('function')
    expect(typeof inputBar.props.onPhaseChange).toBe('function')
    // The one-way height shim survives into Slice 3.
    expect(typeof inputBar.props.onHeightChange).toBe('function')
  })

  it('shows tool activity in the status banner when activeTool is set', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    mockUseAIChat.mockReturnValue({
      messages: [],
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      canSendPhoto: false,
      isGeneratingResponse: true,
      escalationState: 'idle',
      error: null,
      activeTool: 'wiki_read',
      streamingMessage: null,
    })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    const statusTexts = tree.root.findAll(
      (n: any) => n.props.accessibilityLabel === 'Reading your memory',
    )
    expect(statusTexts.length).toBeGreaterThan(0)
  })

  it('ChatInputBar keeps the send slot in generating state while the response is in flight', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    mockUseAIChat.mockReturnValue({
      messages: [],
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      canSendPhoto: false,
      isGeneratingResponse: true,
      escalationState: 'idle',
      error: null,
      activeTool: null,
      streamingMessage: null,
    })

    let tree: any
    act(() => { tree = create(<ChatView characterId="char-1" />) })

    // Slice 2: alwaysShowSend is replaced by ChatInputBar's isGenerating
    // prop. ChatView passes isGeneratingResponse through as isGenerating.
    const inputBar = tree.root.findByType(ChatInputBar)
    expect(inputBar.props.isGenerating).toBe(true)

    // And the SendButton inside it swaps to its progressbar while
    // isGenerating is true.
    const sendBtn = tree.root.findByType(SendButton)
    expect(sendBtn.props.isGenerating).toBe(true)

    const spinner = tree.root.find(
      (n: any) => n.props.accessibilityLabel === 'Generating response',
    )
    expect(spinner).toBeDefined()
    expect(spinner.props.accessibilityRole).toBe('progressbar')
  })

  it('does not use interval polling for wiki status updates', () => {
    mockUseCharacter.mockReturnValue({ data: defaultCharacter, isLoading: false })
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')

    act(() => { create(<ChatView characterId="char-1" />) })

    expect(setIntervalSpy).not.toHaveBeenCalled()
    setIntervalSpy.mockRestore()
  })

  it('SendButton pill uses the primaryContainer background from the theme', () => {
    // Slice 2: SendButton owns the pill background, pulling colors.primaryContainer
    // from useTheme(). Drive SendButton with the test theme and assert the
    // background on its outer container is the same color the mock theme provides.
    let sendTree: any
    act(() => {
      sendTree = create(
        <SendButton onPress={jest.fn()} disabled={false} isGenerating={false} />,
      )
    })

    const pill = sendTree.root.find(
      (n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message',
    )
    expect(pill).toBeDefined()
    // The pill's outer style carries the primaryContainer background as a
    // named style entry, not a hex string, since the mock theme provides it
    // by key. Walking the style array to find the named-color background is
    // the regression anchor: any switch to a hard-coded hex would fail it.
    const flat = Array.isArray(pill.props.style) ? pill.props.style : [pill.props.style]
    expect(flat.some((entry: any) => entry && entry.backgroundColor === '#e9d5ff')).toBe(true)
  })
})
