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

const MAX_VOICE_PROMPT_LENGTH = 12_000

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
  const MAX_NAME_LENGTH = 100
  const truncatedName = character.name.length > MAX_NAME_LENGTH
    ? character.name.slice(0, MAX_NAME_LENGTH - 3) + '...'
    : character.name

  const historyLines = getRecentConversationHistory(conversationHistory, 10)
    .map((msg) => `${msg.user._id === userId ? 'User' : truncatedName}: ${msg.text}`)

  const characterPersonality = character.context || character.appearance || ''
  const characterTraits = `${character.traits ?? ''} ${character.emotions ?? ''}`.trim()

  const promptSuffix = `\nUser: ${userText}\n${truncatedName}:`

  const buildPrompt = (prefix: string, historyLinesToUse: string[]) => {
    const historyBlock = historyLinesToUse.length
      ? `Conversation history:\n${historyLinesToUse.join('\n')}\n\n`
      : ''

    return `${prefix}${historyBlock}${promptSuffix}`
  }

  const basePrefix = `You are ${truncatedName}, a virtual friend chatbot.\n\n`
  const instructions = `Instructions:\n- Respond as ${truncatedName} would, staying true to the personality and traits\n- Respond naturally and conversationally\n- Do not reveal you are an AI\n\n`
  const fullPrefix = `${basePrefix}Personality: ${characterPersonality}\nTraits: ${characterTraits}\n\n${instructions}`

  // Phase 1: try full prefix with trimmed history
  let prompt = buildPrompt(fullPrefix, historyLines)
  while (prompt.length > MAX_VOICE_PROMPT_LENGTH && historyLines.length > 0) {
    historyLines.shift()
    prompt = buildPrompt(fullPrefix, historyLines)
  }

  if (prompt.length <= MAX_VOICE_PROMPT_LENGTH) {
    return prompt
  }

  // Phase 2: static prefix alone exceeds budget — trim personality/traits to reserve room for user text
  const availableForPrefix = MAX_VOICE_PROMPT_LENGTH - promptSuffix.length
  if (availableForPrefix <= 0) {
    // User text alone exceeds budget — truncate user text as last resort
    const maxUserText = MAX_VOICE_PROMPT_LENGTH - `\nUser: \n${truncatedName}:`.length
    const truncatedUserText = maxUserText > 0 ? userText.slice(-maxUserText) : ''
    return `\nUser: ${truncatedUserText}\n${truncatedName}:`.slice(0, MAX_VOICE_PROMPT_LENGTH)
  }

  let truncatedPersonality = characterPersonality
  let truncatedTraits = characterTraits

  const buildTruncatedPrefix = (pers: string, traits: string) =>
    `${basePrefix}Personality: ${pers}\nTraits: ${traits}\n\n${instructions}`

  // Trim personality/traits incrementally until the prefix fits
  while (buildTruncatedPrefix(truncatedPersonality, truncatedTraits).length > availableForPrefix) {
    if (truncatedPersonality.length === 0 && truncatedTraits.length === 0) {
      break
    }
    // Trim the longer section
    if (truncatedPersonality.length >= truncatedTraits.length && truncatedPersonality.length > 0) {
      truncatedPersonality = truncatedPersonality.slice(0, Math.max(0, truncatedPersonality.length - 50))
    } else if (truncatedTraits.length > 0) {
      truncatedTraits = truncatedTraits.slice(0, Math.max(0, truncatedTraits.length - 50))
    }
  }

  const truncatedPrefix = buildTruncatedPrefix(truncatedPersonality, truncatedTraits).slice(0, availableForPrefix)
  return `${truncatedPrefix}${promptSuffix}`
}
