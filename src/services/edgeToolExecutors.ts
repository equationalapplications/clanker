import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'

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
        if (tasks.length === 0) return 'No tasks found.'
        return JSON.stringify(tasks.map((t: LocalTask) => ({ id: t.id, title: t.title, status: t.status })))
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
        // Local document search — implementation deferred
        return 'Document search is not yet available on device.'
      } catch (error) {
        console.error('[EdgeAgent] document_search failed:', error)
        return 'Failed to search documents due to an internal error.'
      }
    },
    set_reminder: async () => {
      // This is a phantom tool that exists only to force escalation.
      // The edge agent will see this tool and its description, and call it for reminders.
      // The useEdgeAgent hook will see the 'ESCALATE_TO_CLOUD_AGENT' output and escalate.
      return 'ESCALATE_TO_CLOUD_AGENT'
    },
  }
}
