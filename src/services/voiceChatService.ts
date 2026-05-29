import { queryClient } from '~/config/queryClient'
import { saveAIMessage } from '~/database/messageDatabase'
import { messageKeys } from '~/hooks/useMessages'
import { sendMessage } from '~/services/messageService'
import { generateVoiceReply } from '~/services/voiceReplyService'
import {
  getRecentConversationHistory,
  triggerConversationSummary,
  type UsageSnapshot,
} from '~/services/aiChatService'
import type { IMessage } from 'react-native-gifted-chat'

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

  const prompt = buildVoicePrompt(text, character, conversationHistory, userId)

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
}

function buildVoicePrompt(
  userText: string,
  character: VoiceCharacter,
  conversationHistory: IMessage[],
  userId: string,
): string {
  const recentHistory = getRecentConversationHistory(conversationHistory, 10)
    .map((msg) => `${msg.user._id === userId ? 'User' : character.name}: ${msg.text}`)
    .join('\n')

  const characterPersonality = character.context || character.appearance || ''
  const characterTraits = `${character.traits ?? ''} ${character.emotions ?? ''}`.trim()

  return `You are ${character.name}, a virtual friend chatbot.

Personality: ${characterPersonality}
Traits: ${characterTraits}

Instructions:
- Respond as ${character.name} would, staying true to the personality and traits
- Respond naturally and conversationally
- Do not reveal you are an AI

${recentHistory ? `Conversation history:\n${recentHistory}\n\n` : ''}User: ${userText}
${character.name}:`
}
