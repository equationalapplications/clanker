import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and, ilike } from 'drizzle-orm'
import { llmWikiEvents } from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

export function wikiReadTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_read',
    description: 'Search long-term memory for facts relevant to the given query.',
    parameters: z.object({
      query: z.string().describe('The topic or keywords to search for in memory.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { query } = args as { query: string }
        if (!query?.trim()) return 'Failed to search memory: query is required.'
        const rows = await db
          .select({ summary: llmWikiEvents.summary })
          .from(llmWikiEvents)
          .where(
            and(
              eq(llmWikiEvents.entityId, characterId),
              eq(llmWikiEvents.userId, userId),
              ilike(llmWikiEvents.summary, `%${query.trim()}%`)
            )
          )
          .limit(5)
        if (rows.length === 0) return ''
        return rows.map((r) => `- ${r.summary}`).join('\n')
      } catch (error) {
        console.error('[CloudAgent] wiki_read failed:', error)
        return 'Failed to search memory due to an internal error.'
      }
    },
  })
}

export function wikiWriteTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_write',
    description: 'Record a new observation about the user into long-term memory.',
    parameters: z.object({
      summary: z.string().describe('The observation to record about the user.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { summary } = args as { summary: string }
        if (!summary?.trim()) return 'Failed to record observation: summary is required.'
        await db.insert(llmWikiEvents).values({
          id: crypto.randomUUID(),
          entityId: characterId,
          userId,
          eventType: 'observation',
          summary: summary.trim(),
          createdAt: Date.now(),
        })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[CloudAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
  })
}
