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
      if (!title) throw new Error('title is required')
      const id = crypto.randomUUID()
      await db.insert(tasks).values({
        id,
        characterId,
        userId,
        title,
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return JSON.stringify({ taskId: id, title })
    },
  })
}

export function listTasksTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'list_tasks',
    description: 'List all open tasks for the current character.',
    execute: async (_args: unknown): Promise<string> => {
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
    },
  })
}
