import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { WebSocket } from 'ws'
import type { FirestoreSession, DesktopTaskDoc } from '../services/firestoreSession.js'
import type { DesktopBridge } from '../services/desktopBridge.js'

export const VAULT_WIRE_TOOL = {
  vault_wiki_search: 'wiki_search',
  vault_get_ontology: 'wiki_get_ontology',
  vault_traverse_graph: 'wiki_traverse_graph',
  vault_semantic_search: 'vault_semantic_search',
  vault_related_chunks: 'vault_related_chunks',
} as const

export type VaultAdkName = keyof typeof VAULT_WIRE_TOOL

export interface VaultToolConfig {
  firebaseUid: string
  firestoreSession: FirestoreSession
  desktopBridge?: DesktopBridge
  callTimeoutMs?: number
  maxCallsPerTurn?: number
  pauseBilling?: () => void
  resumeBilling?: () => void
  /** Unused by vault tools; optional test hook to assert no credit spend. */
  creditService?: { spendCredit: (...args: unknown[]) => Promise<unknown> }
}

export interface VaultToolDeps extends Required<Pick<VaultToolConfig, 'firebaseUid' | 'firestoreSession'>> {
  desktopBridge?: DesktopBridge
  callTimeoutMs: number
  maxCallsPerTurn: number
  pauseBilling?: () => void
  resumeBilling?: () => void
  callsThisTurn: { count: number }
  /** After first timeout/disconnect in a turn, remaining budget drops to 1 (spec §7). */
  capDecay: { triggered: boolean; maxAllowed: number }
}

export function createVaultToolDeps(config: VaultToolConfig): VaultToolDeps {
  return {
    firebaseUid: config.firebaseUid,
    firestoreSession: config.firestoreSession,
    desktopBridge: config.desktopBridge,
    callTimeoutMs: config.callTimeoutMs ?? 12_000,
    maxCallsPerTurn: config.maxCallsPerTurn ?? 5,
    pauseBilling: config.pauseBilling,
    resumeBilling: config.resumeBilling,
    callsThisTurn: { count: 0 },
    capDecay: { triggered: false, maxAllowed: config.maxCallsPerTurn ?? 5 },
  }
}

const NO_DEVICE_MSG = 'No home computer is connected. Open Curated Thoughts on your desktop, or check Settings → Devices.'
const TIMEOUT_MSG = "Your home computer didn't respond in time. Answer with what you already have, or suggest the user check Curated Thoughts is running."
const CAP_MSG = 'Vault call limit reached for this turn — answer with what you already have.'

function effectiveCap(deps: VaultToolDeps): number {
  return deps.capDecay.triggered ? deps.capDecay.maxAllowed : deps.maxCallsPerTurn
}

function triggerCapDecay(deps: VaultToolDeps): void {
  if (deps.capDecay.triggered) return
  deps.capDecay.triggered = true
  deps.capDecay.maxAllowed = deps.callsThisTurn.count + 1
}

async function dispatchLocalIfConnected(
  deps: VaultToolDeps,
  deviceId: string,
  taskId: string,
  wireTool: string,
  params: Record<string, unknown>,
): Promise<void> {
  const conn = deps.desktopBridge?.get(deps.firebaseUid, deviceId)
  const ws = conn?.ws
if (!ws || ws.readyState !== 1) return
  await deps.firestoreSession.markDesktopTaskExecuting(deps.firebaseUid, taskId)
  ws.send(JSON.stringify({ type: 'task', taskId, tool: wireTool, params }))
}

