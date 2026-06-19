import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-3-flash-preview',
    instruction: systemInstruction,
    tools: [
      getCurrentTimeTool(timezone),
      wikiReadTool(db, userId, characterId, embed),
      wikiWriteTool(db, userId, characterId, embed),
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      updateTaskTool(db, userId, characterId),
      completeTaskTool(db, userId, characterId),
      deleteTaskTool(db, userId, characterId),
      documentSearchTool(db, userId, characterId),
      setReminderTool(db, userId, characterId),
      GOOGLE_SEARCH,
    ],
  })
}
