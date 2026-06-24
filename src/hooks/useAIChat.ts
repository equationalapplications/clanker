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
import { formatContext, WikiBusyError, useWiki } from '@equationalapplications/expo-llm-wiki'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { reportError } from '~/utilities/reportError'
import { saveAIMessage, getUnsyncedMessages, markMessagesAsSynced } from '~/database/messageDatabase'
import { sendMessage as persistUserMessage } from '~/services/messageService'
import { useEdgeAgent, EscalationState } from '~/hooks/useEdgeAgent'
import { toSyncMessage } from '~/services/syncMessage'
import { callCloudAgent } from '~/services/cloudAgentService'
import { listTasks } from '~/database/taskDatabase'
import { buildContentHistory } from '~/services/CharacterPromptBuilder'
import { isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'
import { DEV_CLOUD_CHARACTER_ID } from '../../shared/dev-sandbox'

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
  const queryClient = useQueryClient()
  const authService = useAuthMachine()
  const [error, setError] = useState<string | null>(null)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const messages = useChatMessages({ id: characterId, userId, pauseRefetch: isSendingMessage })

  const characterWiki = useCharacterWiki(character.id)
  const wiki = useWiki()

  // Normalize save_to_cloud which can be boolean (from characterService) or number (from DB)
  const raw = character.save_to_cloud
  const isCloudSynced = !!(raw ?? 0)
  const devSandbox = isDevSandboxEnabled()
  const cloudAgentCharacterId =
    character.cloud_id ?? (devSandbox ? DEV_CLOUD_CHARACTER_ID : null)
  const canUseCloudAgent =
    !!process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim() &&
    !!cloudAgentCharacterId &&
    (isCloudSynced || devSandbox)

  const edgeAgent = useEdgeAgent({
    character,
    userId,
    priorMessages: messages,
    isCloudSynced: isCloudSynced || devSandbox,
    wiki,
  })

  // Mutation for sending message with AI response
  const aiMessageMutation = useMutation({
    mutationFn: async (message: IMessage) => {
      if (devSandbox && !process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()) {
        throw new Error(
          'Dev sandbox requires EXPO_PUBLIC_CLOUD_AGENT_URL (e.g. http://localhost:8080). ' +
            'Start docker-compose.local.yml and set it in .env.local.',
        )
      }

      // Persist immediately so background SQLite refetches keep the user message visible
      // while edge/cloud/Firebase agents are still thinking.
      await persistUserMessage(character.id, userId, message)

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
      const { escalated, text: edgeText, usageSnapshot: edgeUsageSnapshot } =
        await edgeAgent.sendMessage(message.text, memoryBlock)

      if (!escalated && edgeText !== undefined) {
        // Edge resolved — save AI reply locally (user message already persisted above).
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

        return { usageSnapshot: edgeUsageSnapshot ?? null }
      }

      // Cloud Agent path — cloud-synced (or dev sandbox) characters with a cloud_id when
      // EXPO_PUBLIC_CLOUD_AGENT_URL is set. Must send character.cloud_id (Cloud SQL UUID).
      if (canUseCloudAgent && cloudAgentCharacterId) {
        const cloudCharacterId = cloudAgentCharacterId

        const priorHistory = messages.filter(
          (msg) => String(msg._id) !== String(message._id),
        )
        const recentHistory = getRecentConversationHistory(priorHistory, 20)
        const history = buildContentHistory(recentHistory, userId)

        let localTasks = [] as Awaited<ReturnType<typeof listTasks>>
        try {
          localTasks = await listTasks(character.id)
        } catch (taskErr) {
          reportError(taskErr, `tasks:${character.id}:list`)
        }
        const unsyncedHistory = localTasks.map((t) => ({
          type: 'task' as const,
          id: t.id,
          title: t.title,
          status: t.status,
          createdAt: t.created_at,
        }))

        const agentResult = await callCloudAgent({
          message: message.text,
          characterId: cloudCharacterId,
          history,
          unsyncedHistory,
        })

        const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const savedAIMessage = await saveAIMessage(
          character.id,
          userId,
          agentResult.reply,
          aiMsgId,
          {
            user: {
              _id: character.id,
              name: character.name,
              avatar: character.appearance || undefined,
            },
          },
        )

        void triggerConversationSummary(character, userId)

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
          ).catch((obsErr: unknown) => {
            if (!(obsErr instanceof WikiBusyError)) {
              reportError(obsErr, `wiki:${character.id}:write:observation`)
            }
          })
        } catch (obsErr) {
          if (!(obsErr instanceof WikiBusyError)) {
            reportError(obsErr, `wiki:${character.id}:write:observation`)
          }
        }

        if (agentResult.usageSnapshot) {
          authService.send({
            type: 'USAGE_SNAPSHOT_RECEIVED',
            source: 'cloudAgent',
            remainingCredits: agentResult.usageSnapshot.remainingCredits,
            planTier: null,
            planStatus: null,
            verifiedAt: new Date().toISOString(),
          })
        }

        return { usageSnapshot: null }
      }

      // Escalated — Firebase path with unsynced history
      let unsyncedLocal = await getUnsyncedMessages(character.id, userId)

      // Gotcha 1: Filter out current message if already saved locally
      // The current user message may have been inserted into SQLite before escalation fires.
      // If so, exclude it from unsyncedHistory to prevent Firebase receiving it twice.
      unsyncedLocal = unsyncedLocal.filter((msg) => {
        return !(msg.text === message.text && Date.now() - msg.created_at < 10000)
      })

      const unsyncedUserMessages = unsyncedLocal.filter((msg) => msg.sender_user_id === userId)

      const unsyncedHistory = unsyncedUserMessages.map((msg) => toSyncMessage(msg, userId))

      const result = await sendMessageWithAIResponse(message, character, userId, messages, {
        memoryBlock,
        onWriteObservation,
        unsyncedHistory,
        userMessageAlreadyPersisted: true,
      })

      if (result.cloudSyncSucceeded) {
        // Mark only the user-originated messages that were persisted to the cloud.
        await markMessagesAsSynced(unsyncedUserMessages.map((m) => m.id))
      }

      return result
    },

    // Optimistic update: Add user message immediately
    onMutate: async (message) => {
      setIsSendingMessage(true)

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

    onSettled: () => {
      setIsSendingMessage(false)
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

      const isInsufficientCredits =
        err instanceof Error && err.message === 'CLOUD_AGENT_INSUFFICIENT_CREDITS'
      if (isInsufficientCredits) {
        authService.send({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 0,
          planTier: null,
          planStatus: null,
          verifiedAt: new Date().toISOString(),
        })
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      }

      // Refetch from SQLite on transient failures — the user message was already persisted
      // at the start of mutationFn, so rolling back the optimistic cache would hide it.
      if (
        firebaseCode !== 'functions/failed-precondition' &&
        !isInsufficientCredits
      ) {
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
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
    escalationState: aiMessageMutation.isPending ? edgeAgent.escalationState : 'idle',
  }
}
