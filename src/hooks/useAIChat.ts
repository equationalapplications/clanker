import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessageWithAIResponse, Character } from '~/services/aiChatService'
import { useChatMessages, messageKeys } from '~/hooks/useMessages'
import { useAuthMachine } from '~/hooks/useMachines'
import { usageSnapshotFromError } from '~/services/usageSnapshot'
import { formatContext, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { reportError } from '~/utilities/reportError'

interface UseAIChatProps {
  characterId: string
  userId: string
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
export function useAIChat({ characterId, userId, character }: UseAIChatProps): UseAIChatReturn {
  const messages = useChatMessages({ id: characterId, userId })
  const queryClient = useQueryClient()
  const authService = useAuthMachine()
  const [error, setError] = useState<string | null>(null)

  const characterWiki = useCharacterWiki(character.id)

  // Mutation for sending message with AI response
  const aiMessageMutation = useMutation({
    mutationFn: async (message: IMessage) => {
      let memoryBlock: string | undefined
      try {
        const bundle = await characterWiki.read(message.text)
        if (bundle) memoryBlock = formatContext(bundle, { maxFacts: 10, maxTasks: 5, maxEvents: 10 })
      } catch (err) {
        if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:read`)
      }
      // _characterId parameter maintained for aiChatService contract compatibility
      const onWriteObservation = (_characterId: string, text: string) => {
        void characterWiki.write(text).catch((err: unknown) => {
          if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:write`)
        })
      }
      return sendMessageWithAIResponse(message, character, userId, messages, {
        memoryBlock,
        onWriteObservation,
      })
    },

    // Optimistic update: Add user message immediately
    onMutate: async (message) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, userId),
      })

      const previousMessages = queryClient.getQueryData<IMessage[]>(
        messageKeys.list(characterId, userId),
      )

      // Add user message optimistically
      const optimisticUserMessage: IMessage = {
        ...message,
        pending: true,
        createdAt: new Date(),
      }

      queryClient.setQueryData<IMessage[]>(messageKeys.list(characterId, userId), (old) => [
        optimisticUserMessage,
        ...(old || []),
      ])

      return { previousMessages }
    },

    onSuccess: (result) => {
      if (result?.usageSnapshot) {
        authService.send({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'generateReply',
          remainingCredits: result.usageSnapshot.remainingCredits,
          planTier: result.usageSnapshot.planTier,
          planStatus: result.usageSnapshot.planStatus,
          verifiedAt: result.usageSnapshot.verifiedAt,
        })
      }

      console.log('✅ AI chat message sent successfully')
      setError(null)

      // Invalidate to fetch both user message and AI response
      queryClient.invalidateQueries({
        queryKey: messageKeys.list(characterId, userId),
      })
    },

    onError: (err, message, context) => {
      console.error('❌ Failed to send AI chat message:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      setError(errorMessage)

      const usageSnapshot = usageSnapshotFromError(err)
      if (usageSnapshot) {
        authService.send({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'generateReply',
          remainingCredits: usageSnapshot.remainingCredits,
          planTier: usageSnapshot.planTier,
          planStatus: usageSnapshot.planStatus,
          verifiedAt: usageSnapshot.verifiedAt,
        })
      }

      // Firebase 'internal' errors from generateReply are typically caused by an expired
      // App Check token (surfaces as a CORS failure). Trigger a bootstrap refresh so the
      // token is renewed and the user can retry without a manual page reload.
      const firebaseCode = (err as { code?: unknown }).code
      if (firebaseCode === 'functions/internal') {
        authService.send({ type: 'REFRESH_BOOTSTRAP', reason: 'foreground' })
      }

      // Rollback optimistic update
      if (context?.previousMessages) {
        queryClient.setQueryData(messageKeys.list(characterId, userId), context.previousMessages)
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
