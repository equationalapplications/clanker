import React from 'react'
import { act, create } from 'react-test-renderer'

// ─── wikiService mock ─────────────────────────────────────────────────────────
const mockGetEntityStatus = jest.fn().mockReturnValue({ ingesting: false, librarian: false })
jest.mock('~/services/wikiService', () => ({
  getWiki: () => ({ getEntityStatus: mockGetEntityStatus }),
}))

// ─── react-native mocks ───────────────────────────────────────────────────────
let mockPlatformOS = 'ios'
jest.mock('react-native', () => {
  const React = require('react')
  return {
    View: ({ children, accessibilityLiveRegion, accessibilityRole, style }: any) =>
      React.createElement('View', { accessibilityLiveRegion, accessibilityRole, style }, children),
    StyleSheet: { create: (s: any) => s },
    Platform: {
      get OS() { return mockPlatformOS },
      select: (spec: any) => spec[mockPlatformOS] ?? spec.default,
    },
    TouchableOpacity: ({ children, ...props }: any) =>
      React.createElement('TouchableOpacity', props, children),
  }
})

// ─── expo-router ──────────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: {
    Screen: () => null,
  },
}))

// ─── react-native-gifted-chat ─────────────────────────────────────────────────
jest.mock('react-native-gifted-chat', () => ({
  GiftedChat: () => null,
  Bubble: () => null,
}))

// ─── react-native-keyboard-controller ────────────────────────────────────────
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: () => null,
}))

// ─── react-native-paper ──────────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, accessibilityLabel, style }: any) =>
      React.createElement('Text', { accessibilityLabel, style }, children),
    useTheme: () => ({ colors: { primary: '#000', secondary: '#eee', onPrimary: '#fff', onSecondary: '#000' }, roundness: 4 }),
    Avatar: {
      Image: () => null,
    },
  }
})

// ─── @xstate/react ────────────────────────────────────────────────────────────
jest.mock('@xstate/react', () => ({
  useSelector: (_service: any, selector: any) =>
    selector({ context: { user: { uid: 'user-1' } }, matches: () => false }),
}))

// ─── hooks ────────────────────────────────────────────────────────────────────
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({}),
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({
    data: { id: 'char-1', name: 'Ada', avatar: null },
    isLoading: false,
  }),
}))

jest.mock('~/hooks/useMessages', () => ({
  useChatMessages: () => [],
}))

jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: () => ({ sendMessage: jest.fn() }),
}))

const mockUserCredits = { totalCredits: 10, hasUnlimited: true }
jest.mock('~/hooks/useUserCredits', () => ({
  useUserCredits: () => ({ data: mockUserCredits }),
}))

// ─── components ───────────────────────────────────────────────────────────────
jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('~/components/ChatComposer', () => () => null)

import ChatView from '~/components/ChatView'

describe('ChatView wiki status region — accessibility', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockPlatformOS = 'ios'
    mockUserCredits.hasUnlimited = true
    mockGetEntityStatus.mockReturnValue({ ingesting: false, librarian: false })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not render the status region when both ingesting and librarian are false', () => {
    mockGetEntityStatus.mockReturnValue({ ingesting: false, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeUndefined()
  })

  it('renders the status region with accessibilityLiveRegion="polite" when ingesting', () => {
    mockGetEntityStatus.mockReturnValue({ ingesting: true, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeDefined()
    expect(statusRegion!.props.accessibilityLiveRegion).toBe('polite')
  })

  it('renders the status region with accessibilityLiveRegion="polite" when librarian is active', () => {
    mockGetEntityStatus.mockReturnValue({ ingesting: false, librarian: true })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeDefined()
  })

  it('ingesting text has accessibilityLabel "Ingesting document"', () => {
    mockGetEntityStatus.mockReturnValue({ ingesting: true, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const texts = tree.root.findAll((node) => String(node.type) === 'Text')
    const ingestingText = texts.find((t) => t.props.accessibilityLabel === 'Ingesting document')
    expect(ingestingText).toBeDefined()
    expect(ingestingText!.props.accessibilityLabel).toBe('Ingesting document')
  })

  it('librarian text has accessibilityLabel "Updating memory"', () => {
    mockGetEntityStatus.mockReturnValue({ ingesting: false, librarian: true })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const texts = tree.root.findAll((node) => String(node.type) === 'Text')
    const librarianText = texts.find((t) => t.props.accessibilityLabel === 'Updating memory')
    expect(librarianText).toBeDefined()
    expect(librarianText!.props.accessibilityLabel).toBe('Updating memory')
  })

  it('status region has accessibilityRole "status" on web', () => {
    mockPlatformOS = 'web'
    mockGetEntityStatus.mockReturnValue({ ingesting: true, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeDefined()
    expect(statusRegion!.props.accessibilityRole).toBe('status')
  })

  it('status region has no accessibilityRole on native (iOS)', () => {
    mockPlatformOS = 'ios'
    mockGetEntityStatus.mockReturnValue({ ingesting: true, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeDefined()
    expect(statusRegion!.props.accessibilityRole).toBeUndefined()
  })

  it('does not show status region for non-premium users (hasUnlimited=false)', () => {
    mockUserCredits.hasUnlimited = false
    mockGetEntityStatus.mockReturnValue({ ingesting: true, librarian: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<ChatView characterId="char-1" />) })
    act(() => { jest.advanceTimersByTime(2100) })

    // getEntityStatus should never be called since polling is skipped for non-premium
    expect(mockGetEntityStatus).not.toHaveBeenCalled()

    const views = tree.root.findAll((node) => String(node.type) === 'View')
    const statusRegion = views.find((v) => v.props.accessibilityLiveRegion === 'polite')
    expect(statusRegion).toBeUndefined()
  })
})

