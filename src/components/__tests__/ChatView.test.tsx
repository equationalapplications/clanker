import React from 'react'
import { PaperProvider } from 'react-native-paper'
import { render } from '@testing-library/react-native'
import { ChatViewContent } from '../ChatView'
import type { Character } from '~/services/characterService'
import type { Message } from '~/types/chat'

const mockUseAIChat = jest.fn()
jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: (props: unknown) => mockUseAIChat(props),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: 100, isLoading: false }),
}))

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn().mockReturnValue({ uri: null, isResolved: true }),
}))

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    getParent: jest.fn(() => undefined),
    addListener: jest.fn(() => jest.fn()),
  }),
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

jest.mock('react-native-keyboard-controller', () => ({
  // jest.mock factories are hoisted, so they can only reference hoisted
  // variables (`require` is hoisted; ES imports are not) — see
  // GroundingFooter.test.tsx for the same pattern.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be require(), see comment above
  KeyboardAvoidingView: require('react-native').View,
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => ({ ingesting: false, librarian: false }),
}))

jest.mock('~/components/LowPowerBanner', () => ({ LowPowerBanner: () => null }))
jest.mock('~/components/ChatInputBar', () => ({ ChatInputBar: () => null }))

// Fields beyond these that Character requires: extend the literal, not a cast.
const baseCharacter = {
  id: 'char-1',
  user_id: 'user-1',
  owner_user_id: 'user-1',
  name: 'Bot',
  appearance: '',
  traits: '',
  emotions: '',
  context: '',
  avatar: null,
  active_image_id: null,
  cloud_id: 'cloud-1',
  is_public: false,
  created_at: '',
  updated_at: '',
  save_to_cloud: true,
} as Character

const baseChat = {
  messages: [] as Message[],
  sendMessage: jest.fn(() => Promise.resolve()),
  sendPhoto: jest.fn(() => Promise.resolve(true)),
  canSendPhoto: false,
  isGeneratingResponse: false,
  error: null,
  escalationState: 'idle' as const,
  activeTool: null,
  streamingMessage: null,
}

const renderChat = (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>)

describe('ChatView streamed/persisted dedupe', () => {
  it('renders the persisted row exactly once while the streamed row is still set', () => {
    // Worst-case overlap: the refetch delivered the persisted row while the
    // hook still holds the streamed copy. Same _id (Task 1 invariant), so
    // without the dedupe guard the list renders the same key twice.
    const row: Message = {
      _id: 'ai_same',
      text: 'final answer text',
      createdAt: new Date(),
      user: { _id: 'char-1', name: 'Bot' },
    }
    mockUseAIChat.mockReturnValue({
      ...baseChat,
      messages: [row],
      streamingMessage: { ...row },
    })

    const view = renderChat(
      <ChatViewContent characterId="char-1" character={baseCharacter} currentUserId="user-1" />,
    )
    expect(view.getAllByText('final answer text')).toHaveLength(1)

    // And the steady state after the hook clears the streamed copy.
    mockUseAIChat.mockReturnValue({ ...baseChat, messages: [row], streamingMessage: null })
    // Same wrapper as the initial render: swapping PaperProvider out of the
    // root between renders tears down the whole tree and leaves
    // react-test-renderer's fiber references stale ("Unable to find node on an
    // unmounted component") when the next query walks the old tree.
    view.rerender(
      <PaperProvider>
        <ChatViewContent characterId="char-1" character={baseCharacter} currentUserId="user-1" />
      </PaperProvider>,
    )
    expect(view.getAllByText('final answer text')).toHaveLength(1)
  })
})
