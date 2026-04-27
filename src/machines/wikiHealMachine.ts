import type { Character } from '~/services/aiChatService'
import { triggerMemoryWrite, triggerMemoryHeal, triggerMemoryRead } from '~/services/memoryService'
import { getMessageCount } from '~/database/messageDatabase'
import { getCharacter, updateCharacter } from '~/database/characterDatabase'
import { onlineManager } from '@tanstack/react-query'

export interface WikiWriteInput {
  character: Character
  userId: string
  chunk: string
}

const MEMORY_WRITE_TRIGGER_MESSAGE_COUNT = 20
const HEAL_TRIGGER_MESSAGE_COUNT = 20
const activeWikiJobs = new Set<string>()

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

    if (latestCharacter?.save_to_cloud && latestCharacter?.cloud_id) {
      const charForCloud = { ...input.character, cloud_id: latestCharacter.cloud_id }
      await triggerMemoryRead(charForCloud, input.userId)
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

    if (latestCharacter?.save_to_cloud && latestCharacter?.cloud_id) {
      await triggerMemoryHeal(input.character.id, latestCharacter.cloud_id)
    }
  } catch (error) {
    console.warn('Failed to dispatch wiki write:', error)
  } finally {
    activeWikiJobs.delete(jobKey)
  }
}