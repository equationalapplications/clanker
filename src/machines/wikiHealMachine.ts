import type { Character } from '~/services/aiChatService'
import { triggerMemoryWrite } from '~/services/memoryService'

export interface WikiWriteInput {
  character: Character
  userId: string
  chunk: string
}

export async function dispatchWikiWrite(input: WikiWriteInput): Promise<void> {
  await triggerMemoryWrite(input.character, input.userId, input.chunk)
}