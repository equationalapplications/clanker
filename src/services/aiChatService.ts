import { sendMessage } from '~/services/messageService'
import {
  getMessageCount,
  getMessagesForContextSummary,
  pruneMessagesForCharacter,
  saveAIMessage,
} from '~/database/messageDatabase'
import { getCharacter as getLocalCharacter, updateCharacter } from '~/database/characterDatabase'
import { generateChatReply, type GenerateChatReplyResult } from '~/services/chatReplyService'
import { summarizeText } from '~/services/summarizeTextService'
import type { UsageSnapshotPayload } from '~/services/usageSnapshot'
import { fetchMemoryBundle } from '~/services/memoryService'
import { dispatchWikiWrite } from '~/machines/wikiHealMachine'
import { onlineManager } from '@tanstack/react-query'
import { IMessage } from 'react-native-gifted-chat'

export interface Character {
  id: string
  name: string
  appearance: string
  traits: string
  emotions: string
  context: string
  cloud_id?: string | null
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

interface ChatContext {
  characterName: string
  characterPersonality: string
  characterTraits: string
  conversationHistory: {
    role: 'user' | 'assistant'
    content: string
  }[]
  memoryBundle?: MemoryBundle | null
}

export interface MemoryFact {
  id: string
  title: string
  body: string
  confidence: 'certain' | 'inferred' | 'tentative'
  tags: string[]
}

export interface MemoryTask {
  id: string
  description: string
  priorityLabel: string
}

export interface MemoryEvent {
  id: string
  eventType: string
  summary: string
}

export interface MemoryBundle {
  facts: MemoryFact[]
  openTasks: MemoryTask[]
  recentEvents: MemoryEvent[]
}

const MAX_CHAT_PROMPT_LENGTH = 11_000
const MAX_CHARACTER_NAME_LENGTH = 100
const MAX_CHARACTER_PERSONALITY_LENGTH = 1_500
const MAX_CHARACTER_TRAITS_LENGTH = 1_000
const MAX_USER_MESSAGE_LENGTH = 3_000
const MAX_HISTORY_CHARS = 4_500
const MAX_MEMORY_BLOCK_CHARS = 1_500
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

function buildConversationHistory(
  conversationHistory: ChatContext['conversationHistory'],
  maxLength: number,
): string {
  if (maxLength <= 0 || conversationHistory.length === 0) {
    return ''
  }

  const selected: string[] = []
  let usedLength = 0

  for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
    const message = conversationHistory[index]
    if (!message) {
      continue
    }

    const prefix = `${message.role}: `
    const separatorLength = selected.length > 0 ? 1 : 0
    const remainingLength = maxLength - usedLength - separatorLength

    if (remainingLength <= prefix.length) {
      break
    }

    const truncatedContent = truncateText(message.content, remainingLength - prefix.length)
    const entry = `${prefix}${truncatedContent}`
    selected.unshift(entry)
    usedLength += entry.length + separatorLength
  }

  return selected.join('\n')
}

function buildReferenceId(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  const referenceId = truncateText(String(value), MAX_REFERENCE_ID_LENGTH)
  return referenceId.length > 0 ? referenceId : undefined
}

function buildMemoryFactLine(fact: MemoryFact): string {
  const tagText = fact.tags.length > 0 ? ` | tags: ${fact.tags.join(', ')}` : ''
  return `  - [${fact.confidence}] ${truncateText(fact.body, 200)}${tagText}`
}

function buildMemoryTaskLine(task: MemoryTask): string {
  return `  - [${task.priorityLabel}] ${task.description.trim()}`
}

function buildMemoryEventLine(event: MemoryEvent): string {
  return `  - [${event.eventType}] ${event.summary.trim()}`
}

function fitMemorySection(
  heading: string,
  lines: string[],
  budget: number,
): { text: string; remainingBudget: number } {
  if (budget <= 0 || lines.length === 0) {
    return { text: '', remainingBudget: budget }
  }

  const keptLines: string[] = []
  let used = heading.length

  for (const line of lines) {
    const addition = `\n${line}`
    if (used + addition.length > budget) {
      break
    }

    keptLines.push(line)
    used += addition.length
  }

  if (keptLines.length === 0) {
    return { text: '', remainingBudget: budget }
  }

  const text = `${heading}\n${keptLines.join('\n')}`
  return {
    text,
    remainingBudget: budget - text.length,
  }
}

