import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'
import { sendMessageWithAIResponse, Character } from '~/services/aiChatService'
import { useChatMessages, messageKeys } from '~/hooks/useMessages'
import { useAuthMachine } from '~/hooks/useMachines'
import { usageSnapshotFromError } from '~/services/usageSnapshot'
import { PLAN_TIERS, SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'

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

const ALL_PLAN_TIERS = Object.values(PLAN_TIERS)

const isPlanTier = (value: unknown): value is PlanTier => {
  return typeof value === 'string' && ALL_PLAN_TIERS.includes(value as PlanTier)
}

/**
 * Hook for AI-powered chat with automatic response generation
 * Enhanced with React Query for offline support and optimistic updates
 */
export function useAIChat({ characterId, userId, character }: UseAIChatProps): UseAIChatReturn {
  const messages = useChatMessages({ id: characterId, userId })
  const queryClient = useQueryClient()
  const authService = useAuthMachine()
  const subscription = useSelector(authService, (state) => state.context.subscription)
  const [error, setError] = useState<string | null>(null)
  const hasUnlimited =
    subscription?.planStatus === 'active' &&
    isPlanTier(subscription.planTier) &&
    SUBSCRIPTION_TIERS.includes(subscription.planTier)

  // Mutation for sending message with AI response
  const aiMessageMutation = useMutation({
    mutationFn: async (message: IMessage) => {
      return sendMessageWithAIResponse(message, character, userId, messages, { hasUnlimited })
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
