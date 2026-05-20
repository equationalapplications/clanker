const mockSendMessage = jest.fn()
const mockGetMessageCount = jest.fn()
const mockGetMessagesForContextSummary = jest.fn()
const mockPruneMessagesForCharacter = jest.fn()
const mockSaveAIMessage = jest.fn()
const mockGetCharacter = jest.fn()
const mockUpdateCharacter = jest.fn()
const mockGenerateChatReply = jest.fn()
const mockSummarizeText = jest.fn()
const mockReportError = jest.fn()

jest.mock('~/services/messageService', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}))

jest.mock('~/database/messageDatabase', () => ({
  getMessageCount: (...args: unknown[]) => mockGetMessageCount(...args),
  getMessagesForContextSummary: (...args: unknown[]) => mockGetMessagesForContextSummary(...args),
  pruneMessagesForCharacter: (...args: unknown[]) => mockPruneMessagesForCharacter(...args),
  saveAIMessage: (...args: unknown[]) => mockSaveAIMessage(...args),
}))

jest.mock('~/database/characterDatabase', () => ({
  getCharacter: (...args: unknown[]) => mockGetCharacter(...args),
  updateCharacter: (...args: unknown[]) => mockUpdateCharacter(...args),
}))

jest.mock('~/services/chatReplyService', () => ({
  generateChatReply: (...args: unknown[]) => mockGenerateChatReply(...args),
}))

jest.mock('~/services/summarizeTextService', () => ({
  summarizeText: (...args: unknown[]) => mockSummarizeText(...args),
}))

