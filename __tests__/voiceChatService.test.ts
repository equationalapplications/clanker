const mockSendMessage = jest.fn()
const mockSaveAIMessage = jest.fn()
const mockGenerateVoiceReply = jest.fn()
const mockBuildChatPrompt = jest.fn()
const mockGetRecentConversationHistory = jest.fn()
const mockTriggerConversationSummary = jest.fn()

jest.mock('~/services/messageService', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}))

jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: (...args: unknown[]) => mockSaveAIMessage(...args),
}))

jest.mock('~/services/voiceReplyService', () => ({
  generateVoiceReply: (...args: unknown[]) => mockGenerateVoiceReply(...args),
}))

jest.mock('~/services/aiChatService', () => {
  return {
    Character: {},
    buildChatPrompt: (...args: unknown[]) => mockBuildChatPrompt(...args),
    getRecentConversationHistory: (...args: unknown[]) => mockGetRecentConversationHistory(...args),
    triggerConversationSummary: (...args: unknown[]) => mockTriggerConversationSummary(...args),
  }
})

import { queryClient } from '~/config/queryClient'
import { sendVoiceMessage } from '~/services/voiceChatService'

type Character = {
  id: string
  name: string
  appearance: string
  traits: string
  emotions: string
  context: string
}

describe('sendVoiceMessage', () => {
  const character: Character & { voice: string | null } = {
    id: 'char-1',
    name: 'Nova',
    appearance: 'avatar',
    traits: 'kind',
    emotions: 'happy',
    context: 'friendly',
    voice: 'Kore',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()

    mockBuildChatPrompt.mockReturnValue('PROMPT')
    mockGetRecentConversationHistory.mockReturnValue([
      {
        _id: '1',
        text: 'hi',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        user: { _id: 'user-1' },
      },
    ])

    mockGenerateVoiceReply.mockResolvedValue({
      replyText: 'hello there',
      rawReplyText: '[smiles] hello there',
      audioBase64: 'UklG',
      audioMimeType: 'audio/wav',
      remainingCredits: 3,
      planTier: 'payg',
      planStatus: 'active',
      verifiedAt: '2026-04-23T00:00:00.000Z',
    })
  })

  it('saves user and assistant messages and invalidates cache', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    const result = await sendVoiceMessage(
      'spoken message',
      character,
      'user-1',
      [
        {
          _id: 'old',
          text: 'older',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          user: { _id: 'user-1' },
        },
      ],
    )

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      expect.objectContaining({ text: 'spoken message' }),
    )

    expect(mockBuildChatPrompt).toHaveBeenCalledTimes(1)
    expect(mockGenerateVoiceReply).toHaveBeenCalledWith({
      prompt: 'PROMPT',
      characterVoice: 'Kore',
      characterTraits: 'kind',
      characterEmotions: 'happy',
      referenceId: expect.any(String),
    })

    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'hello there',
      expect.any(String),
      expect.any(Object),
    )

    expect(mockTriggerConversationSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'kind',
        emotions: 'happy',
        context: 'friendly',
      }),
      'user-1',
    )

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['messages', 'list', 'char-1', 'user-1'],
    })

    expect(result).toEqual({
      audioBase64: 'UklG',
      audioMimeType: 'audio/wav',
      replyText: 'hello there',
      usageSnapshot: {
        remainingCredits: 3,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: '2026-04-23T00:00:00.000Z',
      },
    })
  })

  it('throws before saving user message when character.voice is missing', async () => {
    const characterWithoutVoice = { ...character, voice: null }

    await expect(
      sendVoiceMessage('hello', characterWithoutVoice, 'user-1', []),
    ).rejects.toThrow('character.voice is required for a voice message')

    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})
