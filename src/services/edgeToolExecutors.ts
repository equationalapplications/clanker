import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'

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
    wiki_read: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'
        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories = results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_read failed:', error)
        return 'No relevant memories found.'
      }
    },
    wiki_write: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary) return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
    create_task: async (args) => {
      try {
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!title) return 'Failed to create task: title is required.'
        const taskId = await createTask(characterId, title)
        return JSON.stringify({ taskId, title })
      } catch (error) {
        console.error('[EdgeAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
    list_tasks: async () => {
      try {
        const tasks = await listTasks(characterId)
        const open = tasks.filter((t: LocalTask) => t.status === 'pending' || t.status === 'open')
        if (open.length === 0) return 'No tasks found.'
        return JSON.stringify(open.map((t: LocalTask) => ({ id: t.id, title: t.title, status: 'open' })))
      } catch (error) {
        console.error('[EdgeAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
    update_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!taskId || !title) return 'Failed to update task: taskId and title are required.'
        await updateTask(characterId, taskId, title)
        return 'Task updated.'
      } catch (error) {
        console.error('[EdgeAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
    complete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to complete task: taskId is required.'
        await completeTask(characterId, taskId)
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[EdgeAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
    delete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to delete task: taskId is required.'
        await deleteTask(characterId, taskId)
        return 'Task deleted.'
      } catch (error) {
        console.error('[EdgeAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
    document_search: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return 'No results found.'
        return 'Document search is not yet available on device.'
      } catch (error) {
        console.error('[EdgeAgent] document_search failed:', error)
        return 'Failed to search documents due to an internal error.'
      }
    },
    set_reminder: async () => {
      return 'ESCALATE_TO_CLOUD_AGENT'
    },
    wiki_get_ontology: async () => {
      if (!wiki) return JSON.stringify({ mode: 'off', manifest: null })
      try {
        const result = await wiki.getOntologyManifest(characterId)
        return JSON.stringify(result ?? { mode: 'off', manifest: null })
      } catch (error) {
        console.error('[EdgeAgent] wiki_get_ontology failed:', error)
        return JSON.stringify({ mode: 'off', manifest: null })
      }
    },
    wiki_traverse_graph: async (args) => {
      try {
        const sourceId = typeof args.sourceId === 'string' ? args.sourceId.trim() : ''
        if (!wiki || !sourceId) return 'Failed to traverse graph: sourceId is required.'
        const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : undefined
        const direction = args.direction as 'inbound' | 'outbound' | 'both' | undefined
        const edgeTypes = Array.isArray(args.edgeTypes) ? (args.edgeTypes as string[]) : undefined
        const neighborhood = await wiki.traverseGraph(characterId, { sourceId, maxDepth, direction, edgeTypes })
        return formatGraphContext(neighborhood)
      } catch (error) {
        console.error('[EdgeAgent] wiki_traverse_graph failed:', error)
        return 'Failed to traverse graph due to an internal error.'
      }
    },
  }
}
