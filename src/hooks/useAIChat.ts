import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { sendMessageWithAIResponse, Character } from '../services/aiChatService'
import { useChatMessages } from './useChatMessages'

interface UseAIChatProps {
    characterId: string
    recipientUserId: string
    character: Character
}

interface UseAIChatReturn {
    messages: IMessage[]
    sendMessage: (message: IMessage) => Promise<void>
    isGeneratingResponse: boolean
    error: string | null
}

/**
 * Hook for AI-powered chat with automatic response generation
 */
export function useAIChat({ characterId, recipientUserId, character }: UseAIChatProps): UseAIChatReturn {
    const messages = useChatMessages({ id: characterId, userId: recipientUserId })
    const [isGeneratingResponse, setIsGeneratingResponse] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const sendMessage = useCallback(async (message: IMessage) => {
        try {
            setError(null)
            setIsGeneratingResponse(true)

            // Send message and generate AI response
            await sendMessageWithAIResponse(
                message,
                character,
                recipientUserId,
                messages
            )

        } catch (err) {
            console.error('Error sending message:', err)
            setError(err instanceof Error ? err.message : 'Failed to send message')
        } finally {
            setIsGeneratingResponse(false)
        }
    }, [character, recipientUserId, messages])

    return {
        messages,
        sendMessage,
        isGeneratingResponse,
        error,
    }
}