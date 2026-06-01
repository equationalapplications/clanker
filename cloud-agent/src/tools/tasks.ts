import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
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
      const { title } = args as { title: string }
      if (!title?.trim()) return 'Failed to create task: title is required.'
      const id = crypto.randomUUID()
      try {
        await db.insert(tasks).values({
          id,
          characterId,
          userId,
          title: title.trim(),
          status: 'open',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      } catch (error) {
        console.error('[CloudAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
      return JSON.stringify({ taskId: id, title: title.trim() })
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
          .orderBy(tasks.createdAt)
        return JSON.stringify(rows)
      } catch (error) {
        console.error('[CloudAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
  })
}
