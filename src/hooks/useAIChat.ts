import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessageWithAIResponse, Character } from '~/services/aiChatService'
import { useChatMessages } from '~/hooks/useChatMessages'
import { messageKeys } from '~/hooks/useMessages'

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
 * Enhanced with React Query for offline support and optimistic updates
 */
export function useAIChat({
  characterId,
  recipientUserId,
  character,
}: UseAIChatProps): UseAIChatReturn {
  const messages = useChatMessages({ id: characterId, userId: recipientUserId })
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  // Mutation for sending message with AI response
  const aiMessageMutation = useMutation({
    mutationFn: async (message: IMessage) => {
      return sendMessageWithAIResponse(message, character, recipientUserId, messages)
    },

    // Optimistic update: Add user message immediately
    onMutate: async (message) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })

      const previousMessages = queryClient.getQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
      )

      // Add user message optimistically
      const optimisticUserMessage: IMessage = {
        ...message,
        pending: true,
        createdAt: new Date(),
      }

      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => [optimisticUserMessage, ...(old || [])],
      )

      return { previousMessages }
    },

    onSuccess: () => {
      console.log('✅ AI chat message sent successfully')
      setError(null)

      // Invalidate to fetch both user message and AI response
      queryClient.invalidateQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })
    },

    onError: (err, message, context) => {
      console.error('❌ Failed to send AI chat message:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      setError(errorMessage)

      // Rollback optimistic update
      if (context?.previousMessages) {
        queryClient.setQueryData(
          messageKeys.list(characterId, recipientUserId),
          context.previousMessages,
        )
      }
    },
  })

  const sendMessage = useCallback(
    async (message: IMessage) => {
      await aiMessageMutation.mutateAsync(message)
    },
    [aiMessageMutation],
  )

  return {
    messages,
    sendMessage,
    isGeneratingResponse: aiMessageMutation.isPending,
    error,
  }
}
