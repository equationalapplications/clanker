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
const mockReportError = jest.fn()
const mockCharacterWikiRead = jest.fn().mockResolvedValue(null)
const mockCharacterWikiWrite = jest.fn().mockResolvedValue(undefined)

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

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  formatContext: jest.fn((bundle) => '[MEMORY]\nFacts:\n[/MEMORY]'),
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

    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), 'wiki:read')
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

    expect(mockReportError).toHaveBeenCalledWith(writeError, 'wiki:write')
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
