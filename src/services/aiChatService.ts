import { sendMessage } from '~/services/messageService'
import {
  getMessageCount,
  getMessagesForContextSummary,
  pruneMessagesForCharacter,
  saveAIMessage,
} from '~/database/messageDatabase'
import { getCharacter as getLocalCharacter, updateCharacter } from '~/database/characterDatabase'
import { generateChatReply, type GenerateChatReplyResult } from '~/services/chatReplyService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { summarizeText } from '~/services/summarizeTextService'
import type { UsageSnapshotPayload } from '~/services/usageSnapshot'
import { onlineManager } from '@tanstack/react-query'
import { IMessage } from 'react-native-gifted-chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import type { SyncMessage } from '~/services/syncMessage'

export interface Character {
  id: string
  name: string
  appearance: string
  traits: string
  emotions: string
  context: string
  cloud_id?: string | null
  save_to_cloud?: number
}

export type UsageSnapshot = UsageSnapshotPayload

function toUsageSnapshot(data: GenerateChatReplyResult): UsageSnapshot {
  return {
    remainingCredits: data.remainingCredits,
    planTier: data.planTier,
    planStatus: data.planStatus,
    verifiedAt: data.verifiedAt,
  }
}

const MAX_CHAT_PROMPT_LENGTH = 12_000
const MAX_CHARACTER_NAME_LENGTH = 100
const MAX_CHARACTER_PERSONALITY_LENGTH = 1_500
const MAX_CHARACTER_TRAITS_LENGTH = 1_000
const MAX_REFERENCE_ID_LENGTH = 128
const SUMMARY_TRIGGER_MESSAGE_COUNT = 20
const SUMMARY_KEEP_RECENT_MESSAGE_COUNT = 20
const SUMMARY_MAX_CHARACTERS = 4_000
const ELLIPSIS = '...'
const activeSummaryJobs = new Set<string>()

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return ''
  }

  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxLength)
  }

  return `${normalized.slice(0, maxLength - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
}

function buildReferenceId(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  const referenceId = truncateText(String(value), MAX_REFERENCE_ID_LENGTH)
  return referenceId.length > 0 ? referenceId : undefined
}

export function getRecentConversationHistory(messages: IMessage[], limit: number): IMessage[] {
  if (limit <= 0 || messages.length === 0) {
    return []
  }

  return [...messages]
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )
    .slice(-limit)
}

function buildSummaryInput(
  characterName: string,
  previousSummary: string,
  recentMessages: {
    role: 'user' | 'assistant'
    content: string
  }[],
): string {
  const previousSection = previousSummary.trim()
    ? `Previous conversation summary (older context):\n${previousSummary.trim()}`
    : 'Previous conversation summary (older context):\n(none yet)'

  const recentSection = recentMessages
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .join('\n')

  return `You are maintaining long-term memory for an AI character named ${characterName}.

Create an updated conversation summary that:
- keeps key facts, goals, preferences, and unresolved threads
- prioritizes details from recent messages over older summarized context
- avoids repetition
- stays concise

${previousSection}

Recent messages (higher priority):
${recentSection}`
}

export async function triggerConversationSummary(character: Character, userId: string): Promise<void> {
  const summaryKey = `${character.id}:${userId}`
  if (activeSummaryJobs.has(summaryKey)) {
    return
  }

  activeSummaryJobs.add(summaryKey)

  try {
    const [latestCharacter, messageCount] = await Promise.all([
      getLocalCharacter(character.id, userId),
      getMessageCount(character.id, userId),
    ])

    const lastSummaryCheckpoint = Math.max(0, latestCharacter?.summary_checkpoint ?? 0)
    if (messageCount - lastSummaryCheckpoint < SUMMARY_TRIGGER_MESSAGE_COUNT) {
      return
    }

    // Advance the checkpoint before attempting so a failed attempt (network error,
    // Vertex unavailable, etc.) does not re-trigger summarization on every
    // subsequent message. The next retry will only happen once 20 more new
    // messages have accumulated. On success the checkpoint is overwritten with
    // the post-prune count below.
    await updateCharacter(character.id, userId, {
      summary_checkpoint: messageCount,
    })

    const recentMessages = await getMessagesForContextSummary(
      character.id,
      userId,
      SUMMARY_KEEP_RECENT_MESSAGE_COUNT,
    )

    if (recentMessages.length === 0) {
      return
    }

    const previousSummary = latestCharacter?.context ?? character.context ?? ''
    const summaryInput = buildSummaryInput(
      latestCharacter?.name ?? character.name,
      previousSummary,
      recentMessages.map((message) => ({
        role: message.user._id === userId ? 'user' : 'assistant',
        content: message.text,
      })),
    )

    const summary = await summarizeText({
      text: summaryInput,
      maxCharacters: SUMMARY_MAX_CHARACTERS,
    })

    const normalizedSummary = summary.trim()
    if (!normalizedSummary) {
      return
    }

    await pruneMessagesForCharacter(character.id, userId, SUMMARY_KEEP_RECENT_MESSAGE_COUNT)
    const postPruneMessageCount = await getMessageCount(character.id, userId)

    await updateCharacter(character.id, userId, {
      context: normalizedSummary.slice(0, SUMMARY_MAX_CHARACTERS),
      summary_checkpoint: postPruneMessageCount,
    })
  } catch (error) {
    console.warn('Failed to summarize conversation context:', error)
  } finally {
    activeSummaryJobs.delete(summaryKey)
  }
}

function buildIntroductionPrompt(
  characterName: string,
  characterPersonality: string,
  characterTraits: string,
): string {
  const boundedName = truncateText(characterName, MAX_CHARACTER_NAME_LENGTH)
  const boundedPersonality = truncateText(characterPersonality, MAX_CHARACTER_PERSONALITY_LENGTH)
  const boundedTraits = truncateText(characterTraits, MAX_CHARACTER_TRAITS_LENGTH)

  const prompt = `You are ${boundedName}, a virtual friend chatbot. This is your first message to a new user.

