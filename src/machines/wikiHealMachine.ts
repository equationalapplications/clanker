import type { Character } from '~/services/aiChatService'
import { triggerMemoryWrite, triggerMemoryHeal, triggerMemoryRead } from '~/services/memoryService'
import { getMessageCount } from '~/database/messageDatabase'
import { getCharacter, updateCharacter } from '~/database/characterDatabase'
import { onlineManager } from '@tanstack/react-query'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface WikiWriteInput {
  character: Character
  userId: string
  chunk: string
}

const MEMORY_WRITE_TRIGGER_MESSAGE_COUNT = 20
const HEAL_TRIGGER_MESSAGE_COUNT = 20
const activeWikiJobs = new Set<string>()
const bootstrappedCharacters = new Set<string>()

export function resetBootstrapCache(): void {
  bootstrappedCharacters.clear()
}

export async function dispatchWikiWrite(input: WikiWriteInput): Promise<void> {
  const jobKey = `${input.character.id}:${input.userId}`
  if (activeWikiJobs.has(jobKey)) {
    return
  }

  activeWikiJobs.add(jobKey)

  try {
    const [messageCount, latestCharacter] = await Promise.all([
      getMessageCount(input.character.id, input.userId),
      getCharacter(input.character.id, input.userId),
    ])

    if (!onlineManager.isOnline()) {
      return
    }

    if (latestCharacter?.save_to_cloud && latestCharacter?.cloud_id && UUID_RE.test(latestCharacter.cloud_id)) {
      const bootstrapKey = `${input.character.id}:${input.userId}`
      if (!bootstrappedCharacters.has(bootstrapKey)) {
        const charForCloud = { ...input.character, cloud_id: latestCharacter.cloud_id }
        const bootstrapped = await triggerMemoryRead(charForCloud, input.userId)
        if (bootstrapped) {
          bootstrappedCharacters.add(bootstrapKey)
        }
      }
    }

    const memoryCheckpoint = Math.max(0, latestCharacter?.memory_checkpoint ?? 0)
    if (messageCount - memoryCheckpoint < MEMORY_WRITE_TRIGGER_MESSAGE_COUNT) {
      return
    }

    await updateCharacter(input.character.id, input.userId, {
      memory_checkpoint: messageCount,
    })

    const charForCloud = latestCharacter ? { ...input.character, cloud_id: latestCharacter.cloud_id } : input.character
    await triggerMemoryWrite(charForCloud, input.userId, input.chunk)

    const healCheckpoint = Math.max(0, latestCharacter?.heal_checkpoint ?? 0)
    if (messageCount - healCheckpoint < HEAL_TRIGGER_MESSAGE_COUNT) {
      return
    }

    await updateCharacter(input.character.id, input.userId, {
      heal_checkpoint: messageCount,
    })

    await triggerMemoryHeal(input.character.id, input.userId, latestCharacter?.cloud_id)
  } catch (error) {
    console.warn('Failed to dispatch wiki write:', error)
  } finally {
    activeWikiJobs.delete(jobKey)
  }
}