jest.mock('~/utilities/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}))

import { buildChatPrompt, sendMessageWithAIResponse } from '~/services/aiChatService'

describe('buildChatPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCharacter.mockResolvedValue(null)
    mockGetMessageCount.mockResolvedValue(0)
    mockGetMessagesForContextSummary.mockResolvedValue([])
  })

  it('reports observation write failures from service callback with wiki:write:observation context', async () => {
    const writeError = new Error('observation write failed')
    const mockOnWrite = jest.fn().mockRejectedValue(writeError)
    mockGenerateChatReply.mockResolvedValue({
      reply: 'All good.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    await sendMessageWithAIResponse(
      {
        _id: 'msg-observation',
        text: 'Remember this detail',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'calm',
        emotions: 'encouraging',
        context: 'friendly coach',
      },
      'user-1',
      [] as any,
      { onWriteObservation: mockOnWrite },
    )

    // Flush microtasks so Promise.resolve(...).catch(...) executes.
    await Promise.resolve()
    await Promise.resolve()

    expect(mockReportError).toHaveBeenCalledWith(writeError, 'wiki:char-1:write:observation')
  })

  it('prepends memory block before conversation history when memoryBlock provided', () => {
    const memoryBlock = '[MEMORY]\nFacts:\n  - [certain] User prefers morning workouts.\n[/MEMORY]'
    const prompt = buildChatPrompt(
      'How am I doing?',
      {
        characterName: 'Nova',
        characterPersonality: 'Friendly coach',
        characterTraits: 'calm encouraging',
        conversationHistory: [
          {
            role: 'user',
            content: 'We talked about training yesterday.',
          },
        ],
        memoryBlock,
      },
    )

    expect(prompt).toContain('[MEMORY]')
    expect(prompt).toContain('User prefers morning workouts.')
    expect(prompt.indexOf('[MEMORY]')).toBeLessThan(prompt.indexOf('Conversation history:'))
  })

  it('preserves characterName cue suffix when prompt exceeds budget', () => {
    const longMessage = 'x'.repeat(12_000)
    const prompt = buildChatPrompt(longMessage, {
      characterName: 'Nova',
      characterPersonality: 'Friendly coach',
      characterTraits: 'calm',
      conversationHistory: [],
    })
    expect(prompt.length).toBeLessThanOrEqual(12_000)
    expect(prompt.endsWith('\nNova:')).toBe(true)
  })

  it('injects provided memoryBlock into prompt and dispatches write observation post-turn', async () => {
    const mockOnWrite = jest.fn()
    mockGenerateChatReply.mockResolvedValue({
      reply: 'You are doing well.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    await sendMessageWithAIResponse(
      {
        _id: 'msg-1',
        text: 'How am I doing?',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'calm',
        emotions: 'encouraging',
        context: 'friendly coach',
      },
      'user-1',
      [
        {
          _id: 'old-1',
          text: 'Yesterday I trained.',
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
          user: { _id: 'user-1' },
        },
      ] as any,
      {
        memoryBlock: '[MEMORY]\nFacts:\n  - [certain] User prefers morning.\n[/MEMORY]',
        onWriteObservation: mockOnWrite,
      },
    )

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('[MEMORY]'),
      }),
    )
    expect(mockOnWrite).toHaveBeenCalledWith('char-1', expect.any(String))
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'You are doing well.',
      expect.any(String),
      expect.any(Object),
    )
  })

  it('filters current user message from conversationHistory to prevent optimistic-update duplicate in prompt', async () => {
    mockGenerateChatReply.mockResolvedValue({
      reply: 'Got it!',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    const userMessage = {
      _id: 'msg-dup',
      text: 'Hello duplicate test',
      createdAt: new Date('2026-04-27T00:00:00.000Z'),
      user: { _id: 'user-1' },
    }

    await sendMessageWithAIResponse(
      userMessage as any,
      { id: 'char-1', name: 'Nova', appearance: 'avatar', traits: 'calm', emotions: 'encouraging', context: 'coach' },
      'user-1',
      [userMessage] as any,
      {},
    )

    const prompt: string = mockGenerateChatReply.mock.calls[0][0].prompt
    expect((prompt.match(/Hello duplicate test/g) ?? []).length).toBe(1)
  })

  it('observation chunk ends with character reply, not just user message', async () => {
    const mockOnWrite = jest.fn()
    mockGenerateChatReply.mockResolvedValue({
      reply: 'The AI response text.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    await sendMessageWithAIResponse(
      {
        _id: 'msg-obs',
        text: 'Tell me something.',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      { id: 'char-1', name: 'Nova', appearance: 'avatar', traits: 'calm', emotions: 'encouraging', context: 'coach' },
      'user-1',
      [] as any,
      { onWriteObservation: mockOnWrite },
    )

    const chunk: string = mockOnWrite.mock.calls[0][1]
    expect(chunk).toContain('User: Tell me something.')
    expect(chunk).toContain('Nova: The AI response text.')
    expect(chunk.endsWith('Nova: The AI response text.')).toBe(true)
  })

  it('proceeds without memory when no memoryBlock or onWriteObservation provided', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char-1', name: 'Nova', appearance: '', traits: '', emotions: '', context: '' })
    mockGetMessageCount.mockResolvedValue(0)
    mockGetMessagesForContextSummary.mockResolvedValue([])
    mockGenerateChatReply.mockResolvedValue({
      reply: 'Hello!',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    const result = await sendMessageWithAIResponse(
      {
        _id: 'msg-2',
        text: 'Hi',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      { id: 'char-1', name: 'Nova', appearance: '', traits: '', emotions: '', context: '' },
      'user-1',
      [] as any,
      {},
    )

    // Exactly one AI message saved — two calls would indicate the error fallback fired
    expect(mockSaveAIMessage).toHaveBeenCalledTimes(1)
    // The saved message must contain the AI reply, not a fallback error string
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'Hello!',
      expect.any(String),
      expect.any(Object),
    )
    // Successful path returns a populated usageSnapshot, not the null from the error fallback
    expect(result).toMatchObject({
      usageSnapshot: {
        planTier: 'monthly_20',
        planStatus: 'active',
      },
    })
  })
})