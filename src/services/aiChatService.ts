import { sendMessage } from './messageService'
import { generateChatResponse, ChatContext } from './vertexAIService'
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
    recipientUserId: string,
    conversationHistory: IMessage[] = []
): Promise<void> => {
    try {
        // 1. Send the user's message to Supabase
        await sendMessage(character.id, recipientUserId, userMessage)

        // 2. Prepare context for AI generation
        const chatContext: ChatContext = {
            characterName: character.name,
            characterPersonality: character.context || character.appearance,
            characterTraits: `${character.traits} ${character.emotions}`.trim(),
            conversationHistory: conversationHistory.slice(-10).map(msg => ({
                role: msg.user._id === userMessage.user._id ? 'user' : 'assistant',
                content: msg.text
            }))
        }

        // 3. Generate AI response
        const aiResponseText = await generateChatResponse(userMessage.text, chatContext)

        // 4. Create AI response message
        const aiResponseMessage: IMessage = {
            _id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: aiResponseText,
            createdAt: new Date(),
            user: {
                _id: recipientUserId, // The character/recipient is responding
                name: character.name,
                avatar: character.appearance || undefined,
            },
        }

        // 5. Send AI response to Supabase
        await sendMessage(character.id, recipientUserId, aiResponseMessage)

    } catch (error) {
        console.error('Error in sendMessageWithAIResponse:', error)

        // Send a fallback error message
        const errorMessage: IMessage = {
            _id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: "I'm having trouble responding right now. Please try again!",
            createdAt: new Date(),
            user: {
                _id: recipientUserId,
                name: character.name,
                avatar: character.appearance || undefined,
            },
        }

        try {
            await sendMessage(character.id, recipientUserId, errorMessage)
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
    recipientUserId: string
): Promise<void> => {
    try {
        const { generateCharacterIntroduction } = await import('./vertexAIService')

        const introText = await generateCharacterIntroduction(
            character.name,
            character.context || character.appearance,
            `${character.traits} ${character.emotions}`.trim()
        )

        const introMessage: IMessage = {
            _id: `intro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: introText,
            createdAt: new Date(),
            user: {
                _id: recipientUserId,
                name: character.name,
                avatar: character.appearance || undefined,
            },
        }

        await sendMessage(character.id, recipientUserId, introMessage)

    } catch (error) {
        console.error('Error sending character introduction:', error)

        // Send a simple fallback introduction
        const fallbackMessage: IMessage = {
            _id: `intro_fallback_${Date.now()}`,
            text: `Hi! I'm ${character.name}. I'm excited to chat with you!`,
            createdAt: new Date(),
            user: {
                _id: recipientUserId,
                name: character.name,
                avatar: character.appearance || undefined,
            },
        }

        await sendMessage(character.id, recipientUserId, fallbackMessage)
    }
}