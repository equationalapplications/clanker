import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useAIChat } from '../useAIChat'
import { findCharacterImageByMessageId } from '~/database/characterImageDatabase'
import { saveCharacterImage } from '~/services/characterImageService'
import { reportError } from '~/utilities/reportError'
import type { Message } from '~/types/chat'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const mockCallCloudAgent = jest.fn()
jest.mock('~/services/cloudAgentService', () => ({
  callCloudAgent: (...args: unknown[]) => mockCallCloudAgent(...args),
}))

const mockSaveAIMessage = jest.fn()
jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: (...args: unknown[]) => mockSaveAIMessage(...args),
  getUnsyncedMessages: jest.fn(() => Promise.resolve([])),
  markMessagesAsSynced: jest.fn(() => Promise.resolve()),
}))

const mockPersistUserMessage = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve())
jest.mock('~/services/messageService', () => ({
  sendMessage: (...args: unknown[]) => mockPersistUserMessage(...args),
}))

const mockTriggerSummary = jest.fn(() => Promise.resolve())
jest.mock('~/services/aiChatService', () => ({
  getRecentConversationHistory: jest.fn((history: unknown[]) => history.slice(-20)),
  triggerConversationSummary: () => mockTriggerSummary(),
  // Real value import at useAIChat.ts:5 — without it a future Firebase-path
  // test dies with "sendMessageWithAIResponse is not a function".
  sendMessageWithAIResponse: jest.fn(),
}))

jest.mock('~/hooks/useMessages', () => ({
  // Faithful shape of the real factory (src/hooks/useMessages.ts:26-31) — the
  // hook uses these keys for optimistic cache writes and invalidation.
  useChatMessages: jest.fn(() => [] as Message[]),
  messageKeys: {
    all: ['messages'] as const,
    lists: () => ['messages', 'list'] as const,
    list: (characterId: string, recipientUserId: string) =>
      ['messages', 'list', characterId, recipientUserId] as const,
  },
}))

const mockAuthSend = jest.fn()
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({ send: mockAuthSend }),
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  formatContext: jest.fn(() => ''),
  useWiki: () => ({
    read: jest.fn(() => Promise.resolve(null)),
    write: jest.fn(() => Promise.resolve()),
  }),
}))

const mockWikiWrite = jest.fn(() => Promise.resolve())
jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: () => ({
    read: jest.fn(() => Promise.resolve(null)),
    write: mockWikiWrite,
  }),
}))

// Escalate unconditionally so the mutation takes the cloud-agent path.
jest.mock('~/hooks/useEdgeAgent', () => ({
  useEdgeAgent: () => ({
    sendMessage: jest.fn(() =>
      Promise.resolve({ escalated: true, text: undefined, usageSnapshot: null }),
    ),
    escalationState: 'idle',
  }),
  EscalationState: {},
}))

jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/services/syncMessage', () => ({ toSyncMessage: jest.fn(() => ({})) }))
jest.mock('~/database/taskDatabase', () => ({ listTasks: jest.fn(() => Promise.resolve([])) }))
jest.mock('~/services/CharacterPromptBuilder', () => ({
  buildContentHistory: jest.fn(() => []),
}))
jest.mock('~/auth/devSandboxFlag', () => ({ isDevSandboxEnabled: () => false }))
jest.mock('~/services/usageSnapshot', () => ({ usageSnapshotFromError: jest.fn(() => null) }))
jest.mock('~/database/characterImageDatabase', () => ({
  findCharacterImageByMessageId: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: jest.fn(() => Promise.resolve()),
  setActiveImageId: jest.fn(),
}))
jest.mock('../../../shared/dev-sandbox', () => ({
  DEV_CLOUD_CHARACTER_ID: 'dev-sandbox-character',
}))

const character = {
  id: 'char-1',
  name: 'Bot',
  appearance: '',
  traits: '',
  emotions: '',
  context: '',
  cloud_id: 'cloud-1',
  save_to_cloud: 1,
}

