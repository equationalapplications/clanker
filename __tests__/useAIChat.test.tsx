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
const mockSaveAIMessage = jest.fn()

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
  triggerConversationSummary: jest.fn(),
  getRecentConversationHistory: jest.fn((messages: any[]) => messages),
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
  saveAIMessage: mockSaveAIMessage,
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

const mockUseEdgeAgent = require('~/hooks/useEdgeAgent').useEdgeAgent as jest.Mock
const mockCallCloudAgent = jest.fn()
const mockListTasks = jest.fn().mockResolvedValue([])

jest.mock('~/services/cloudAgentService', () => ({
  callCloudAgent: (...args: unknown[]) => mockCallCloudAgent(...args),
}))

jest.mock('~/database/taskDatabase', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
}))

const { useAIChat } = require('~/hooks/useAIChat')

type HookValue = ReturnType<typeof useAIChat>

function renderUseAIChat(overrides: Partial<{ save_to_cloud: number; cloud_id: string | null }> = {}): HookValue {
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
        save_to_cloud: overrides.save_to_cloud ?? 1,
        cloud_id: 'cloud_id' in overrides ? overrides.cloud_id : 'cloud-char-uuid-1',
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
    mockSaveAIMessage.mockResolvedValue({
      _id: 'ai-1',
      text: 'Hello!',
      user: { _id: 'char-1' },
    })
    mockCallCloudAgent.mockResolvedValue({ reply: 'Cloud reply!', toolCalls: [] })
    mockListTasks.mockResolvedValue([])
  })

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
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

  it('uses edge text directly without Firebase when edge agent resolves for local-only character', async () => {
    mockUseEdgeAgent.mockReturnValueOnce({
      sendMessage: jest.fn().mockResolvedValue({
        escalated: false,
        text: 'Hello from on-device!',
      }),
      escalationState: 'idle',
    })

    const hook = renderUseAIChat({ save_to_cloud: 0 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-local-only',
        text: 'Hi',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSendMessageWithAIResponse).not.toHaveBeenCalled()
    expect(require('~/database/messageDatabase').saveAIMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'Hello from on-device!',
      expect.any(String),
      expect.any(Object),
    )
  })

  it('falls through to generateReply when edge agent returns no text for local-only character', async () => {
    mockUseEdgeAgent.mockReturnValueOnce({
      sendMessage: jest.fn().mockResolvedValue({ escalated: false, text: undefined }),
      escalationState: 'idle',
    })

    mockSendMessageWithAIResponse.mockResolvedValue({ usageSnapshot: null, cloudSyncSucceeded: false })

    const hook = renderUseAIChat({ save_to_cloud: 0 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-local-only-fallback',
        text: 'Hi',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
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

  describe('Cloud Agent path', () => {
    beforeEach(() => {
      mockUseEdgeAgent.mockReturnValue({
        sendMessage: jest.fn().mockResolvedValue({ escalated: true, text: undefined }),
        escalationState: 'escalating',
      })
      process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://10.0.0.1:8080/agent/run'
    })

    it('calls Cloud Agent when isCloudSynced=true and URL is configured', async () => {
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-cloud-1',
          text: 'Use cloud agent',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockCallCloudAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Use cloud agent',
          characterId: 'cloud-char-uuid-1',
          history: expect.any(Array),
          unsyncedHistory: expect.any(Array),
        }),
      )
      expect(mockSendMessageWithAIResponse).not.toHaveBeenCalled()
    })

    it('sends local tasks as unsyncedHistory', async () => {
      mockListTasks.mockResolvedValue([
        { id: 't1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
      ])
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-cloud-2',
          text: 'Tasks please',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockCallCloudAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          unsyncedHistory: [
            { type: 'task', id: 't1', title: 'Buy milk', status: 'pending', createdAt: 1000 },
          ],
        }),
      )
    })

    it('saves Cloud Agent reply as AI message', async () => {
      mockCallCloudAgent.mockResolvedValue({ reply: 'Cloud says hi!', toolCalls: [] })
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-cloud-3',
          text: 'Hello',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockSaveAIMessage).toHaveBeenCalledWith(
        'char-1',
        'user-1',
        'Cloud says hi!',
        expect.any(String),
        expect.objectContaining({ user: expect.objectContaining({ _id: 'char-1' }) }),
      )
    })

    it('falls through to Firebase when URL is not configured', async () => {
      delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-firebase',
          text: 'Fallback to firebase',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockCallCloudAgent).not.toHaveBeenCalled()
      expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
    })

    it('falls through to Firebase when isCloudSynced=false', async () => {
      const hook = renderUseAIChat({ save_to_cloud: 0 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-firebase-2',
          text: 'Not cloud synced',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockCallCloudAgent).not.toHaveBeenCalled()
      expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
    })

    it('falls through to Firebase when cloud_id is null (character not yet synced to cloud)', async () => {
      const hook = renderUseAIChat({ save_to_cloud: 1, cloud_id: null })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-no-cloud-id',
          text: 'No cloud id yet',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockCallCloudAgent).not.toHaveBeenCalled()
      expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
    })

    it('propagates Cloud Agent errors so onError can roll back the optimistic update', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('Cloud Agent responded with 500'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await expect(
          hook.sendMessage({
            _id: 'msg-fail',
            text: 'Failing',
            createdAt: new Date('2026-06-02T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any),
        ).rejects.toThrow('Cloud Agent responded with 500')
      })

      expect(mockSendMessageWithAIResponse).not.toHaveBeenCalled()
    })

    it('dispatches USAGE_SNAPSHOT_RECEIVED to authService when cloud agent returns usageSnapshot', async () => {
      mockCallCloudAgent.mockResolvedValue({
        reply: 'Cloud says hi!',
        toolCalls: [],
        usageSnapshot: { remainingCredits: 26 },
      })
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-snapshot-1',
          text: 'Use cloud agent',
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 26,
          planTier: null,
          planStatus: null,
        }),
      )
    })

    it('does NOT dispatch USAGE_SNAPSHOT_RECEIVED when usageSnapshot is null', async () => {
      mockCallCloudAgent.mockResolvedValue({
        reply: 'Cloud says hi!',
        toolCalls: [],
        usageSnapshot: null,
      })
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-snapshot-2',
          text: 'Use cloud agent',
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      const cloudAgentSnapshots = mockSend.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as { type?: string; source?: string }).type === 'USAGE_SNAPSHOT_RECEIVED' &&
          (call[0] as { type?: string; source?: string }).source === 'cloudAgent',
      )
      expect(cloudAgentSnapshots).toHaveLength(0)
    })

    it('dispatches USAGE_SNAPSHOT_RECEIVED with remainingCredits: 0 on CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await expect(
          hook.sendMessage({
            _id: 'msg-402-1',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any),
        ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 0,
          planTier: null,
          planStatus: null,
        }),
      )
    })

    it('invalidates message query on CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await expect(
          hook.sendMessage({
            _id: 'msg-402-2',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any),
        ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
      })

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: expect.arrayContaining(['messages']) }),
      )
    })

    it('rethrows CLOUD_AGENT_INSUFFICIENT_CREDITS so mutation onError still runs', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await expect(
        act(async () => {
          await hook.sendMessage({
            _id: 'msg-402-3',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any)
        }),
      ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
    })
  })
})
