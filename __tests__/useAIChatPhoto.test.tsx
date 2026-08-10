import { renderHook, act } from '@testing-library/react-native'

// Mocks for the photo path — the rest of the cloud-agent surface is mocked
// further below. Keeping each module mocked separately is what lets each test
// reach into a single seam (e.g. `findCharacterImageByMessageId`) without
// rewriting a do-everything mock.

const mockSaveCharacterImage = jest.fn()
const mockFindCharacterImageByMessageId = jest.fn()
const mockGetImageAttachment = jest.fn()
const mockPersistUserMessage = jest.fn().mockResolvedValue(undefined)
const mockCallCloudAgent = jest.fn()
const mockReportError = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockCancelQueries = jest.fn()
const mockGetQueryData = jest.fn()
const mockSetQueryData = jest.fn()
const mockSend = jest.fn()
const mockCharacterWikiRead = jest.fn().mockResolvedValue(null)
const mockCharacterWikiWrite = jest.fn().mockResolvedValue(undefined)
const mockUseChatMessages = jest.fn()
const mockSaveAIMessage = jest.fn()
const mockListTasks = jest.fn().mockResolvedValue([])
const mockIsDevSandboxEnabled = jest.fn(() => false)
const mockUseEdgeAgentFn = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn, onMutate, onSuccess, onError, onSettled }: any) => ({
    mutateAsync: async (message: unknown) => {
      const context = await onMutate?.(message)
      try {
        const result = await mutationFn(message)
        onSuccess?.(result)
        return result
      } catch (error) {
        onError?.(error, message, context)
        throw error
      } finally {
        onSettled?.()
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
  sendMessageWithAIResponse: jest.fn().mockResolvedValue({ usageSnapshot: null }),
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
  sendMessage: (...args: unknown[]) => mockPersistUserMessage(...args),
}))

jest.mock('~/hooks/useEdgeAgent', () => ({
  useEdgeAgent: (...args: unknown[]) => mockUseEdgeAgentFn(...args),
  EscalationState: {},
}))

jest.mock('~/services/cloudAgentService', () => ({
  callCloudAgent: (...args: unknown[]) => mockCallCloudAgent(...args),
}))

jest.mock('~/database/taskDatabase', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
}))

jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: (...args: unknown[]) => mockSaveCharacterImage(...args),
}))

jest.mock('~/database/characterImageDatabase', () => ({
  findCharacterImageByMessageId: (...args: unknown[]) =>
    mockFindCharacterImageByMessageId(...args),
}))

jest.mock('~/services/imageModelBytes', () => ({
  getImageAttachment: (...args: unknown[]) => mockGetImageAttachment(...args),
}))

jest.mock('~/auth/devSandboxFlag', () => ({
  isDevSandboxEnabled: () => mockIsDevSandboxEnabled(),
}))
jest.mock('~/auth/ensureDevSandboxCharacter', () => ({
  ensureDevSandboxCharacter: jest.fn(),
}))

const { useAIChat } = require('~/hooks/useAIChat')

type HookValue = ReturnType<typeof useAIChat>

const PHOTO = {
  imageId: '33333333-3333-4333-8333-333333333333',
  messageId: 'msg_1_abc',
  uri: 'file:///photo.jpg',
  width: 1600,
  height: 900,
  variants: {
    master: { base64: 'MASTER', mimeType: 'image/webp' as const },
    thumb: { base64: 'THUMB', mimeType: 'image/webp' as const },
  },
  attachment: { mimeType: 'image/webp' as const, data: 'MASTER' },
}

const cloudCharacterProps = {
  characterId: 'char-1',
  userId: 'user-1',
  character: {
    id: 'char-1',
    name: 'Nova',
    appearance: 'avatar',
    traits: 'kind',
    emotions: 'calm',
    context: 'friendly',
    save_to_cloud: 1,
    cloud_id: 'cloud-char-uuid-1',
  },
}

const localOnlyCharacterProps = {
  characterId: 'char-1',
  userId: 'user-1',
  character: {
    id: 'char-1',
    name: 'Nova',
    appearance: 'avatar',
    traits: 'kind',
    emotions: 'calm',
    context: 'friendly',
    save_to_cloud: 0,
    cloud_id: null,
  },
}