const userMessage: Message = {
  _id: 'msg_1',
  text: 'hi',
  createdAt: new Date(),
  user: { _id: 'user-1', name: 'You' },
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // After the turn, cache entries (the optimistic query write, the settled
      // mutation) arm react-query's default five-minute GC timer, which keeps
      // the jest worker alive until it is force-exited ("A worker process has
      // failed to exit gracefully"). Reclaim immediately — nothing needs to
      // survive the test.
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  })
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

const originalCloudAgentUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://localhost:8080'
  // The sendPhoto tests below leave a PERSISTENT mockResolvedValue({ id: … })
  // on this mock; clearAllMocks only clears call history, not implementations.
  // Re-arm the factory default so turn-scoped tests start without a phantom
  // dedupe hit.
  ;(findCharacterImageByMessageId as jest.Mock).mockResolvedValue(null)
  mockSaveAIMessage.mockImplementation(
    (_characterId: string, _userId: string, text: string, id: string) =>
      Promise.resolve({
        _id: id,
        text,
        createdAt: new Date(),
        user: { _id: 'char-1', name: 'Bot' },
      }),
  )
})

afterEach(() => {
  // Assigning undefined into process.env stores the string "undefined", which
  // reads as enabled — delete instead so a genuinely unset var stays unset.
  if (originalCloudAgentUrl === undefined) {
    delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
  } else {
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = originalCloudAgentUrl
  }
})