async function dispatchVaultCall(
  deps: VaultToolDeps,
  adkName: VaultAdkName,
  params: Record<string, unknown>,
): Promise<string> {
  const fs = deps.firestoreSession
  const device = await fs.getActiveDesktopDevice(deps.firebaseUid)
  if (!device) return NO_DEVICE_MSG

  const cap = effectiveCap(deps)
  if (deps.callsThisTurn.count >= cap) return CAP_MSG
  deps.callsThisTurn.count++

  const wireTool = VAULT_WIRE_TOOL[adkName]
  try {
    deps.pauseBilling?.()
    const taskId = crypto.randomUUID()
    await fs.createDesktopTask(deps.firebaseUid, taskId, device.deviceId, wireTool, params)
    await dispatchLocalIfConnected(deps, device.deviceId, taskId, wireTool, params)

    const task = await new Promise<DesktopTaskDoc | null>((resolve) => {
      const timeout = setTimeout(() => {
        unsub()
        void fs.failDesktopTaskIfUnresolved(deps.firebaseUid, taskId, {
          code: 'DESKTOP_TIMEOUT', message: `No result within ${deps.callTimeoutMs}ms`,
        }).catch(() => { /* TTL backstop */ })
        resolve(null)
      }, deps.callTimeoutMs)
      const unsub = fs.watchDesktopTask(deps.firebaseUid, taskId, (t) => {
        if (t.status === 'complete' || t.status === 'failed') {
          clearTimeout(timeout); unsub(); resolve(t)
        }
      })
    })

    if (!task) {
      triggerCapDecay(deps)
      return TIMEOUT_MSG
    }
    if (task.status === 'failed') {
      const code = task.error?.code
      if (code === 'DESKTOP_DISCONNECTED' || code === 'DESKTOP_TIMEOUT') {
        triggerCapDecay(deps)
        return TIMEOUT_MSG
      }
      return `Vault query failed: ${task.error?.message ?? 'unknown error'}`
    }
    return `Vault result (${wireTool}): ${JSON.stringify(task.result)}`
  } finally {
    deps.resumeBilling?.()
  }
}

const wikiSearchSchema = z.object({
  query: z.string().describe('Search text for the vault knowledge graph.'),
  entityIds: z.array(z.string()).optional().describe('Memory tiers to search. Default: ["tier_fact","tier_wisdom"].'),
  limit: z.number().int().min(1).max(25).optional().describe('Max results, default 10.'),
})
const getOntologySchema = z.object({
  entityId: z.string().describe('Memory tier whose ontology manifest to fetch, e.g. "tier_fact".'),
})
const traverseGraphSchema = z.object({
  entityId: z.string().describe('Memory tier to traverse.'),
  sourceId: z.string().describe('Seed entry id — get one from vault_wiki_search first.'),
  maxDepth: z.number().int().min(1).max(3).optional().describe('Hops, default 2.'),
  direction: z.enum(['inbound', 'outbound', 'both']).optional().describe('Edge direction, default both.'),
  edgeTypes: z.array(z.string()).optional().describe('Filter to these edge types.'),
})
const semanticSearchSchema = z.object({
  query: z.string().describe('Semantic search over the vault document chunks.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10.'),
})
const relatedChunksSchema = z.object({
  doc_path: z.string().describe('Vault document path to find related chunks for.'),
  limit: z.number().int().min(1).max(10).optional().describe('Max results, default 5.'),
})

const VAULT_PREAMBLE = "Query the user's home computer knowledge vault (Curated Thoughts) — their personal notes and documents, separate from your own character memory. Use when the user asks about their own notes, files, or knowledge base. "

export function buildVaultTools(deps: VaultToolDeps): FunctionTool[] {
  return [
    new FunctionTool({
      name: 'vault_wiki_search',
      description: VAULT_PREAMBLE + 'Search wiki facts by meaning; returns entry ids, titles, scores. Start here to get a sourceId for graph traversal.',
      parameters: wikiSearchSchema,
      execute: async (args: unknown) => dispatchVaultCall(deps, 'vault_wiki_search', args as Record<string, unknown>),
    }),
    new FunctionTool({
      name: 'vault_get_ontology',
      description: VAULT_PREAMBLE + 'Fetch the node/edge type manifest for a memory tier.',
      parameters: getOntologySchema,
      execute: async (args: unknown) => dispatchVaultCall(deps, 'vault_get_ontology', args as Record<string, unknown>),
    }),
    new FunctionTool({
      name: 'vault_traverse_graph',
      description: VAULT_PREAMBLE + 'Walk the knowledge graph outward from a seed entry (from vault_wiki_search).',
      parameters: traverseGraphSchema,
      execute: async (args: unknown) => dispatchVaultCall(deps, 'vault_traverse_graph', args as Record<string, unknown>),
    }),
    new FunctionTool({
      name: 'vault_semantic_search',
      description: VAULT_PREAMBLE + 'Semantic search over raw document chunks in the vault.',
      parameters: semanticSearchSchema,
      execute: async (args: unknown) => dispatchVaultCall(deps, 'vault_semantic_search', args as Record<string, unknown>),
    }),
    new FunctionTool({
      name: 'vault_related_chunks',
      description: VAULT_PREAMBLE + 'Find chunks related to a specific vault document path.',
      parameters: relatedChunksSchema,
      execute: async (args: unknown) => dispatchVaultCall(deps, 'vault_related_chunks', args as Record<string, unknown>),
    }),
  ]
}
