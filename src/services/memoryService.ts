import type { Character, MemoryBundle } from '~/services/aiChatService'
import { buildFtsQuery } from '~/database/ftsQueryBuilder'
import { searchEntries, getRecentEntries } from '~/database/wikiDatabase'
import { getOpenTasks } from '~/database/agentTaskDatabase'
import { getRecentEvents } from '~/database/memoryEventDatabase'

export async function fetchMemoryBundle(
  characterId: string,
  query: string,
): Promise<MemoryBundle> {
  const ftsQuery = await buildFtsQuery(query, characterId)

  const [facts, openTasks, recentEvents] = await Promise.all([
    ftsQuery ? searchEntries(characterId, ftsQuery) : getRecentEntries(characterId, 10),
    getOpenTasks(characterId, 5),
    getRecentEvents(characterId, 3),
  ])

  return {
    facts,
    openTasks,
    recentEvents,
  }
}

export async function triggerMemoryWrite(
  _character: Character,
  _userId: string,
  _chunk: string,
): Promise<void> {
  return
}