function buildMemoryBlock(memoryBundle?: MemoryBundle | null): string {
  if (!memoryBundle) {
    return ''
  }

  const sections: string[] = []
  let remainingBudget = MAX_MEMORY_BLOCK_CHARS - '[MEMORY]\n\n[/MEMORY]'.length

  const factSection = fitMemorySection(
    'Facts:',
    memoryBundle.facts.slice(0, 10).map(buildMemoryFactLine),
    remainingBudget,
  )
  if (factSection.text) {
    sections.push(factSection.text)
    remainingBudget = factSection.remainingBudget
  }

  const taskSection = fitMemorySection(
    'Open tasks:',
    memoryBundle.openTasks.slice(0, 5).map(buildMemoryTaskLine),
    remainingBudget,
  )
  if (taskSection.text) {
    sections.push(taskSection.text)
    remainingBudget = taskSection.remainingBudget
  }

  const eventSection = fitMemorySection(
    'Recent episodic context:',
    memoryBundle.recentEvents.slice(0, 3).map(buildMemoryEventLine),
    remainingBudget,
  )
  if (eventSection.text) {
    sections.push(eventSection.text)
  }

  if (sections.length === 0) {
    return ''
  }

  return `[MEMORY]\n${sections.join('\n\n')}\n[/MEMORY]`
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

export function buildChatPrompt(userMessage: string, context: ChatContext): string {
  const characterName = truncateText(context.characterName, MAX_CHARACTER_NAME_LENGTH)
  const characterPersonality = truncateText(
    context.characterPersonality,
    MAX_CHARACTER_PERSONALITY_LENGTH,
  )
  const characterTraits = truncateText(context.characterTraits, MAX_CHARACTER_TRAITS_LENGTH)
  const boundedUserMessage = truncateText(userMessage, MAX_USER_MESSAGE_LENGTH)
  const boundedConversationHistory = buildConversationHistory(
    context.conversationHistory,
    MAX_HISTORY_CHARS,
  )
  const memoryBlock = buildMemoryBlock(context.memoryBundle)

  const prompt = `You are ${characterName}, a virtual friend chatbot with the following personality:

Personality: ${characterPersonality}
Traits: ${characterTraits}

Instructions:
- Respond as ${characterName} would, staying true to the personality and traits
- Keep responses conversational and engaging
- Respond naturally and authentically to the user's message
- Don't break character or mention that you're an AI
- Keep responses reasonably brief (1-3 sentences unless the conversation calls for more)

${memoryBlock ? `${memoryBlock}\n\n` : ''}Conversation history:
${boundedConversationHistory}

User: ${boundedUserMessage}
${characterName}:`

  return truncateText(prompt, MAX_CHAT_PROMPT_LENGTH)
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
  options?: { hasUnlimited?: boolean },
): Promise<{ usageSnapshot: UsageSnapshot | null }> => {
  try {
    // 1. Send the user's message to local database
    await sendMessage(character.id, userId, userMessage)

    let memoryBundle: MemoryBundle | null = null
    if (options?.hasUnlimited) {
      try {
        memoryBundle = await fetchMemoryBundle(userId, character.id, userMessage.text)
      } catch (error) {
        console.warn('Failed to fetch memory bundle:', error)
      }
    }

    // 2. Prepare context for AI generation
    const chatContext: ChatContext = {
      characterName: character.name,
      characterPersonality: character.context || character.appearance,
      characterTraits: `${character.traits} ${character.emotions}`.trim(),
      conversationHistory: getRecentConversationHistory(conversationHistory, 10).map((msg) => ({
        role: msg.user._id === userId ? 'user' : 'assistant',
        content: msg.text,
      })),
      memoryBundle,
    }

    // 3. Create AI response message ID
    const aiResponseId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 4. Generate AI response through secure cloud function
    const prompt = buildChatPrompt(userMessage.text, chatContext)
    const aiResponse = await generateChatReply({
      prompt,
      referenceId: buildReferenceId(userMessage._id),
    })

    // 5. Save AI response to local database
    await saveAIMessage(character.id, userId, aiResponse.reply, aiResponseId, {
      user: {
        _id: character.id, // The character is responding
        name: character.name,
        avatar: character.appearance || undefined,
      },
    })

    void triggerConversationSummary(character, userId)
    if (options?.hasUnlimited) {
      void dispatchWikiWrite({
        character,
        userId,
        chunk: userMessage.text,
      })
    }
    return { usageSnapshot: toUsageSnapshot(aiResponse) }
  } catch (error) {
    console.error('Error in sendMessageWithAIResponse:', error)

    // Send a fallback error message
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
      return { usageSnapshot: null }
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
