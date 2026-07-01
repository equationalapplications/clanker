import type { IMessage } from 'react-native-gifted-chat'
import { getCharacter } from '~/database/characterDatabase'
import { getMessages } from '~/database/messageDatabase'
import { getRecentConversationHistory } from '~/services/aiChatService'

/** Max chat turns to bridge from Chat → Talk (user + assistant pairs). */
export const LIVE_CHAT_HANDOFF_TURN_LIMIT = 3
const LIVE_CHAT_HANDOFF_MAX_CHARS = 2000

export interface LiveChatHandoff {
  /** Semantic anchor for cloud wiki pre-fetch (user utterances only). */
  memoryQuery: string
  /** Verbatim recent turns injected into the live system instruction. */
  recentChatContext: string
}

/**
 * Build a compact semantic anchor from recent user messages for wiki vector search.
 * Uses raw user text (no role labels) so embeddings match stored facts more closely.
 */
export function buildMemoryQueryFromMessages(messages: IMessage[], userId: string): string {
  const recent = getRecentConversationHistory(messages, LIVE_CHAT_HANDOFF_TURN_LIMIT * 2)
  const userTexts = recent
    .filter((msg) => msg.user._id === userId)
    .map((msg) => msg.text.trim())
    .filter(Boolean)
  if (userTexts.length === 0) return ''

  return userTexts.join('\n').slice(-LIVE_CHAT_HANDOFF_MAX_CHARS)
}

/**
 * Format the most recent chat turns for live session handoff.
 * Uses the character name for assistant lines so the live agent stays in voice.
 */
export function buildRecentChatContextFromMessages(
  messages: IMessage[],
  userId: string,
  characterName = 'Assistant',
): string {
  const recent = getRecentConversationHistory(messages, LIVE_CHAT_HANDOFF_TURN_LIMIT * 2)
  if (recent.length === 0) return ''

  const lines = recent.map((msg) => {
    const role = msg.user._id === userId ? 'User' : characterName
    const normalizedText = msg.text.replace(/\s*\n+\s*/g, ' ').trim()
    return `${role}: ${normalizedText}`
  })
  return lines.join('\n').slice(-LIVE_CHAT_HANDOFF_MAX_CHARS)
}

export async function buildLiveChatHandoff(
  characterId: string,
  userId: string,
): Promise<LiveChatHandoff> {
  const [messages, character] = await Promise.all([
    getMessages(characterId, userId, LIVE_CHAT_HANDOFF_TURN_LIMIT * 2),
    getCharacter(characterId, userId),
  ])
  return {
    memoryQuery: buildMemoryQueryFromMessages(messages, userId),
    recentChatContext: buildRecentChatContextFromMessages(
      messages,
      userId,
      character?.name ?? 'Assistant',
    ),
  }
}
