// shared/agent-tools-spec.ts
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export type ToolTier = 'both' | 'cloud-only' | 'edge-only'

export interface ToolManifest {
  name: string
  tier: ToolTier
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

export const agentToolSpec: ToolManifest[] = [
  {
    ...(getCurrentTimeManifest.schema as any),
    tier: 'both',
    description: 'CRITICAL: ALWAYS call this tool if the user asks for the current time, date, day of week, or uses relative temporal words (today, tomorrow). Do not guess.',
  },
  {
    name: 'wiki_read',
    tier: 'both',
    description: "Search the user's long-term memory using semantic search. ALWAYS use if the user asks to recall something previously discussed.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Topic or keywords to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'wiki_write',
    tier: 'both',
    description: 'Record a new observation about the user into long-term memory. Call when the user shares a personal detail, preference, or fact.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Observation to record.' } },
      required: ['summary'],
    },
  },
  {
    name: 'create_task',
    tier: 'both',
    description: 'Create a new task or to-do item for the user. Do NOT use for reminders or scheduling.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Task description.' } },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    tier: 'both',
    description: "List the user's current open tasks.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_task',
    tier: 'both',
    description: 'Update the title of an existing task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['taskId', 'title'],
    },
  },
  {
    name: 'complete_task',
    tier: 'both',
    description: 'Mark a task as completed.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_task',
    tier: 'both',
    description: 'Delete a task permanently.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'document_search',
    tier: 'both',
    description: 'Search ingested documents for content relevant to the query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for in documents.' } },
      required: ['query'],
    },
  },
  {
    name: 'set_reminder',
    tier: 'both',
    description: 'Schedule a reminder for the user at a specific future time.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime.' },
      },
      required: ['message', 'remind_at'],
    },
  },
  {
    ...(escalateToCloudManifest.schema as any),
    tier: 'edge-only',
    description: 'Escalate complex workflows or writing tasks to the cloud agent. Do NOT use for casual chat, time checks, memory reads/writes, or basic untimed task creation.',
  },
]

export function getSchemasForEdge(hasWiki: boolean, isCloudSynced: boolean) {
  return agentToolSpec
    .filter(t => t.tier === 'both' || t.tier === 'edge-only')
    .filter(t => hasWiki || !['wiki_read', 'wiki_write'].includes(t.name))
    .filter(t => isCloudSynced || t.name !== 'escalate_to_cloud_agent')
    .map(({ name, description, parameters }) => ({ name, description, parameters }))
}

export function getSchemasForCloud() {
  return agentToolSpec
    .filter(t => t.tier === 'both' || t.tier === 'cloud-only')
    .map(({ name, description, parameters }) => ({ name, description, parameters }))
}
