import { useCallback, useRef, useState } from 'react'
import type { Message } from '~/types/chat'
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
import {
  saveAIMessage,
  getUnsyncedMessages,
  markMessagesAsSynced,
} from '~/database/messageDatabase'
import { sendMessage as persistUserMessage } from '~/services/messageService'
import { useEdgeAgent, EscalationState } from '~/hooks/useEdgeAgent'
import { toSyncMessage } from '~/services/syncMessage'
import {
  callCloudAgent,
  type AgentImagePayload,
  type CloudAgentAttachment,
} from '~/services/cloudAgentService'
import { listTasks } from '~/database/taskDatabase'
import { buildContentHistory } from '~/services/CharacterPromptBuilder'
import { isDevSandboxEnabled } from '~/auth/devSandboxFlag'
import { DEV_CLOUD_CHARACTER_ID } from '../../shared/dev-sandbox'
import type { PendingChatPhoto } from '~/hooks/useChatPhotoUpload'
import { saveCharacterImage } from '~/services/characterImageService'
import { findCharacterImageByMessageId } from '~/database/characterImageDatabase'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'

interface UseAIChatProps {
  characterId: string
  userId: string
  character: Character
}

interface UseAIChatReturn {
  messages: Message[]
  sendMessage: (message: Message) => Promise<void>
  /** Vision turn. Cloud-agent only — see `canSendPhoto`. */
  sendPhoto: (photo: PendingChatPhoto, caption: string) => Promise<boolean>
  canSendPhoto: boolean
  isGeneratingResponse: boolean
  error: string | null
  escalationState: EscalationState
  activeTool: string | null
  streamingMessage: Message | null
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
  // Mutex shared by `sendMessage` and `sendPhoto`. Deliberately a ref and not
  // `isSendingMessage`: two taps in the same tick (text-vs-text, photo-vs-photo,
  // or one of each) all close over `isSendingMessage === false`, because React
  // has neither flushed the state update nor re-rendered the composer with its
  // disabled controls yet. Without a single synchronous gate covering both
  // paths, two concurrent turns would share `streamingMessage` and
  // `activeTool`, and whichever settled first would clear `isSendingMessage` —
  // marking the hook idle while the other was still streaming.
  const turnInFlightRef = useRef(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null)
  const messages = useChatMessages({ id: characterId, userId, pauseRefetch: isSendingMessage })

  const characterWiki = useCharacterWiki(character.id)
  const wiki = useWiki()

  // Normalize save_to_cloud which can be boolean (from characterService) or number (from DB)
  const raw = character.save_to_cloud
  const isCloudSynced = !!(raw ?? 0)
  const devSandbox = isDevSandboxEnabled()
  const cloudAgentCharacterId = character.cloud_id ?? (devSandbox ? DEV_CLOUD_CHARACTER_ID : null)
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

