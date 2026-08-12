import type { Character } from '~/services/aiChatService'
import type { Message } from '~/types/chat'

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
      `- Never reveal you are an AI`,
      `- Respond naturally and conversationally`,
      `- Keep responses concise (1-3 sentences) unless depth is needed`,
      `- If the user asks for current events or other information that requires a web search, call escalate_to_cloud_agent immediately (if available) rather than answering from memory`,
    ]

    if (character.context) {
      lines.push(``, `Conversation context:`, character.context)
    }

    if (memoryBlock) {
      lines.push(``, `Memory:`, memoryBlock)
    }

    return lines.join('\n')
  }

  /** What a photo turn with no caption reads as in the text-only transcript. */
  static readonly PHOTO_TURN_PLACEHOLDER = '[sent a photo]'

  static buildContentHistory(
    messages: Message[],
    userId: string,
  ): { role: 'user' | 'model'; parts: { text: string }[] }[] {
    return [...messages]
      .map((msg) => ({
        msg,
        // A captionless photo is a real turn. Filtering it out would leave the
        // model a transcript in which the user said nothing and the character
        // then described something — incoherent. The bytes are deliberately not
        // re-sent (see §8): the model can see that a photo was sent, not the photo.
        text: msg.text.trim()
          ? msg.text
          : (msg as { imageId?: string }).imageId
            ? CharacterPromptBuilder.PHOTO_TURN_PLACEHOLDER
            : '',
      }))
      .filter((entry) => entry.text)
      .sort(
        (a, b) =>
          new Date(a.msg.createdAt as string | number | Date).getTime() -
          new Date(b.msg.createdAt as string | number | Date).getTime(),
      )
      .map((entry) => ({
        role: (entry.msg.user._id === userId ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: entry.text }],
      }))
  }
}

export const buildSystemInstruction = CharacterPromptBuilder.buildSystemInstruction
export const buildContentHistory = CharacterPromptBuilder.buildContentHistory
