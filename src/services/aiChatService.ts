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

function buildChatPrompt(userMessage: string, context: ChatContext): string {
  return `You are ${context.characterName}, a virtual friend chatbot with the following personality:

Personality: ${context.characterPersonality}
Traits: ${context.characterTraits}

Instructions:
- Respond as ${context.characterName} would, staying true to the personality and traits
- Keep responses conversational and engaging
- Respond naturally and authentically to the user's message
- Don't break character or mention that you're an AI
- Keep responses reasonably brief (1-3 sentences unless the conversation calls for more)

Conversation history:
${context.conversationHistory.map((msg) => `${msg.role}: ${msg.content}`).join('\n')}

User: ${userMessage}
${context.characterName}:`
}

function buildIntroductionPrompt(
  characterName: string,
  characterPersonality: string,
  characterTraits: string,
): string {
  return `You are ${characterName}, a virtual friend chatbot. This is your first message to a new user.

Your personality: ${characterPersonality}
Your traits: ${characterTraits}

Generate a friendly, warm introduction message that:
- Introduces yourself as ${characterName}
- Shows your personality
- Invites the user to start a conversation
- Keep it brief and welcoming (1-2 sentences)

Introduction:`
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
      referenceId: String(userMessage._id),
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
      referenceId: `intro-${character.id}`,
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
