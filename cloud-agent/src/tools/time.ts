import { FunctionTool } from '@google/adk'
import { z } from 'zod'

export function getCurrentTimeTool(timezone: string): FunctionTool {
  return new FunctionTool({
    name: 'get_current_time',
    description: 'CRITICAL: ALWAYS call this tool if the user asks for the current time, date, day of week, or uses relative temporal words (today, tomorrow). Do not guess.',
    parameters: z.object({}),
    execute: async (): Promise<string> => {
      let tz = timezone || 'UTC'
      try {
        // Validate the timezone string — Intl.DateTimeFormat throws for invalid zones
        Intl.DateTimeFormat(undefined, { timeZone: tz })
      } catch {
        tz = 'UTC'
      }
      return new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: tz,
      })
    },
  })
}