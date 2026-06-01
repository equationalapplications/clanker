import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description:
    'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or fabricate the time.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for checking the time, reading memory, or WRITING/saving observations.',
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
