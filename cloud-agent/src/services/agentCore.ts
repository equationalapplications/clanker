import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from '../tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from '../tools/wiki.js'
import { wikiGetOntologyManifestTool, wikiTraverseGraphTool } from '../tools/ontology.js'
import { getCurrentTimeTool } from '../tools/time.js'
import { documentSearchTool } from '../tools/documents.js'
import { setReminderTool } from '../tools/reminders.js'
import type { DrizzleClient } from '../db/client.js'
import { llmWikiEntries } from '../db/schema.js'

import { browserActionTool, type BrowserActionDeps } from '../tools/browserAction.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
  bridge?: BrowserActionDeps,
): LlmAgent {
  const tools = [
    getCurrentTimeTool(timezone),
    wikiReadTool(db, userId, characterId, embed),
    wikiWriteTool(db, userId, characterId, embed),
    wikiGetOntologyManifestTool(db, userId, characterId),
    wikiTraverseGraphTool(db, userId, characterId),
    createTaskTool(db, userId, characterId),
    listTasksTool(db, userId, characterId),
    updateTaskTool(db, userId, characterId),
    completeTaskTool(db, userId, characterId),
    deleteTaskTool(db, userId, characterId),
    documentSearchTool(db, userId, characterId),
    setReminderTool(db, userId, characterId),
    GOOGLE_SEARCH,
  ]
  if (bridge) tools.push(browserActionTool(bridge, { trigger: 'text', preBilled: true }))
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-3.5-flash',
    instruction: systemInstruction,
    tools,
  })
}

export function assembleSystemInstruction(
  character: { name: string; appearance: string | null; traits: string | null; emotions: string | null; context: string | null },
  wikiContext: string,
  recentChatContext?: string,
): string {
  const trimmedRecent = recentChatContext?.trim() ?? ''
  return [
    `You are ${character.name}, a virtual friend.`,
    character.appearance && `Appearance: ${character.appearance}`,
    character.traits && `Traits: ${character.traits}`,
    character.emotions && `Emotions: ${character.emotions}`,
    character.context && `Context: ${character.context}`,
    `\nInstructions:\n- Stay in character as ${character.name} at all times\n- Never reveal you are an AI\n- Respond naturally and conversationally\n- Keep responses concise (1-3 sentences) unless depth is needed`,
    wikiContext && `\nKnown facts about the user:\n${wikiContext}`,
    trimmedRecent &&
      `\nRecent chat history (continue this conversation naturally; treat information from these turns as established context, including any web searches or answers already given):\n${trimmedRecent}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function queryWikiContext(
  db: DrizzleClient,
  query: string,
  userId: string,
  characterId: string,
  embed: (text: string) => Promise<number[]>,
): Promise<string> {
  const normalizedQuery = query.trim().slice(0, 200)
  if (!normalizedQuery) return ''

  try {
    const vec = await embed(normalizedQuery)
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
      ))
      .orderBy(sql`${llmWikiEntries.embedding} <=> ${JSON.stringify(vec)}::vector`)
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  } catch {
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
        sql`to_tsvector('english', coalesce(${llmWikiEntries.title}, '') || ' ' || coalesce(${llmWikiEntries.body}, '')) @@ websearch_to_tsquery('english', ${normalizedQuery})`,
      ))
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  }
}
