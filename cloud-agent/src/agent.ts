import { LlmAgent } from '@google/adk'
import { createTaskTool, listTasksTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import type { DrizzleClient } from './db/client.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.5-flash',
    instruction: systemInstruction,
    tools: [
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      wikiReadTool(db, userId, characterId),
      wikiWriteTool(db, userId, characterId),
    ],
  })
}
