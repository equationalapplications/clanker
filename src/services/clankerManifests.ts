import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description:
    'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or fabricate the time.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for checking the time, reading memory, WRITING/saving observations, or creating/listing tasks.',
}

export const clankerMemorySchema = {
  name: 'search_memory',
  description:
    "Search the user's local long-term memory and wiki. ALWAYS use this tool if the user asks you to recall something previously discussed or look up a fact.",
  parameters: {
    type: 'object' as const,
    properties: { query: { type: 'string' as const } },
    required: ['query'],
  },
}

export const clankerWriteObservationSchema = {
  name: 'write_observation',
  description:
    'Record a new observation about the user into long-term memory. Call this when the user shares a personal detail, preference, or fact that should be remembered across future conversations.',
  parameters: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: 'The observation to record about the user.',
      },
    },
    required: ['summary'],
  },
}

export const clankerCreateTaskSchema = {
  name: 'create_task',
  description:
    'Create a new task or to-do item for the user. Use when the user explicitly asks to add, create, or save a task.',
  parameters: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string' as const,
        description: 'The task description.',
      },
    },
    required: ['title'],
  },
}

export const clankerListTasksSchema = {
  name: 'list_tasks',
  description:
    "List the user's current tasks and to-dos. Use when the user asks what tasks they have or wants to see their list.",
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
}
