import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DrizzleClient } from '../db/client.js'

export function documentSearchTool(_db: DrizzleClient, _userId: string, _characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'document_search',
    description: 'Search ingested documents for content relevant to the query.',
    parameters: z.object({
      query: z.string().describe('What to search for in documents.'),
    }),
    execute: async (_args: unknown): Promise<string> => {
      // Document search is not yet implemented on the cloud side.
      return 'Document search is not yet available.'
    },
  })
}