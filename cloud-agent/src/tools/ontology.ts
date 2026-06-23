import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'
import { llmWikiOntology } from '../db/schema.js'
import { traverseGraphCte } from './graph.js'
import type { DrizzleClient } from '../db/client.js'

export function wikiGetOntologyManifestTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_get_ontology_manifest',
    description: "Retrieve the current ontology manifest (allowed node types and edge types) for the user's memory. Use this to understand the structure of the knowledge graph and what relationships exist before traversing it.",
    parameters: z.object({}),
    execute: async (): Promise<string> => {
      try {
        const rows = await db
          .select({ mode: llmWikiOntology.mode, manifest: llmWikiOntology.manifest })
          .from(llmWikiOntology)
          .where(and(eq(llmWikiOntology.entityId, characterId), eq(llmWikiOntology.userId, userId)))
          .limit(1)
        const row = rows[0]
        return JSON.stringify(row ?? { mode: 'off', manifest: null })
      } catch (error) {
        console.error('[CloudAgent] wiki_get_ontology_manifest failed:', error)
        return 'Failed to retrieve ontology manifest due to an internal error.'
      }
    },
  })
}

export function wikiTraverseGraphTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_traverse_graph',
    description: 'Traverse the knowledge graph starting from a specific fact ID to discover connected concepts and relationships. Returns a formatted neighborhood subgraph.',
    parameters: z.object({
      sourceId: z.string().describe('The exact ID of the starting fact node (obtained from a previous wiki_read call).'),
      maxDepth: z.number().int().min(1).max(3).optional().describe('How many relationship hops to traverse. Maximum allowed is 3. Default 1.'),
      direction: z.enum(['inbound', 'outbound', 'both']).optional().describe("The direction of relationships to follow. Default 'both'."),
      edgeTypes: z.array(z.string()).optional().describe('Optional filter. If provided, traversal only follows these edge types (e.g. ["reports_to", "depends_on"]).'),
      maxTraversalNodes: z.number().int().min(1).max(200).optional().describe('Maximum number of nodes to return, including the anchor. Default 20.'),
      minTraversalConfidence: z.enum(['certain', 'inferred', 'tentative']).optional().describe('Minimum confidence tier required for discovered nodes. Does not gate the anchor. Default tentative.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { sourceId, maxDepth, direction, edgeTypes, maxTraversalNodes, minTraversalConfidence } = args as {
          sourceId: string
          maxDepth?: number
          direction?: 'inbound' | 'outbound' | 'both'
          edgeTypes?: string[]
          maxTraversalNodes?: number
          minTraversalConfidence?: 'certain' | 'inferred' | 'tentative'
        }
        if (!sourceId?.trim()) return 'Failed to traverse graph: sourceId is required.'

        const neighborhood = await traverseGraphCte(db, userId, characterId, {
          sourceId: sourceId.trim(),
          maxDepth,
          direction,
          edgeTypes,
          maxTraversalNodes,
          minTraversalConfidence,
        })

        if (neighborhood.nodes.length === 0) return 'No graph data found for that node.'
        return formatGraphContext(neighborhood)
      } catch (error) {
        console.error('[CloudAgent] wiki_traverse_graph failed:', error)
        return 'Failed to traverse graph due to an internal error.'
      }
    },
  })
}