  /**
   * Cloud-agent turn. Shared by the text and photo paths — passing
   * `attachments` is what makes a vision turn a vision turn; everything else
   * (history, tasks, streaming, AI persist, observation write, usage snapshot)
   * is byte-for-byte the same.
   */
  const runCloudAgentTurn = useCallback(
    async (message: Message, attachments?: CloudAgentAttachment[]) => {
      const cloudCharacterId = cloudAgentCharacterId as string

      const priorHistory = messages.filter((msg) => String(msg._id) !== String(message._id))
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

      setActiveTool(null)
      // One id per AI reply: minted once, used for the streamed row AND the
      // persisted row, so the stream→persist transition keeps the same React
      // key and the bubble reconciles in place instead of remounting (Fix A.1).
      const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      setStreamingMessage({
        _id: aiMsgId,
        text: '',
        createdAt: new Date(),
        user: {
          _id: character.id,
          name: character.name,
          avatar: character.appearance || undefined,
        },
      })

      // Agent-generated image for this turn. The callback fires during the stream
      // (post-loop, just before usage_snapshot); persistence waits for settle so
      // imageId rides the SAME saveAIMessage write that persists the reply — that is
      // what keeps the render hint alive through #621's clear-after-refetch ordering.
      // Held in one object rather than bare `let`s: the only writes happen inside
      // the callback below, so TS's flow analysis would pin plain `let`s to their
      // `null` initializer and narrow the guarded reads to `never`.
      const agentImage: { payload: AgentImagePayload | null; id: string | null } = {
        payload: null,
        id: null,
      }

      const agentResult = await callCloudAgent(
        {
          message: message.text,
          characterId: cloudCharacterId,
          history,
          unsyncedHistory,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        },
        {
          onToolStart: (name) => setActiveTool(name),
          onToolEnd: () => setActiveTool(null),
          onToken: (text) => {
            setStreamingMessage((prev) =>
              prev ? { ...prev, text: `${prev.text ?? ''}${text}` } : prev,
            )
          },
          onAgentImage: (img) => {
            agentImage.payload = img
            agentImage.id = generateSecureUuid()
          },
        },
      )

      const aiMessageData: Partial<Message> = {
        user: {
          _id: character.id,
          name: character.name,
          avatar: character.appearance || undefined,
        },
      }
      if (agentResult.groundingMetadata) {
        aiMessageData.groundingMetadata = agentResult.groundingMetadata
      }
      if (agentImage.payload && agentImage.id) {
        try {
          // Same dedupe rule sendPhoto uses: a retried turn finds the row it already
          // wrote instead of spending another FIFO slot on one image.
          const existing = await findCharacterImageByMessageId(aiMsgId, character.id, userId)
          if (!existing) {
            await saveCharacterImage({
              characterId: character.id,
              userId,
              uri: `data:${agentImage.payload.mimeType};base64,${agentImage.payload.imageBase64}`,
              width: 1024,
              height: 1024,
              source: 'chat',
              imageId: agentImage.id,
              messageId: aiMsgId,
            })
            aiMessageData.imageId = agentImage.id
          } else {
            aiMessageData.imageId = existing.id
          }
        } catch (imgErr) {
          // Error-matrix row 4: the text reply stands; the image is lost locally;
          // saveCharacterImage's own rollback cleaned up partial writes.
          reportError(imgErr, `chat:${character.id}:agentImage`)
        }
      }
      const savedAMessage = await saveAIMessage(
        character.id,
        userId,
        agentResult.reply,
        aiMsgId,
        aiMessageData,
      )

      void triggerConversationSummary(character, userId)

      // The wiki observation is text-only. A captionless photo turn has
      // `message.text === ''` (the bytes are not re-sent — see §8), so a
      // `User: ` line is incoherent on its own. `buildContentHistory` substitutes
      // the `[sent a photo]` placeholder for any photo turn, so going through
      // it keeps the wiki transcript coherent without the model re-receiving
      // the bytes on every future turn.
      const recentMessages = getRecentConversationHistory(
        [...priorHistory, message, savedAMessage],
        20,
      )
      const recentHistoryContent = buildContentHistory(recentMessages, userId)
      const chunk = recentHistoryContent
        .map((entry) =>
          entry.role === 'user'
            ? `User: ${entry.parts.map((p) => p.text).join('')}`
            : `${character.name}: ${entry.parts.map((p) => p.text).join('')}`,
        )
        .join('\n')

      try {
        void Promise.resolve(characterWiki.write(chunk || message.text)).catch(
          (obsErr: unknown) => {
            if (!(obsErr instanceof WikiBusyError)) {
              reportError(obsErr, `wiki:${character.id}:write:observation`)
            }
          },
        )
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
    },
    [cloudAgentCharacterId, messages, character, userId, characterWiki, authService],
  )

  // Mutation for sending message with AI response
  const aiMessageMutation = useMutation({
    mutationFn: async (message: Message) => {
      if (devSandbox && !process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()) {
        throw new Error(
          'Dev sandbox requires EXPO_PUBLIC_CLOUD_AGENT_URL (e.g. http://localhost:8080). ' +
            'Start docker-compose.local.yml and set it in .env.development.local.',
        )
      }

      // Persist immediately so background SQLite refetches keep the user message visible
      // while edge/cloud/Firebase agents are still thinking.
      await persistUserMessage(character.id, userId, message)

      let memoryBlock: string | undefined
      try {
        const bundle = await characterWiki.read(message.text)
        if (bundle)
          memoryBlock = formatContext(bundle, { maxFacts: 10, maxTasks: 5, maxEvents: 10 })
      } catch (err) {
        if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:read`)
      }

      const onWriteObservation = (_characterId: string, text: string) => {
        void characterWiki.write(text).catch((err: unknown) => {
          if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:write`)
        })
      }

      // Try edge agent first
      const {
        escalated,
        text: edgeText,
        usageSnapshot: edgeUsageSnapshot,
      } = await edgeAgent.sendMessage(message.text, memoryBlock)

      if (!escalated && edgeText !== undefined) {
        // Edge resolved — save AI reply locally (user message already persisted above).
        const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const savedAMessage = await saveAIMessage(character.id, userId, edgeText, aiMsgId, {
          user: {
            _id: character.id,
            name: character.name,
            avatar: character.appearance || undefined,
          },
        })

        void triggerConversationSummary(character, userId)

        // Filter out the current user message — the optimistic update may have injected
        // it into messages before mutationFn executes, which would duplicate it in history.
        const priorHistory = messages.filter((msg) => String(msg._id) !== String(message._id))
        const recentMessages = getRecentConversationHistory(
          [...priorHistory, message, savedAMessage],
          20,
        )
        // See the cloud path: go through buildContentHistory so a captionless
        // photo turn reads as `[sent a photo]` rather than a bare `User: `.
        const recentHistoryContent = buildContentHistory(recentMessages, userId)
        const chunk = recentHistoryContent
          .map((entry) =>
            entry.role === 'user'
              ? `User: ${entry.parts.map((p) => p.text).join('')}`
              : `${character.name}: ${entry.parts.map((p) => p.text).join('')}`,
          )
          .join('\n')

        try {
          void Promise.resolve(onWriteObservation(character.id, chunk || message.text)).catch(
            (observationError: unknown) => {
              if (!(observationError instanceof WikiBusyError)) {
                reportError(observationError, `wiki:${character.id}:write:observation`)
              }
            },
          )
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
        return await runCloudAgentTurn(message)
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
      setActiveTool(null)
      setStreamingMessage(null)

      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, userId),
      })

