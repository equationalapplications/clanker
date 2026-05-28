import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  sendMessageWithAIResponse,
  Character,
  getRecentConversationHistory,
  triggerConversationSummary,
} from '~/services/aiChatService'
import { useChatMessages, messageKeys } from '~/hooks/useMessages'
import { useAuthMachine } from '~/hooks/useMachines'
import { usageSnapshotFromError } from '~/services/usageSnapshot'
import { formatContext, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { reportError } from '~/utilities/reportError'
import { saveAIMessage, getUnsyncedMessages, markMessagesAsSynced } from '~/database/messageDatabase'
import { sendMessage as persistUserMessage } from '~/services/messageService'
import { useEdgeAgent, EscalationState } from '~/hooks/useEdgeAgent'
import { toSyncMessage } from '~/services/syncMessage'

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
  escalationState: EscalationState
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

  const edgeAgent = useEdgeAgent({
    character,
    userId,
    priorMessages: messages,
    isCloudSynced: (character.save_to_cloud ?? 0) === 1,
  })

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

      const onWriteObservation = (_characterId: string, text: string) => {
        void characterWiki.write(text).catch((err: unknown) => {
          if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:write`)
        })
      }

      // Try edge agent first
      const { escalated, text: edgeText } = await edgeAgent.sendMessage(message.text, memoryBlock)

      if (!escalated && edgeText !== undefined) {
        // Edge resolved — save both messages, no Firebase call
        // Save user message after edge resolves. On DB failure, onError rolls back the optimistic
        // update — no fallback message is saved (intentional; Firebase path handled its own fallback).
        await persistUserMessage(character.id, userId, message)

        const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const savedAIMessage = await saveAIMessage(character.id, userId, edgeText, aiMsgId, {
          user: {
            _id: character.id,
            name: character.name,
            avatar: character.appearance || undefined,
          },
        })

        void triggerConversationSummary(character, userId)

        // Filter out the current user message — the optimistic update may have injected
        // it into messages before mutationFn executes, which would duplicate it in history.
        const priorHistory = messages.filter(
          (msg) => String(msg._id) !== String(message._id),
        )
        const recentMessages = getRecentConversationHistory(
          [...priorHistory, message, savedAIMessage],
          20,
        )
        const chunk = recentMessages
          .map((msg) => `${msg.user._id === userId ? 'User' : character.name}: ${msg.text}`)
          .join('\n')

        try {
          void Promise.resolve(
            onWriteObservation(character.id, chunk || message.text),
          ).catch((observationError: unknown) => {
            if (!(observationError instanceof WikiBusyError)) {
              reportError(observationError, `wiki:${character.id}:write:observation`)
            }
          })
        } catch (observationError) {
          if (!(observationError instanceof WikiBusyError)) {
            reportError(observationError, `wiki:${character.id}:write:observation`)
          }
        }

        return { usageSnapshot: null }
      }

      // Escalated — Firebase path with unsynced history
      let unsyncedLocal = await getUnsyncedMessages(character.id, userId)

      // Filter out current message if already saved locally (avoids double-count)
      unsyncedLocal = unsyncedLocal.filter(
        (msg) => !(msg.text === message.text && Date.now() - msg.created_at < 10000),
      )

      const unsyncedHistory = unsyncedLocal.map((msg) => toSyncMessage(msg, userId))

      const result = await sendMessageWithAIResponse(message, character, userId, messages, {
        memoryBlock,
        onWriteObservation,
        unsyncedHistory,
      })

      // Mark local messages as synced after successful Firebase call
      await markMessagesAsSynced(unsyncedLocal.map((m) => m.id))

      return result
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

      // Keep optimistic messages on insufficient-credit failures, but refetch the
      // latest query state so the message is rendered with the persisted local DB
      // state and does not remain stuck in a pending-only optimistic view.
      if (firebaseCode === 'functions/failed-precondition') {
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      }

      // Rollback optimistic update for transient failures only.
      if (firebaseCode !== 'functions/failed-precondition' && context?.previousMessages) {
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
    escalationState: edgeAgent.escalationState,
  }
}
