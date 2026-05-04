const mockSendMessage = jest.fn()
const mockGetMessageCount = jest.fn()
const mockGetMessagesForContextSummary = jest.fn()
const mockPruneMessagesForCharacter = jest.fn()
const mockSaveAIMessage = jest.fn()
const mockGetCharacter = jest.fn()
const mockUpdateCharacter = jest.fn()
const mockGenerateChatReply = jest.fn()
const mockSummarizeText = jest.fn()

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

import { buildChatPrompt, sendMessageWithAIResponse } from '~/services/aiChatService'

describe('buildChatPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCharacter.mockResolvedValue(null)
    mockGetMessageCount.mockResolvedValue(0)
    mockGetMessagesForContextSummary.mockResolvedValue([])
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

  it('fetches and injects memory for premium chat flow, then dispatches write post-turn', async () => {
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

  it('proceeds without memory when wiki is unavailable (web/uninitialized)', async () => {
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