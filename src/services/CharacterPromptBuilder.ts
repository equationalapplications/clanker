import type { Character } from '~/services/aiChatService'
import type { IMessage } from 'react-native-gifted-chat'

export interface CharacterPromptContext {
  character: Character
  userId: string
  memoryBlock?: string
}

// Expects aiChatService.Character (all string fields), not the nullable DB model from characterService.
export class CharacterPromptBuilder {
  static buildSystemInstruction(ctx: CharacterPromptContext): string {
    const { character, memoryBlock } = ctx

    const lines: string[] = [
      `You are ${character.name}, a virtual friend.`,
      ``,
      `Appearance: ${character.appearance ?? ''}`,
      `Personality traits: ${character.traits ?? ''}`,
      `Emotional style: ${character.emotions ?? ''}`,
      ``,
      `Instructions:`,
      `- Stay in character as ${character.name} at all times`,
      `- If the user asks for current events or other information that requires a web search, call escalate_to_cloud_agent immediately (if available) rather than answering from memory`,

    if (character.context) {
      lines.push(``, `Conversation context:`, character.context)
    }

    if (memoryBlock) {
      lines.push(``, `Memory:`, memoryBlock)
    }

    return lines.join('\n')
  }

  static buildContentHistory(
    messages: IMessage[],
    userId: string,
  ): { role: 'user' | 'model'; parts: { text: string }[] }[] {
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
}

export const buildSystemInstruction = CharacterPromptBuilder.buildSystemInstruction
export const buildContentHistory = CharacterPromptBuilder.buildContentHistory
