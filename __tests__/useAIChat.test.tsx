import React from 'react'
import { act, create } from 'react-test-renderer'

const mockSendMessageWithAIResponse = jest.fn()
const mockUseChatMessages = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockCancelQueries = jest.fn()
const mockGetQueryData = jest.fn()
const mockSetQueryData = jest.fn()
const mockSend = jest.fn()
const mockReportError = jest.fn()
const mockCharacterWikiRead = jest.fn().mockResolvedValue(null)
const mockCharacterWikiWrite = jest.fn().mockResolvedValue(undefined)

jest.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn, onMutate, onSuccess, onError }: any) => ({
    mutateAsync: async (message: unknown) => {
      const context = await onMutate?.(message)

      try {
        const result = await mutationFn(message)
        onSuccess?.(result)
        return result
      } catch (error) {
        onError?.(error, message, context)
        throw error
      }
    },
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
    setQueryData: mockSetQueryData,
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

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  formatContext: jest.fn((bundle) => '[MEMORY]\nFacts:\n[/MEMORY]'),
  useWiki: jest.fn(() => null),
}))

jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: jest.fn(() => ({
    status: { ingesting: false, librarian: false, heal: false },
    isBusy: false,
    error: null,
    read: (...args: unknown[]) => mockCharacterWikiRead(...args),
    write: (...args: unknown[]) => mockCharacterWikiWrite(...args),
    ingest: jest.fn(),
    forget: jest.fn(),
    sync: jest.fn(),
    hasChanged: jest.fn(),
  })),
}))

jest.mock('~/utilities/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}))

jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: jest.fn(),
  getUnsyncedMessages: jest.fn().mockResolvedValue([]),
  markMessagesAsSynced: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('~/services/syncMessage', () => ({
  toSyncMessage: jest.fn((msg: any) => msg),
}))

jest.mock('~/services/messageService', () => ({
  sendMessage: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('~/hooks/useEdgeAgent', () => ({
  useEdgeAgent: jest.fn(() => ({
    sendMessage: jest.fn().mockResolvedValue({ escalated: true, text: undefined }),
    escalationState: 'idle',
  })),
  EscalationState: {},
}))

const { useAIChat } = require('~/hooks/useAIChat')

type HookValue = ReturnType<typeof useAIChat>

function renderUseAIChat(overrides: Partial<{ save_to_cloud: number }> = {}): HookValue {
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
        save_to_cloud: overrides.save_to_cloud ?? 1, // Default: cloud-synced so escalation path is tested
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
    mockCharacterWikiRead.mockResolvedValue(null)
    mockCharacterWikiWrite.mockResolvedValue(undefined)
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

    expect(mockCharacterWikiRead).toHaveBeenCalledWith('Hi there')
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

  it('sends only user messages as unsyncedHistory and marks only user message IDs synced', async () => {
    const database = require('~/database/messageDatabase')
    database.getUnsyncedMessages.mockResolvedValue([
      {
        id: 'msg-1',
        sender_user_id: 'user-1',
        text: 'hello',
      },
      {
        id: 'msg-2',
        sender_user_id: 'other-user',
        text: 'world',
      },
    ])

    mockSendMessageWithAIResponse.mockResolvedValue({ usageSnapshot: null, cloudSyncSucceeded: true })

    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-2',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSendMessageWithAIResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'user-1',
      [],
      expect.objectContaining({
        unsyncedHistory: [
          expect.objectContaining({ id: 'msg-1', sender_user_id: 'user-1' }),
        ],
      }),
    )

    expect(database.markMessagesAsSynced).toHaveBeenCalledWith(['msg-1'])
  })

  it('falls through to Firebase path when a local-only character escalates', async () => {
    const hook = renderUseAIChat({ save_to_cloud: 0 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-local-only',
        text: 'Hi',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
    expect(require('~/database/messageDatabase').saveAIMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "I'm running in local-only mode and can't access your deep cloud memory right now.",
      expect.any(Object),
    )
  })

  it('reports non-busy wiki read errors with wiki:read context', async () => {
    mockCharacterWikiRead.mockRejectedValue(new Error('read failed'))
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-read-1',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), 'wiki:char-1:read')
  })

  it('keeps optimistic user messages when credits are insufficient', async () => {
    const failedPreconditionError = new Error('Insufficient credits') as any
    failedPreconditionError.code = 'functions/failed-precondition'
    mockSendMessageWithAIResponse.mockRejectedValue(failedPreconditionError)

    mockGetQueryData.mockReturnValue([
      {
        _id: 'msg-optimistic',
        text: 'Optimistic user text',
        user: { _id: 'user-1' },
      },
    ])

    const hook = renderUseAIChat()

    await expect(
      act(async () => {
        await hook.sendMessage({
          _id: 'msg-optimistic',
          text: 'Hello',
          createdAt: new Date('2026-04-27T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      }),
    ).rejects.toThrow(failedPreconditionError)

    expect(mockSetQueryData).toHaveBeenCalledTimes(1)
  })

  it('does not report WikiBusyError from wiki read', async () => {
    const { WikiBusyError } = require('@equationalapplications/expo-llm-wiki')
    mockCharacterWikiRead.mockRejectedValue(new WikiBusyError('ingest', 'char-1'))
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-read-2',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('reports non-busy wiki observation write errors with wiki:write context', async () => {
    const writeError = new Error('write failed')
    mockCharacterWikiWrite.mockRejectedValue(writeError)
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-write-1',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    const sendCall = mockSendMessageWithAIResponse.mock.calls[0]
    const opts = sendCall[4] as { onWriteObservation?: (id: string, text: string) => void }
    expect(opts.onWriteObservation).toEqual(expect.any(Function))

    await act(async () => {
      opts.onWriteObservation!('char-1', 'observation text')
      // onWriteObservation returns void and attaches .catch on a microtask; flush so reportError runs
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockReportError).toHaveBeenCalledWith(writeError, 'wiki:char-1:write')
  })

  it('does not report WikiBusyError from wiki observation write', async () => {
    const { WikiBusyError } = require('@equationalapplications/expo-llm-wiki')
    mockCharacterWikiWrite.mockRejectedValue(new WikiBusyError('ingest', 'char-1'))
    const hook = renderUseAIChat()

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-write-2',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    const sendCall = mockSendMessageWithAIResponse.mock.calls[0]
    const opts = sendCall[4] as { onWriteObservation?: (id: string, text: string) => void }
    await act(async () => {
      opts.onWriteObservation!('char-1', 'observation text')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockReportError).not.toHaveBeenCalled()
  })
})