describe('useAIChat streaming id unification', () => {
  it('persists the AI reply under the same _id it streamed under', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    let resolveTurn!: () => void
    mockCallCloudAgent.mockImplementation(
      (_payload: unknown, handlers: { onToken?: (text: string) => void }) =>
        new Promise((resolve) => {
          resolveTurn = () => resolve({ reply: 'final reply', toolCalls: [], usageSnapshot: null })
          handlers.onToken?.('partial ')
        }),
    )

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage(userMessage)
    })

    // Stream started — capture the streamed row's id.
    await waitFor(() => expect(result.current.streamingMessage?.text).toBe('partial '))
    const streamedId = result.current.streamingMessage!._id
    expect(streamedId).toMatch(/^ai_/)

    await act(async () => {
      resolveTurn()
    })
    await waitFor(() => expect(mockSaveAIMessage).toHaveBeenCalled())
    await sendPromise

    // THE invariant: the persisted row carries the streamed id, not a fresh one.
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'final reply',
      streamedId,
      expect.anything(),
    )
  })

  it('clears the streamed row only after the post-success refetch resolves', async () => {
    const { queryClient, Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    // Controllable invalidation: the refetch completes only when we resolve it.
    let resolveInvalidate!: () => void
    jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve
        }),
    )

    mockCallCloudAgent.mockResolvedValue({
      reply: 'final reply',
      toolCalls: [],
      usageSnapshot: null,
    })

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage(userMessage)
    })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())

    // Mutation done, refetch pending — the bubble must still be held.
    expect(result.current.streamingMessage).not.toBeNull()

    await act(async () => {
      resolveInvalidate()
    })
    await waitFor(() => expect(result.current.streamingMessage).toBeNull())
    await sendPromise
  })

  it('clears the streamed row immediately when the turn fails', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))

    await act(async () => {
      await result.current.sendMessage(userMessage).catch(() => {})
    })

    // No persisted row will ever arrive on failure — nothing to hand off to.
    expect(result.current.streamingMessage).toBeNull()
  })

  it('sendPhoto holds the streamed row until the refetch resolves', async () => {
    const { queryClient, Wrapper } = createWrapper()
    ;(findCharacterImageByMessageId as jest.Mock).mockResolvedValue({ id: 'existing' })
    mockCallCloudAgent.mockResolvedValue({
      reply: 'what a nice photo',
      toolCalls: [],
      usageSnapshot: null,
    })

    let resolveInvalidate!: () => void
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve
        }),
    )

    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    const photo = {
      messageId: 'msg_photo_1',
      imageId: 'img_1',
      uri: 'file:///photo.jpg',
      width: 10,
      height: 10,
      attachment: {},
      variants: {},
    } as never

    let photoPromise!: Promise<boolean>
    act(() => {
      photoPromise = result.current.sendPhoto(photo, 'look')
    })
    await waitFor(() => expect(result.current.streamingMessage).not.toBeNull())
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())

    // Held until the refetch resolves — same contract as the text path.
    expect(result.current.streamingMessage).not.toBeNull()

    await act(async () => {
      resolveInvalidate()
    })
    await waitFor(() => expect(result.current.streamingMessage).toBeNull())
    await expect(photoPromise).resolves.toBe(true)
  })

  it('keeps photo-turn gates closed until the refetch settles so the next turn is not wiped', async () => {
    const { queryClient, Wrapper } = createWrapper()
    ;(findCharacterImageByMessageId as jest.Mock).mockResolvedValue({ id: 'existing' })

    // Every invalidateQueries call parks until the test resolves it. Entries
    // land in call order: turn 1's cleanup first, then any later turn's
    // onSuccess — resolving them one at a time keeps the interleaving exact.
    const invalidationResolvers: (() => void)[] = []
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          invalidationResolvers.push(resolve)
        }),
    )

    // Turn 1 (photo): the model call resolves immediately, so its finally is
    // parked on invalidation #0 while the test holds it there.
    mockCallCloudAgent.mockImplementationOnce(() =>
      Promise.resolve({ reply: 'photo reply', toolCalls: [], usageSnapshot: null }),
    )
    // A later turn streams a token before resolving, so its live bubble is
    // observable. The base implementation covers any further calls.
    mockCallCloudAgent.mockImplementationOnce((_payload, handlers) => {
      handlers.onToken?.('second ')
      return Promise.resolve({ reply: 'second reply', toolCalls: [], usageSnapshot: null })
    })
    mockCallCloudAgent.mockImplementation(() =>
      Promise.resolve({ reply: 'overflow', toolCalls: [], usageSnapshot: null }),
    )

    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    const photo = {
      messageId: 'msg_photo_race',
      imageId: 'img_race',
      uri: 'file:///photo.jpg',
      width: 10,
      height: 10,
      attachment: {},
      variants: {},
    } as never

    let photoPromise!: Promise<boolean>
    act(() => {
      photoPromise = result.current.sendPhoto(photo, 'look')
    })
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1))
    await act(async () => {})

    // Turn 1 is parked mid-finally. Its bubble must still be held…
    expect(result.current.streamingMessage).not.toBeNull()
    // …and its gates must STILL be closed. Releasing them before the refetch
    // settles is exactly the bug that let a second turn start, only for this
    // cleanup to destroy that second turn's bubble when it resumed.
    expect(result.current.isGeneratingResponse).toBe(true)

    const secondUserMessage: Message = {
      _id: 'msg_2',
      text: 'again',
      createdAt: new Date(),
      user: { _id: 'user-1', name: 'You' },
    }

    let secondPromise!: Promise<void>
    act(() => {
      secondPromise = result.current.sendMessage(secondUserMessage)
    })
    // Drain generously: with a premature release, turn 2 races through
    // persistence and into the model within a few microtask generations.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    // The mutex was never opened, so turn 2 cannot have reached the model.
    expect(mockCallCloudAgent).toHaveBeenCalledTimes(1)

    // Settle turn 1's refetch — bubble and gates clear together.
    await act(async () => {
      const resolveFirst = invalidationResolvers.shift()
      resolveFirst?.()
    })
    await waitFor(() => expect(result.current.streamingMessage).toBeNull())
    await waitFor(() => expect(result.current.isGeneratingResponse).toBe(false))
    await expect(photoPromise).resolves.toBe(true)

    // With the gates genuinely free, the retried second turn streams normally,
    // and its bubble stays alive until its OWN refetch settles.
    let retryPromise!: Promise<void>
    act(() => {
      retryPromise = result.current.sendMessage(secondUserMessage)
    })
    await waitFor(() => expect(result.current.streamingMessage?.text).toBe('second '))
    expect(result.current.isGeneratingResponse).toBe(true)

    while (invalidationResolvers.length > 0) {
      await act(async () => {
        const resolveNext = invalidationResolvers.shift()
        resolveNext?.()
      })
    }
    await waitFor(() => expect(result.current.streamingMessage).toBeNull())
    await retryPromise
    await expect(secondPromise).resolves.toBeUndefined()
  })
})

