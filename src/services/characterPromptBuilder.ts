import type { Character } from '~/services/aiChatService'
import type { IMessage } from 'react-native-gifted-chat'

export interface CharacterPromptContext {
  character: Character
  userId: string
  memoryBlock?: string
}

// Expects aiChatService.Character (all string fields), not the nullable DB model from characterService.
/** Returns the system instruction string for @google/genai config, built from character fields and optional memory. */
export function buildSystemInstruction(ctx: CharacterPromptContext): string {
  const { character, memoryBlock } = ctx

  const lines: string[] = [
    `You are ${character.name}, a virtual friend.`,
    ``,
    `Appearance: ${character.appearance}`,
    `Personality traits: ${character.traits}`,
    `Emotional style: ${character.emotions}`,
  ]

  if (character.context) {
    lines.push(``, `Conversation context:`, character.context)
  }

  if (memoryBlock) {
    lines.push(``, `Memory:`, memoryBlock)
  }

  lines.push(
    ``,
    `Instructions:`,
    `- Stay in character as ${character.name} at all times`,
    `- Never reveal you are an AI`,
    `- Respond naturally and conversationally`,
    `- Keep responses concise (1-3 sentences) unless depth is needed`,
  )

  return lines.join('\n')
}

/** Converts IMessage[] to @google/genai Content[], mapping user/_model roles, sorted oldest to newest. */
export function buildContentHistory(
  messages: IMessage[],
  userId: string,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  return [...messages]
    .filter((msg) => msg.text.trim())
    .sort(
      (a, b) =>
        new Date(a.createdAt as string | number | Date).getTime() -
        new Date(b.createdAt as string | number | Date).getTime(),
    )
    .map((msg) => ({
      role: (msg.user._id === userId ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: msg.text }],
    }))
}