describe('useAIChat photo path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDevSandboxEnabled.mockReturnValue(false)
    mockUseChatMessages.mockReturnValue([])
    mockCharacterWikiRead.mockResolvedValue(null)
    mockCharacterWikiWrite.mockResolvedValue(undefined)
    mockSaveAIMessage.mockResolvedValue({
      _id: 'ai-1',
      text: 'Hello!',
      user: { _id: 'char-1' },
    })
    mockCallCloudAgent.mockResolvedValue({ reply: 'I see a photo.', toolCalls: [] })
    mockListTasks.mockResolvedValue([])
    mockFindCharacterImageByMessageId.mockResolvedValue(null)
    mockGetImageAttachment.mockResolvedValue(null)
    mockSaveCharacterImage.mockResolvedValue({
      id: PHOTO.imageId,
      character_id: 'char-1',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'inline:master',
      thumb_ref: 'inline:thumb',
      mime_type: 'image/webp',
      source: 'chat',
      sync_state: 'local',
      sync_attempts: 0,
      created_at: Date.now(),
      deleted_at: null,
      message_id: PHOTO.messageId,
    })
    mockUseEdgeAgentFn.mockReturnValue({
      sendMessage: jest.fn().mockResolvedValue({ escalated: true, text: undefined }),
      escalationState: 'escalating',
    })
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://10.0.0.1:8080/agent/run'
  })

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
  })

  it('persists the message with the render hint, commits the row, then calls the agent', async () => {
    const { result } = renderHook(() => useAIChat(cloudCharacterProps))

    await act(async () => {
      await result.current.sendPhoto(PHOTO, 'what is this?')
    })

    expect(mockPersistUserMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      expect.objectContaining({ _id: 'msg_1_abc', text: 'what is this?', imageId: PHOTO.imageId }),
    )
    // The base64 must never reach message_data — it would double the row size and
    // put a second copy of the photo in the message store.
    expect(mockPersistUserMessage.mock.calls[0][2].attachment).toBeUndefined()

    expect(mockSaveCharacterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat',
        imageId: PHOTO.imageId,
        messageId: 'msg_1_abc',
        variants: PHOTO.variants,
      }),
    )

    expect(mockCallCloudAgent).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [PHOTO.attachment] }),
      expect.anything(),
    )
  })

  it('keeps the photo when the reply throws', async () => {
    mockCallCloudAgent.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useAIChat(cloudCharacterProps))

    await act(async () => {
      await result.current.sendPhoto(PHOTO, 'what is this?').catch(() => {})
    })

    expect(mockSaveCharacterImage).toHaveBeenCalled()
    expect(result.current.error).toBeTruthy()
  })

  it('reuses the existing row on retry rather than consuming a second cap slot', async () => {
    mockFindCharacterImageByMessageId.mockResolvedValue({
      id: PHOTO.imageId,
      mime_type: 'image/webp',
    })
    mockGetImageAttachment.mockResolvedValue({ mimeType: 'image/webp', data: 'REREAD' })
    const { result } = renderHook(() => useAIChat(cloudCharacterProps))

    await act(async () => {
      await result.current.sendPhoto(PHOTO, 'what is this?')
    })

    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
    expect(mockCallCloudAgent).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [{ mimeType: 'image/webp', data: 'REREAD' }] }),
      expect.anything(),
    )
  })

  it('refuses to send a photo when the character has no cloud agent', async () => {
    const { result } = renderHook(() => useAIChat(localOnlyCharacterProps))

    expect(result.current.canSendPhoto).toBe(false)
    await act(async () => {
      await result.current.sendPhoto(PHOTO, 'hi').catch(() => {})
    })

    expect(mockCallCloudAgent).not.toHaveBeenCalled()
    // Not degraded to a text-only turn — a character that answers confidently
    // about an image it never received is worse than a refusal.
    expect(result.current.error).toMatch(/cannot see photos/i)
  })
})