describe('agent chat image ingestion', () => {
  const fireTurnWithImage = async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    let resolveTurn!: () => void
    let fireImage!: (img: { imageBase64: string; mimeType: string }) => void
    mockCallCloudAgent.mockImplementation(
      (
        _payload: unknown,
        handlers: {
          onToken?: (text: string) => void
          onAgentImage?: (img: { imageBase64: string; mimeType: string }) => void
        },
      ) =>
        new Promise((resolve) => {
          fireImage = handlers.onAgentImage!
          resolveTurn = () =>
            resolve({
              reply: 'here is your chart',
              toolCalls: ['generate_image'],
              usageSnapshot: { remainingCredits: 800 },
            })
          handlers.onToken?.('drawing…')
        }),
    )

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage(userMessage)
    })
    await waitFor(() => expect(result.current.streamingMessage?.text).toBe('drawing…'))
    const streamedId = result.current.streamingMessage!._id

    await act(async () => {
      fireImage({ imageBase64: 'QUJD', mimeType: 'image/png' })
      resolveTurn()
    })
    await waitFor(() => expect(mockSaveAIMessage).toHaveBeenCalled())
    await sendPromise
    return { streamedId }
  }

  it('persists via saveCharacterImage and carries imageId on the assistant row', async () => {
    const { streamedId } = await fireTurnWithImage()

    expect(saveCharacterImage).toHaveBeenCalledTimes(1)
    expect(saveCharacterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        userId: 'user-1',
        uri: 'data:image/png;base64,QUJD',
        width: 1024,
        height: 1024,
        source: 'chat',
        messageId: streamedId,
      }),
    )
    const savedImageId = (saveCharacterImage as jest.Mock).mock.calls[0][0].imageId as string
    expect(savedImageId).toMatch(UUID_LIKE)

    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.objectContaining({ imageId: savedImageId }),
    )

    // A chat image is a gallery row, never an avatar choice (same rule as photos).
    const imageServiceMock = jest.requireMock('~/services/characterImageService') as {
      setActiveImageId: jest.Mock
    }
    expect(imageServiceMock.setActiveImageId).not.toHaveBeenCalled()
  })

  it('reuses the deduped row id instead of saving twice on retry', async () => {
    const { findCharacterImageByMessageId: mockFind } = jest.requireMock(
      '~/database/characterImageDatabase',
    ) as { findCharacterImageByMessageId: jest.Mock }
    mockFind.mockResolvedValueOnce({ id: 'existing-img-id' })

    const { streamedId } = await fireTurnWithImage()

    expect(saveCharacterImage).not.toHaveBeenCalled()
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.objectContaining({ imageId: 'existing-img-id' }),
    )
  })

  it('keeps the text reply when the local save fails', async () => {
    ;(saveCharacterImage as jest.Mock).mockRejectedValueOnce(new Error('disk full'))

    const { streamedId } = await fireTurnWithImage()

    expect(reportError).toHaveBeenCalled()
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.not.objectContaining({ imageId: expect.anything() }),
    )
  })

  it('persists no imageId on plain text turns', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )
    mockCallCloudAgent.mockResolvedValue({
      reply: 'plain text',
      toolCalls: [],
      usageSnapshot: null,
    })
    await act(async () => {
      await result.current.sendMessage(userMessage)
    })
    expect(saveCharacterImage).not.toHaveBeenCalled()
    const dataArg = mockSaveAIMessage.mock.calls[0][4] as Record<string, unknown>
    expect(dataArg.imageId).toBeUndefined()
  })
})
