import { sendMessage } from '~/services/messageService'
import { saveAIMessage } from '~/database/messageDatabase'
import { generateChatReply } from '~/services/chatReplyService'
import { onlineManager } from '@tanstack/react-query'
import { IMessage } from 'react-native-gifted-chat'

export interface Character {
  id: string
  name: string
  appearance: string
  traits: string
  emotions: string
  context: string
}

interface ChatContext {
  characterName: string
  characterPersonality: string
  characterTraits: string
  conversationHistory: {
    role: 'user' | 'assistant'
    content: string
  }[]
}

const MAX_CHAT_PROMPT_LENGTH = 11_000
const MAX_CHARACTER_NAME_LENGTH = 100
const MAX_CHARACTER_PERSONALITY_LENGTH = 1_500
const MAX_CHARACTER_TRAITS_LENGTH = 1_000
const MAX_USER_MESSAGE_LENGTH = 3_000
const MAX_HISTORY_CHARS = 4_500
const MAX_REFERENCE_ID_LENGTH = 128
const ELLIPSIS = '...'

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return ''
  }

  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxLength)
  }

  return `${normalized.slice(0, maxLength - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
}

function buildConversationHistory(
  conversationHistory: ChatContext['conversationHistory'],
  maxLength: number,
): string {
  if (maxLength <= 0 || conversationHistory.length === 0) {
    return ''
  }

  const selected: string[] = []
  let usedLength = 0

  for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
    const message = conversationHistory[index]
    if (!message) {
      continue
    }

    const prefix = `${message.role}: `
    const separatorLength = selected.length > 0 ? 1 : 0
    const remainingLength = maxLength - usedLength - separatorLength

    if (remainingLength <= prefix.length) {
      break
    }

    const truncatedContent = truncateText(message.content, remainingLength - prefix.length)
    const entry = `${prefix}${truncatedContent}`
    selected.unshift(entry)
    usedLength += entry.length + separatorLength
  }

  return selected.join('\n')
}

function buildReferenceId(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  const referenceId = truncateText(String(value), MAX_REFERENCE_ID_LENGTH)
  return referenceId.length > 0 ? referenceId : undefined
}

function buildChatPrompt(userMessage: string, context: ChatContext): string {
  const characterName = truncateText(context.characterName, MAX_CHARACTER_NAME_LENGTH)
  const characterPersonality = truncateText(
    context.characterPersonality,
    MAX_CHARACTER_PERSONALITY_LENGTH,
  )
  const characterTraits = truncateText(context.characterTraits, MAX_CHARACTER_TRAITS_LENGTH)
  const boundedUserMessage = truncateText(userMessage, MAX_USER_MESSAGE_LENGTH)
  const boundedConversationHistory = buildConversationHistory(
    context.conversationHistory,
    MAX_HISTORY_CHARS,
  )

  const prompt = `You are ${characterName}, a virtual friend chatbot with the following personality:

Personality: ${characterPersonality}
Traits: ${characterTraits}

Instructions:
- Respond as ${characterName} would, staying true to the personality and traits
- Keep responses conversational and engaging
- Respond naturally and authentically to the user's message
- Don't break character or mention that you're an AI
- Keep responses reasonably brief (1-3 sentences unless the conversation calls for more)

Conversation history:
${boundedConversationHistory}

User: ${boundedUserMessage}
${characterName}:`

  return truncateText(prompt, MAX_CHAT_PROMPT_LENGTH)
}

function buildIntroductionPrompt(
  characterName: string,
  characterPersonality: string,
  characterTraits: string,
): string {
  const boundedName = truncateText(characterName, MAX_CHARACTER_NAME_LENGTH)
  const boundedPersonality = truncateText(characterPersonality, MAX_CHARACTER_PERSONALITY_LENGTH)
  const boundedTraits = truncateText(characterTraits, MAX_CHARACTER_TRAITS_LENGTH)

  const prompt = `You are ${boundedName}, a virtual friend chatbot. This is your first message to a new user.

Your personality: ${boundedPersonality}
Your traits: ${boundedTraits}

Generate a friendly, warm introduction message that:
- Introduces yourself as ${boundedName}
- Shows your personality
- Invites the user to start a conversation
- Keep it brief and welcoming (1-2 sentences)

Introduction:`

  return truncateText(prompt, MAX_CHAT_PROMPT_LENGTH)
}

/**
 * Send a user message and generate an AI response
 */
export const sendMessageWithAIResponse = async (
  userMessage: IMessage,
  character: Character,
  userId: string,
  conversationHistory: IMessage[] = [],
): Promise<void> => {
  try {
    // 1. Send the user's message to local database
    await sendMessage(character.id, userId, userMessage)

    // 2. Prepare context for AI generation
    const chatContext: ChatContext = {
      characterName: character.name,
      characterPersonality: character.context || character.appearance,
      characterTraits: `${character.traits} ${character.emotions}`.trim(),
      conversationHistory: conversationHistory.slice(-10).map((msg) => ({
        role: msg.user._id === userId ? 'user' : 'assistant',
        content: msg.text,
      })),
    }

    // 3. Create AI response message ID
    const aiResponseId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 4. Generate AI response through secure cloud function
    const prompt = buildChatPrompt(userMessage.text, chatContext)
    const aiResponseText = await generateChatReply({
      prompt,
      referenceId: buildReferenceId(userMessage._id),
    })

    // 5. Save AI response to local database
    await saveAIMessage(character.id, userId, aiResponseText, aiResponseId, {
      user: {
        _id: character.id, // The character is responding
        name: character.name,
        avatar: character.appearance || undefined,
      },
    })
  } catch (error) {
    console.error('Error in sendMessageWithAIResponse:', error)

    // Send a fallback error message
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    try {
      const fallbackText = onlineManager.isOnline()
        ? "I'm having trouble responding right now. Please try again."
        : "I couldn't respond because you appear to be offline. Please try again when you're back online."

      await saveAIMessage(
        character.id,
        userId,
        fallbackText,
        errorId,
        {
          user: {
            _id: character.id,
            name: character.name,
            avatar: character.appearance || undefined,
          },
        },
      )
    } catch (fallbackError) {
      console.error('Error sending fallback message:', fallbackError)
      throw error // Re-throw original error
    }
  }
}

/**
 * Generate and send a character introduction message
 */
export const sendCharacterIntroduction = async (
  character: Character,
  userId: string,
): Promise<void> => {
  try {
    const introPrompt = buildIntroductionPrompt(
      character.name,
      character.context || character.appearance,
      `${character.traits} ${character.emotions}`.trim(),
    )

    const introText = await generateChatReply({
      prompt: introPrompt,
      referenceId: buildReferenceId(`intro-${character.id}`),
    })

    const introId = `intro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await saveAIMessage(character.id, userId, introText, introId, {
      user: {
        _id: character.id,
        name: character.name,
        avatar: character.appearance || undefined,
      },
    })
  } catch (error) {
    console.error('Error sending character introduction:', error)

    // Send a simple fallback introduction
    const fallbackId = `intro_fallback_${Date.now()}`

    await saveAIMessage(
      character.id,
      userId,
      `Hi! I'm ${character.name}. I'm excited to chat with you!`,
      fallbackId,
      {
        user: {
          _id: character.id,
          name: character.name,
          avatar: character.appearance || undefined,
        },
      },
    )
  }
}
