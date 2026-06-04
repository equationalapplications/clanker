import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { llmWikiEntries, llmWikiEvents } from '../db/schema.js'
import { clip, inferTags } from '../../../shared/wiki-utils.js'
import type { DrizzleClient } from '../db/client.js'

type EmbedFn = (text: string) => Promise<number[]>

function parseSummary(summary: string): { title: string; body: string; tags: string[] } {
  const title = clip(summary.split(/[.!?]/)[0] ?? summary, 64)
  const body = clip(summary, 200)
  return { title, body, tags: inferTags(summary) }
}

export function wikiReadTool(db: DrizzleClient, userId: string, characterId: string, embed: EmbedFn): FunctionTool {
  return new FunctionTool({
    name: 'wiki_read',
    description: "Search the user's long-term memory using semantic search. ALWAYS use if the user asks to recall something previously discussed.",
    parameters: z.object({
      query: z.string().describe('Topic or keywords to search for.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { query } = args as { query: string }
        if (!query?.trim()) return ''

        let rows: { title: string; body: string }[]

        try {
          const vec = await embed(query.trim())
          rows = await db
            .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
            .from(llmWikiEntries)
            .where(and(
              eq(llmWikiEntries.entityId, characterId),
              eq(llmWikiEntries.userId, userId),
              isNull(llmWikiEntries.deletedAt),
            ))
            .orderBy(sql`${llmWikiEntries.embedding} <=> ${JSON.stringify(vec)}::vector`)
            .limit(5)
        } catch {
          // embedText failed — fall back to full-text search
          rows = await db
            .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
            .from(llmWikiEntries)
            .where(and(
              eq(llmWikiEntries.entityId, characterId),
              eq(llmWikiEntries.userId, userId),
              isNull(llmWikiEntries.deletedAt),
              sql`to_tsvector('english', coalesce(${llmWikiEntries.title}, '') || ' ' || coalesce(${llmWikiEntries.body}, '')) @@ websearch_to_tsquery('english', ${query.trim().slice(0, 200)})`,
            ))
            .limit(5)
        }

        if (rows.length === 0) return ''
        return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
      } catch (error) {
        console.error('[CloudAgent] wiki_read failed:', error)
        return 'Failed to search memory due to an internal error.'
      }
    },
  })
}

export function wikiWriteTool(db: DrizzleClient, userId: string, characterId: string, embed: EmbedFn): FunctionTool {
  return new FunctionTool({
    name: 'wiki_write',
    description: 'Record a new observation about the user into long-term memory. Call when the user shares a personal detail, preference, or fact.',
    parameters: z.object({
      summary: z.string().describe('Observation to record.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { summary } = args as { summary: string }
        if (!summary?.trim()) return 'Failed to record observation: summary is required.'

        const { title, body, tags } = parseSummary(summary.trim())
        const entryId = crypto.randomUUID()
        const now = Date.now()

        let embedding: number[] | null = null
        try { embedding = await embed(body) } catch { console.warn('[CloudAgent] wiki_write embed failed, inserting with null embedding') }

        await db.transaction(async (tx) => {
          await (tx as unknown as typeof db).insert(llmWikiEntries).values({
            id: entryId,
            entityId: characterId,
            userId,
            title,
            body,
            tags,
            confidence: 'inferred',
            sourceType: 'agent_inferred',
            embedding,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: [llmWikiEntries.id, llmWikiEntries.userId],
            set: {
              body: sql`excluded.body`,
              updatedAt: sql`excluded.updated_at`,
              embedding: sql`excluded.embedding`,
            },
          })

          await (tx as unknown as typeof db).insert(llmWikiEvents).values({
            id: crypto.randomUUID(),
            entityId: characterId,
            userId,
            eventType: 'observation',
            summary: clip(`${title}: ${body}`, 200),
            createdAt: now,
          })
        })

        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[CloudAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
  })
}
