import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { tasks } from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

export function createTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'create_task',
    description: 'Create a new task and persist it to cloud storage.',
    parameters: z.object({
      title: z.string().describe('A short, clear title for the task.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { title } = args as { title: string }
        if (!title?.trim()) return 'Failed to create task: title is required.'
        const id = crypto.randomUUID()
        await db.insert(tasks).values({
          id,
          characterId,
          userId,
          title: title.trim(),
          status: 'open',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        return JSON.stringify({ taskId: id, title: title.trim() })
      } catch (error) {
        console.error('[CloudAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
  })
}

export function listTasksTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'list_tasks',
    description: 'List all open tasks for the current character.',
    execute: async (_args: unknown): Promise<string> => {
      try {
        const rows = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.characterId, characterId),
              eq(tasks.userId, userId),
              eq(tasks.status, 'open')
            )
          )
          .orderBy(desc(tasks.createdAt))
        return JSON.stringify(rows)
      } catch (error) {
        console.error('[CloudAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
  })
}

export function updateTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'update_task',
    description: 'Update the title of an existing task.',
    parameters: z.object({
      taskId: z.string(),
      title: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId, title } = args as { taskId: string; title: string }
        if (!taskId?.trim() || !title?.trim()) return 'Failed to update task: taskId and title are required.'
        await db.update(tasks)
          .set({ title: title.trim(), updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task updated.'
      } catch (error) {
        console.error('[CloudAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
  })
}

export function completeTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'complete_task',
    description: 'Mark a task as completed.',
    parameters: z.object({
      taskId: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId } = args as { taskId: string }
        if (!taskId?.trim()) return 'Failed to complete task: taskId is required.'
        await db.update(tasks)
          .set({ status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[CloudAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
  })
}

export function deleteTaskTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'delete_task',
    description: 'Delete a task permanently.',
    parameters: z.object({
      taskId: z.string(),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { taskId } = args as { taskId: string }
        if (!taskId?.trim()) return 'Failed to delete task: taskId is required.'
        await db.delete(tasks)
          .where(and(eq(tasks.id, taskId.trim()), eq(tasks.userId, userId), eq(tasks.characterId, characterId)))
        return 'Task deleted.'
      } catch (error) {
        console.error('[CloudAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
  })
}
