import React from 'react'
import { act, create } from 'react-test-renderer'
import { useAIChat } from '~/hooks/useAIChat'

const mockSendMessageWithAIResponse = jest.fn()
const mockUseChatMessages = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockCancelQueries = jest.fn()
const mockGetQueryData = jest.fn()
const mockSetQueryData = jest.fn()
const mockSend = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn, onSuccess, onError }: any) => ({
    mutateAsync: async (message: unknown) => {
      try {
        const result = await mutationFn(message)
        onSuccess?.(result)
        return result
      } catch (error) {
        onError?.(error, message, undefined)
        throw error
      }
    },
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
    cancelQueries: (...args: unknown[]) => mockCancelQueries(...args),
    getQueryData: (...args: unknown[]) => mockGetQueryData(...args),
    setQueryData: (...args: unknown[]) => mockSetQueryData(...args),
  }),
}))

jest.mock('~/services/aiChatService', () => ({
  sendMessageWithAIResponse: (...args: unknown[]) => mockSendMessageWithAIResponse(...args),
  Character: {},
}))

jest.mock('~/hooks/useMessages', () => ({
  useChatMessages: (...args: unknown[]) => mockUseChatMessages(...args),
  messageKeys: {
    list: (...parts: unknown[]) => ['messages', ...parts],
  },
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
}))

jest.mock('~/services/usageSnapshot', () => ({
  usageSnapshotFromError: jest.fn(() => null),
}))

const mockWikiRead = jest.fn().mockResolvedValue(null)
const mockWikiWriteExecute = jest.fn().mockResolvedValue(undefined)

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  useWiki: jest.fn(() => ({ read: mockWikiRead })),
  useWikiWrite: jest.fn(() => ({ execute: mockWikiWriteExecute })),
  formatContext: jest.fn((bundle) => '[MEMORY]\nFacts:\n[/MEMORY]'),
}))

type HookValue = ReturnType<typeof useAIChat>

function renderUseAIChat(): HookValue {
  let hookValue: HookValue | null = null

  function Probe() {
    hookValue = useAIChat({
      characterId: 'char-1',
      userId: 'user-1',
      character: {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'kind',
        emotions: 'calm',
        context: 'friendly',
      },
    })
    return null
  }

  act(() => {
    create(<Probe />)
  })

  if (hookValue === null) {
    throw new Error('useAIChat did not produce value')
  }

  return hookValue as HookValue
}

describe('useAIChat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseChatMessages.mockReturnValue([])
    mockSendMessageWithAIResponse.mockResolvedValue({ usageSnapshot: null })
  })

  it('reads wiki memory and provides write callback for free-tier users', async () => {
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-free',
        text: 'Hi there',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockWikiRead).toHaveBeenCalledWith('char-1', 'Hi there')
    expect(mockSendMessageWithAIResponse).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'msg-free' }),
      expect.objectContaining({ id: 'char-1' }),
      'user-1',
      [],
      expect.objectContaining({
        onWriteObservation: expect.any(Function),
      }),
    )
  })

  it('provides write callback when sending a message', async () => {
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-1',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSendMessageWithAIResponse).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'msg-1' }),
      expect.objectContaining({ id: 'char-1' }),
      'user-1',
      [],
      expect.objectContaining({
        onWriteObservation: expect.any(Function),
      }),
    )
  })
})
