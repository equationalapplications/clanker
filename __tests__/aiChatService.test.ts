const mockSendMessage = jest.fn()
const mockGetMessageCount = jest.fn()
const mockGetMessagesForContextSummary = jest.fn()
const mockPruneMessagesForCharacter = jest.fn()
const mockSaveAIMessage = jest.fn()
const mockGetCharacter = jest.fn()
const mockUpdateCharacter = jest.fn()
const mockGenerateChatReply = jest.fn()
const mockSummarizeText = jest.fn()
const mockFetchMemoryBundle = jest.fn()
const mockDispatchWikiWrite = jest.fn()

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

jest.mock('~/services/memoryService', () => ({
  fetchMemoryBundle: (...args: unknown[]) => mockFetchMemoryBundle(...args),
}), { virtual: true })

jest.mock('~/machines/wikiHealMachine', () => ({
  dispatchWikiWrite: (...args: unknown[]) => mockDispatchWikiWrite(...args),
}), { virtual: true })

import { buildChatPrompt, sendMessageWithAIResponse } from '~/services/aiChatService'

describe('buildChatPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCharacter.mockResolvedValue(null)
    mockGetMessageCount.mockResolvedValue(0)
    mockGetMessagesForContextSummary.mockResolvedValue([])
  })

  it('prepends memory block before conversation history when bundle provided', () => {
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
        memoryBundle: {
          facts: [
            {
              id: 'fact-1',
              title: 'Morning workouts',
              body: 'User prefers morning workouts.',
              confidence: 'certain',
              tags: ['health', 'schedule'],
            },
          ],
          openTasks: [
            {
              id: 'task-1',
              description: 'Ask how interval run went',
              priorityLabel: 'high',
            },
          ],
          recentEvents: [
            {
              id: 'event-1',
              eventType: 'observation',
              summary: 'User mentioned race-day nerves.',
            },
          ],
        },
      } as any,
    )

    expect(prompt).toContain('[MEMORY]')
    expect(prompt).toContain('Facts:')
    expect(prompt).toContain('- [certain] User prefers morning workouts. | tags: health, schedule')
    expect(prompt).toContain('Open tasks:')
    expect(prompt).toContain('- [high] Ask how interval run went')
    expect(prompt).toContain('Recent episodic context:')
    expect(prompt).toContain('- [observation] User mentioned race-day nerves.')

    expect(prompt.indexOf('[MEMORY]')).toBeLessThan(prompt.indexOf('Conversation history:'))
  })

  it('fetches and injects memory for premium chat flow, then dispatches write post-turn', async () => {
    mockGenerateChatReply.mockResolvedValue({
      reply: 'You are doing well.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })
    mockFetchMemoryBundle.mockResolvedValue({
      facts: [
        {
          id: 'fact-1',
          title: 'Morning workouts',
          body: 'User prefers morning workouts.',
          confidence: 'certain',
          tags: ['health'],
        },
      ],
      openTasks: [],
      recentEvents: [],
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
      { hasUnlimited: true },
    )

    expect(mockFetchMemoryBundle).toHaveBeenCalledWith('user-1', 'char-1', 'How am I doing?')
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('[MEMORY]'),
      }),
    )
    expect(mockDispatchWikiWrite).toHaveBeenCalledWith({
      character: expect.objectContaining({ id: 'char-1' }),
      userId: 'user-1',
      chunk: 'How am I doing?',
    })
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'You are doing well.',
      expect.any(String),
      expect.any(Object),
    )
  })
})