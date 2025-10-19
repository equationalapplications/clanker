import { sendMessage } from '~/services/messageService'
import { saveAIMessage } from '~/database/messageDatabase'
import {
  generateChatResponse,
  generateCharacterIntroduction,
  ChatContext,
} from '~/services/vertexAIService'
import { IMessage } from 'react-native-gifted-chat'

export interface Character {
  id: string
  name: string
  appearance: string
  traits: string
  emotions: string
  context: string
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

    // 3. Generate AI response
    const aiResponseText = await generateChatResponse(userMessage.text, chatContext)

    // 4. Create AI response message ID
    const aiResponseId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

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
      await saveAIMessage(
        character.id,
        userId,
        "I'm having trouble responding right now. Please try again!",
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
    const introText = await generateCharacterIntroduction(
      character.name,
      character.context || character.appearance,
      `${character.traits} ${character.emotions}`.trim(),
    )

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