Your personality: ${boundedPersonality}
Your traits: ${boundedTraits}

Generate a friendly, warm introduction message that:
- Introduces yourself as ${boundedName}
- Shows your personality
- Invites the user to start a conversation
- Keep it brief and welcoming (1-2 sentences)

Introduction:`

  return truncateText(prompt, MAX_CHAT_PROMPT_LENGTH)
}

/**
 * Send a user message and generate an AI response
 */
export const sendMessageWithAIResponse = async (
  userMessage: IMessage,
  character: Character,
  userId: string,
  conversationHistory: IMessage[] = [],
  options?: {
    memoryBlock?: string
    onWriteObservation?: (characterId: string, text: string) => void
    unsyncedHistory?: SyncMessage[]
  },
): Promise<{ usageSnapshot: UsageSnapshot | null; cloudSyncSucceeded: boolean }> => {
  try {
    // 1. Send the user's message to local database
    await sendMessage(character.id, userId, userMessage)

    // Fetch the latest character from the DB so the rolling summary written by a prior
    // triggerConversationSummary pass (which only updates the DB, not the machine state)
    // is included in the prompt.
    let dbCharacter: Awaited<ReturnType<typeof getLocalCharacter>> = null
    try {
      dbCharacter = await getLocalCharacter(character.id, userId)
    } catch (e) {
      console.warn('Failed to read latest character context from DB:', e)
    }
    const effectiveContext = dbCharacter?.context ?? character.context

    const memoryBlock = options?.memoryBlock

    // 2. Prepare context for AI generation
    // Filter out the current user message from history — React Query's optimistic update
    // can inject it into the messages array before mutationFn executes, causing the
    // current message to appear twice (once in history, once as the explicit User: prompt).
    const priorHistory = conversationHistory.filter(
      (msg) => String(msg._id) !== String(userMessage._id),
    )
    const recentHistory = getRecentConversationHistory(priorHistory, 10)

    // 3. Create AI response message ID
    const aiResponseId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 4. Generate AI response through secure cloud function
    const systemInstruction = buildSystemInstruction({
      character: {
        ...character,
        context: effectiveContext,
      },
      userId,
      memoryBlock,
    })

    const contents = [
      ...buildContentHistory(recentHistory, userId),
      { role: 'user' as const, parts: [{ text: userMessage.text }] },
    ]

    const aiResponse = await generateChatReply({
      contents,
      systemInstruction,
      referenceId: buildReferenceId(userMessage._id),
      unsyncedHistory: options?.unsyncedHistory,
      characterId: character.cloud_id ?? undefined,
    })

    // 5. Save AI response to local database (mark as synced — cloud reply is immediately synced)
    const savedAIMessage = await saveAIMessage(character.id, userId, aiResponse.reply, aiResponseId, {
      user: {
        _id: character.id, // The character is responding
        name: character.name,
        avatar: character.appearance || undefined,
      },
    }, Date.now())

    void triggerConversationSummary(character, userId)
    if (options?.onWriteObservation) {
      // Include the AI response so the observation ends with a complete exchange.
      // Without it the observation ends with "User: [message]" (no reply), and the LLM
      // reads that unanswered line from memory and responds to it instead of the actual
      // current prompt — causing every reply to lag one message behind.
      const recentMessages = getRecentConversationHistory(
        [...priorHistory, userMessage, savedAIMessage],
        20,
      )
      const chunk = recentMessages
        .map((msg) => `${msg.user._id === userId ? 'User' : character.name}: ${msg.text}`)
        .join('\n')
      try {
        void Promise.resolve(
          options.onWriteObservation(character.id, chunk || userMessage.text),
        ).catch((observationError) => {
          if (!(observationError instanceof WikiBusyError)) {
            reportError(observationError, `wiki:${character.id}:write:observation`)
          }
        })
      } catch (observationError) {
        if (!(observationError instanceof WikiBusyError)) {
          reportError(observationError, `wiki:${character.id}:write:observation`)
        }
      }
    }
    return { usageSnapshot: toUsageSnapshot(aiResponse), cloudSyncSucceeded: true }
  } catch (error) {
    const firebaseCode = (error as { code?: string }).code
    if (firebaseCode === 'functions/failed-precondition') {
      throw error
    }

    console.error('Error in sendMessageWithAIResponse:', error)

    // For transient/unknown errors, save a fallback message so the chat stays usable.
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
      return { usageSnapshot: null, cloudSyncSucceeded: false }
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

    const introResult = await generateChatReply({
      prompt: introPrompt,
      referenceId: buildReferenceId(`intro-${character.id}`),
    })

    const introId = `intro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await saveAIMessage(character.id, userId, introResult.reply, introId, {
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
