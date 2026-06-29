import type { FunctionDeclaration } from '@google/genai'
import { FunctionTool } from '@google/adk'
import { getCurrentTimeTool } from '../tools/time.js'
import { wikiReadTool, wikiWriteTool } from '../tools/wiki.js'
import { wikiGetOntologyManifestTool, wikiTraverseGraphTool } from '../tools/ontology.js'
import {
  createTaskTool, listTasksTool, updateTaskTool,
  completeTaskTool, deleteTaskTool,
} from '../tools/tasks.js'
import { documentSearchTool } from '../tools/documents.js'
import { setReminderTool } from '../tools/reminders.js'
import { browserActionTool, type BrowserActionDeps } from '../tools/browserAction.js'
import type { DrizzleClient } from '../db/client.js'

type EmbedFn = (text: string) => Promise<number[]>

export interface LiveToolSet {
  declarations: FunctionDeclaration[]
  executors: Map<string, (args: unknown) => Promise<unknown>>
}

const LIVE_VOICES = new Set(['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'])
const LIVE_VOICE_FALLBACK = 'Aoede'

export function resolveVoice(raw: string | null | undefined): string {
  if (raw && LIVE_VOICES.has(raw)) return raw
  return LIVE_VOICE_FALLBACK
}

export function buildLiveTools(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  embed: EmbedFn,
  timezone: string,
  bridge?: Omit<BrowserActionDeps, 'pushToLive' | 'pauseBilling' | 'resumeBilling' | 'registerLiveCall'> & {
    pushToLive?: (taskId: string, t: string) => void
    pauseBilling?: () => void
    resumeBilling?: () => void
    registerLiveCall?: (taskId: string) => void
  },
): LiveToolSet {
  const adkTools: FunctionTool[] = [
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
  ]
  if (bridge) {
    adkTools.push(browserActionTool(bridge, { trigger: 'voice', preBilled: false }))
  }

  const declarations = adkTools.map((t) => t._getDeclaration() as FunctionDeclaration)

  const executors = new Map(
    adkTools.map((t) => [
      t.name,
      (t as unknown as { execute: (args: unknown) => Promise<unknown> }).execute.bind(t),
    ]),
  )

  return { declarations, executors }
}