      const previousMessages = queryClient.getQueryData<Message[]>(
        messageKeys.list(characterId, userId),
      )

      // Add user message optimistically
      const optimisticUserMessage: Message = {
        ...message,
        pending: true,
        createdAt: new Date(),
      }

      queryClient.setQueryData<Message[]>(messageKeys.list(characterId, userId), (old) => [
        optimisticUserMessage,
        ...(old || []),
      ])

      return { previousMessages }
    },

    onSettled: () => {
      setIsSendingMessage(false)
      setActiveTool(null)
    },

    onSuccess: async (result) => {
      try {
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

        // Await the refetch so the persisted row is in the list before the
        // streamed bubble unmounts — closes the blank-gap window (Fix A.3).
        await queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      } finally {
        setStreamingMessage(null)
      }
    },

    onError: (err, message, context) => {
      // Failure path: no persisted row will arrive, so drop the bubble at once
      // instead of waiting for a refetch (Fix A.3).
      setStreamingMessage(null)
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
      if (firebaseCode !== 'functions/failed-precondition' && !isInsufficientCredits) {
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      }
    },
  })

  const sendMessage = useCallback(
    async (message: Message) => {
      // Second line of defence behind the composer's disabled controls — see
      // `turnInFlightRef` above.
      if (turnInFlightRef.current) return
      turnInFlightRef.current = true
      try {
        await aiMessageMutation.mutateAsync(message)
      } finally {
        turnInFlightRef.current = false
      }
    },
    [aiMessageMutation],
  )

  const sendPhoto = useCallback(
    async (photo: PendingChatPhoto, caption: string) => {
      if (!canUseCloudAgent || !cloudAgentCharacterId) {
        // Explicit refusal, never a quiet text-only fallback.
        setError('This character cannot see photos. Turn on cloud sync to send images.')
        return false
      }

      // Second line of defence behind the composer's disabled controls — see
      // `turnInFlightRef` above.
      if (turnInFlightRef.current) return false
      turnInFlightRef.current = true

      setError(null)
      setIsSendingMessage(true)
      try {
        const message: Message & { imageId: string } = {
          _id: photo.messageId,
          text: caption.trim(),
          createdAt: new Date(),
          user: { _id: userId },
          // Render hint. Written once at message creation and never updated;
          // `character_images.message_id` stays authoritative for the gallery.
          // Carrying it on the message is what lets the chat list render the
          // photo with no extra query and no new sync path — and lets a device
          // whose message synced first show a placeholder rather than a bare
          // text bubble that silently gains an image later.
          imageId: photo.imageId,
        }

        // Bubble first, so it is visible while the model is thinking.
        await persistUserMessage(character.id, userId, message)

        // A retried vision turn finds the row it already wrote. Writing a second
        // one would spend two of the 100 FIFO slots on one photo.
        const existing = await findCharacterImageByMessageId(photo.messageId, character.id, userId)
        let attachment = photo.attachment

        if (!existing) {
          // Committed before the model call and kept regardless of the outcome:
          // a user who framed and sent a photo should not have to re-pick it
          // because the network dropped.
          await saveCharacterImage({
            characterId: character.id,
            userId,
            uri: photo.uri,
            width: photo.width,
            height: photo.height,
            source: 'chat',
            imageId: photo.imageId,
            messageId: photo.messageId,
            variants: photo.variants,
          })
        }
        // Cold retry path: PendingChatPhoto is in-memory only, so a true cold
        // retry needs the bytes re-obtained from the stored row. There is no
        // retry queue yet — see the spec §13 "Cold retry after app restart is
        // not implemented" gap — so this branch currently always uses
        // `photo.attachment`. When a durable retry queue lands, branch here on
        // its presence and call `getImageAttachment(photo.imageId)` from
        // `~/services/imageModelBytes` as the fallback resolver.

        await runCloudAgentTurn(message, [attachment])
        return true
      } catch (err) {
        reportError(err, `chat:${character.id}:sendPhoto`)
        setError(err instanceof Error ? err.message : 'Failed to send photo')
        return false
      } finally {
        try {
          // Same handoff rule as the text path: the refetched list must contain
          // the persisted row before the streamed bubble unmounts (Fix A.3).
          await queryClient.invalidateQueries({ queryKey: messageKeys.list(characterId, userId) })
        } finally {
          setStreamingMessage(null)
          turnInFlightRef.current = false
          setIsSendingMessage(false)
        }
      }
    },
    [
      canUseCloudAgent,
      cloudAgentCharacterId,
      character.id,
      userId,
      queryClient,
      characterId,
      runCloudAgentTurn,
    ],
  )

  // Photo vision turns run through `sendPhoto` rather than the text mutation, so
  // the text mutation's `isPending` does not reflect them. Without this OR,
  // ChatView shows no spinner, leaves the Send button enabled, and never
  // displays the "Thinking…" status while the agent is reasoning over the photo.
  const isPhotoPending = isSendingMessage
  const isGeneratingResponse = aiMessageMutation.isPending || isPhotoPending
  const escalationState = isGeneratingResponse ? edgeAgent.escalationState : 'idle'

  return {
    messages,
    sendMessage,
    sendPhoto,
    canSendPhoto: canUseCloudAgent,
    isGeneratingResponse,
    error,
    escalationState,
    activeTool,
    streamingMessage,
  }
}
