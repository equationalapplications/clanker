import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'

export type ToolExecutor = (args: Record<string, unknown>) => unknown | Promise<unknown>

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
}

export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    search_memory: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'

        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories =
          results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] Local memory search failed:', error)
        return 'No relevant memories found.'
      }
    },
    write_observation: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary) return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] write_observation failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
  }
}
