import { sql } from 'drizzle-orm'
import type { GraphNeighborhood, WikiEdge, WikiFact } from '@equationalapplications/core-llm-wiki'
import type { DrizzleClient } from '../db/client.js'

export interface TraverseGraphOptions {
  sourceId: string
  maxDepth?: number
  direction?: 'inbound' | 'outbound' | 'both'
  edgeTypes?: string[]
  maxTraversalNodes?: number
  minTraversalConfidence?: 'certain' | 'inferred' | 'tentative'
}

interface EntryRow extends Record<string, unknown> {
  id: string
  title: string
  body: string
  tags: unknown
  confidence: string
  source_type: string
  source_ref: string | null
  source_hash: string | null
  last_accessed_at: string | null
  access_count: number | string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface EdgeRow extends Record<string, unknown> {
  id: string
  source_id: string
  target_id: string
  edge_type: string
  created_at: string
}

const CONFIDENCE_RANK: Record<'tentative' | 'inferred' | 'certain', number> = {
  tentative: 0,
  inferred: 1,
  certain: 2,
}

const MAX_TRAVERSAL_NODES = 200

function mapEntryRowToFact(row: EntryRow, entityId: string): WikiFact {
  return {
    id: row.id,
    entity_id: entityId,
    title: row.title,
    body: row.body,
    tags: (row.tags ?? []) as string[],
    confidence: row.confidence,
    source_type: row.source_type,
    source_ref: row.source_ref,
    source_hash: row.source_hash,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    last_accessed_at: row.last_accessed_at != null ? Number(row.last_accessed_at) : null,
    access_count: row.access_count != null ? Number(row.access_count) : 0,
    deleted_at: row.deleted_at != null ? Number(row.deleted_at) : null,
  } as unknown as WikiFact
}

export async function traverseGraphCte(
  db: DrizzleClient,
  userId: string,
  entityId: string,
  options: TraverseGraphOptions,
): Promise<GraphNeighborhood> {
  const direction = options.direction ?? 'both'
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 1, 1), 3)
  const maxTraversalNodes = Math.min(
    Math.max(options.maxTraversalNodes ?? 20, 1),
    MAX_TRAVERSAL_NODES,
  )
  const minConfidenceRank = CONFIDENCE_RANK[options.minTraversalConfidence ?? 'tentative']
  const edgeTypes = options.edgeTypes

  // Explicit empty array means "match no edge types" — anchor only, matching
  // GraphTraversalOptions.edgeTypes semantics (distinct from undefined = no filter).
  if (edgeTypes && edgeTypes.length === 0) {
    const anchorResult = await db.execute<EntryRow>(sql`
      SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at
      FROM llm_wiki_entries
      WHERE id = ${options.sourceId} AND entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
    `)
    if (anchorResult.rows.length === 0) return { nodes: [], edges: [] }
    return { nodes: [mapEntryRowToFact(anchorResult.rows[0], entityId)], edges: [] }
  }

  const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
    ? sql`AND e.edge_type IN (${sql.join(edgeTypes.map((t) => sql`${t}`), sql`, `)})`
    : sql``

  const outboundBranch = direction !== 'inbound'
    ? sql`
      UNION ALL
      SELECT next.id, next.title, next.body, next.tags, next.confidence, next.source_type, next.source_ref,
             next.source_hash, next.last_accessed_at, next.access_count, next.created_at, next.updated_at,
             next.deleted_at, t.depth + 1 AS depth, t.path || next.id AS path
      FROM traversal t
      JOIN llm_wiki_edges e ON e.entity_id = ${entityId}::uuid AND e.user_id = ${userId}::uuid AND e.source_id = t.id
      JOIN llm_wiki_entries next ON next.id = e.target_id AND next.entity_id = ${entityId}::uuid
        AND next.user_id = ${userId}::uuid AND next.deleted_at IS NULL
      WHERE t.depth < ${maxDepth}
        AND NOT (next.id = ANY(t.path))
        AND (CASE next.confidence WHEN 'certain' THEN 2 WHEN 'inferred' THEN 1 ELSE 0 END) >= ${minConfidenceRank}
        ${edgeTypeFilter}
    `
    : sql``

  const inboundBranch = direction !== 'outbound'
    ? sql`
      UNION ALL
      SELECT next.id, next.title, next.body, next.tags, next.confidence, next.source_type, next.source_ref,
             next.source_hash, next.last_accessed_at, next.access_count, next.created_at, next.updated_at,
             next.deleted_at, t.depth + 1 AS depth, t.path || next.id AS path
      FROM traversal t
      JOIN llm_wiki_edges e ON e.entity_id = ${entityId}::uuid AND e.user_id = ${userId}::uuid AND e.target_id = t.id
      JOIN llm_wiki_entries next ON next.id = e.source_id AND next.entity_id = ${entityId}::uuid
        AND next.user_id = ${userId}::uuid AND next.deleted_at IS NULL
      WHERE t.depth < ${maxDepth}
        AND NOT (next.id = ANY(t.path))
        AND (CASE next.confidence WHEN 'certain' THEN 2 WHEN 'inferred' THEN 1 ELSE 0 END) >= ${minConfidenceRank}
        ${edgeTypeFilter}
    `
    : sql``

  const nodeResult = await db.execute<EntryRow & { depth: number }>(sql`
    WITH RECURSIVE traversal AS (
      SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at,
             0 AS depth, ARRAY[id] AS path
      FROM llm_wiki_entries
      WHERE id = ${options.sourceId} AND entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
      ${outboundBranch}
      ${inboundBranch}
    )
    SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
           last_accessed_at, access_count, created_at, updated_at, deleted_at, depth
    FROM (
      SELECT DISTINCT ON (id) id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at, depth
      FROM traversal
      ORDER BY id, depth ASC
    ) deduped
    ORDER BY depth ASC, updated_at DESC
    LIMIT ${maxTraversalNodes}
  `)

  if (nodeResult.rows.length === 0) return { nodes: [], edges: [] }

  const nodes = nodeResult.rows.map((row) => mapEntryRowToFact(row, entityId))
  const nodeIds = nodes.map((n) => n.id)

  const edgeResult = await db.execute<EdgeRow>(sql`
    SELECT id, source_id, target_id, edge_type, created_at
    FROM llm_wiki_edges
    WHERE entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
      AND source_id IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})
      AND target_id IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})
  `)

  const edges: WikiEdge[] = edgeResult.rows.map((r) => ({
    id: r.id,
    entity_id: entityId,
    source_id: r.source_id,
    target_id: r.target_id,
    edge_type: r.edge_type,
    created_at: Number(r.created_at),
  }))

  return { nodes, edges }
}
