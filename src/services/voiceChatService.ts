import { queryClient } from '~/config/queryClient'
import { saveAIMessage } from '~/database/messageDatabase'
import { messageKeys } from '~/hooks/useMessages'
import { sendMessage } from '~/services/messageService'
import { generateVoiceReply } from '~/services/voiceReplyService'
import {
  buildChatPrompt,
  getRecentConversationHistory,
  triggerConversationSummary,
  UsageSnapshot,
} from '~/services/aiChatService'
import { IMessage } from 'react-native-gifted-chat'

type VoiceCharacter = {
  id: string
  name: string
  avatar?: string | null
  appearance: string | null
  traits: string | null
  emotions: string | null
  context: string | null
  voice?: string | null
}

export interface VoiceChatResult {
  audioBase64: string
  audioMimeType: string
  replyText: string
  usageSnapshot: UsageSnapshot | null
}

export async function sendVoiceMessage(
  transcribedText: string,
  character: VoiceCharacter,
  userId: string,
  conversationHistory: IMessage[],
): Promise<VoiceChatResult> {
  const text = transcribedText.trim()
  if (!text) {
    throw new Error('transcribedText must be non-empty')
  }

  if (!character.voice) {
    throw new Error('character.voice is required for a voice message')
  }

  const userMessageId = `voice_user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  await sendMessage(character.id, userId, {
    _id: userMessageId,
    text,
    createdAt: new Date(),
    user: {
      _id: userId,
    },
  })

  try {
    const prompt = buildChatPrompt(text, {
      characterName: character.name || 'Character',
      characterPersonality: character.context || character.appearance || '',
      characterTraits: `${character.traits ?? ''} ${character.emotions ?? ''}`.trim(),
      conversationHistory: getRecentConversationHistory(conversationHistory, 10).map((msg) => ({
        role: msg.user._id === userId ? 'user' : 'assistant',
        content: msg.text,
      })),
    })

    const voiceResult = await generateVoiceReply({
      prompt,
      characterVoice: character.voice,
      characterTraits: character.traits || undefined,
      characterEmotions: character.emotions || undefined,
      referenceId: userMessageId,
    })

    const aiResponseId = `voice_ai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    await saveAIMessage(character.id, userId, voiceResult.replyText, aiResponseId, {
      user: {
        _id: character.id,
        name: character.name,
        avatar: character.avatar || undefined,
      },
    })

    void triggerConversationSummary(
      {
        id: character.id,
        name: character.name || 'Character',
        appearance: character.appearance || '',
        traits: character.traits || '',
        emotions: character.emotions || '',
        context: character.context || '',
      },
      userId,
    )

    await queryClient.invalidateQueries({
      queryKey: messageKeys.list(character.id, userId),
    })

    return {
      audioBase64: voiceResult.audioBase64,
      audioMimeType: voiceResult.audioMimeType,
      replyText: voiceResult.replyText,
      usageSnapshot: {
        remainingCredits: voiceResult.remainingCredits,
        planTier: voiceResult.planTier,
        planStatus: voiceResult.planStatus,
        verifiedAt: voiceResult.verifiedAt,
      },
    }
  } catch (error) {
    const fallbackResponseId = `voice_ai_error_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    try {
      await saveAIMessage(
        character.id,
        userId,
        "Sorry, I couldn't generate a voice reply right now.",
        fallbackResponseId,
        {
          user: {
            _id: character.id,
            name: character.name,
            avatar: character.avatar || undefined,
          },
        },
      )

      await queryClient.invalidateQueries({
        queryKey: messageKeys.list(character.id, userId),
      })
    } catch {
      // Best effort only: preserve the original error if fallback persistence also fails.
    }

    throw error
  }
}
