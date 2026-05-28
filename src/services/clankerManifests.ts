import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description:
    'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or act rustic.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for reading memory, checking the time, or casual chatting.',
}

export const clankerMemorySchema = {
  name: 'search_memory',
  description:
    "Search the user's local long-term memory and wiki. ALWAYS use this tool if the user asks you to recall something previously discussed or look up a fact.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}
