import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DrizzleClient } from '../db/client.js'

export function setReminderTool(_db: DrizzleClient, _userId: string, _characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'set_reminder',
    description: 'Schedule a reminder for the user at a specific future time.',
    parameters: z.object({
      message: z.string(),
      remind_at: z.string().describe('ISO 8601 datetime.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      const { message, remind_at } = args as { message: string; remind_at: string }
      // Scheduler integration is not yet wired. Stub acknowledges the request.
      console.log(`[CloudAgent] set_reminder stub: "${message}" at ${remind_at}`)
      return `Reminder set: "${message}" for ${remind_at}.`
    },
  })
}