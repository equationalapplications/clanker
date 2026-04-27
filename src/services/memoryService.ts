import type { Character, MemoryBundle } from '~/services/aiChatService'
import { buildFtsQuery } from '~/database/ftsQueryBuilder'
import { searchEntries, getRecentEntries, upsertWikiEntries, type WikiEntryUpsertInput } from '~/database/wikiDatabase'
import { getOpenTasks, upsertAgentTasks, type AgentTaskUpsertInput } from '~/database/agentTaskDatabase'
import { getRecentEvents, appendMemoryEvents, type MemoryEventUpsertInput } from '~/database/memoryEventDatabase'
import { upsertDerivedSynonyms, type DerivedSynonymUpsertInput } from '~/database/derivedSynonymDatabase'
import { appCheckReady, memoryWriteFn, memoryHealFn } from '~/config/firebaseConfig'
import { queryClient } from '~/config/queryClient'

const activeMemoryWrites = new Set<string>()

interface MemoryWriteResponse {
  diff?: {
    entries?: unknown[]
    tasks?: unknown[]
    events?: unknown[]
    synonyms?: unknown[]
  }
}

interface MemoryHealResponse {
  diff?: {
    entries?: unknown[]
    tasks?: unknown[]
    events?: unknown[]
    synonyms?: unknown[]
  }
}

function parseConfidence(value: unknown): 'certain' | 'inferred' | 'tentative' {
  if (value === 'certain' || value === 'tentative') {
    return value
  }

  return 'inferred'
}

function parseSourceType(value: unknown): 'user_stated' | 'agent_inferred' | 'user_confirmed' {
  if (value === 'user_stated' || value === 'user_confirmed') {
    return value
  }

  return 'agent_inferred'
}

function parseTaskStatus(value: unknown): 'pending' | 'in_progress' | 'done' | 'abandoned' {
  if (value === 'in_progress' || value === 'done' || value === 'abandoned') {
    return value
  }

  return 'pending'
}

function parseEventType(value: unknown): 'observation' | 'decision' | 'action' | 'outcome' {
  if (value === 'decision' || value === 'action' || value === 'outcome') {
    return value
  }

  return 'observation'
}

function toWikiEntryUpserts(rows: unknown[]): WikiEntryUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: String(row.characterId ?? row.character_id ?? ''),
      userId: String(row.userId ?? row.user_id ?? ''),
      title: String(row.title ?? ''),
      body: String(row.body ?? ''),
      tags: Array.isArray(row.tags) ? row.tags.filter((value): value is string => typeof value === 'string') : [],
      confidence: parseConfidence(row.confidence),
      sourceType: parseSourceType(row.sourceType),
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
      lastAccessedAt: typeof row.lastAccessedAt === 'number' ? row.lastAccessedAt : null,
      accessCount: typeof row.accessCount === 'number' ? row.accessCount : 0,
      syncedToCloud: typeof row.syncedToCloud === 'number' ? row.syncedToCloud : 0,
      cloudId: typeof row.cloudId === 'string' ? row.cloudId : null,
      deletedAt: typeof row.deletedAt === 'number' ? row.deletedAt : null,
    }))
    .filter((row) => row.id && row.characterId && row.userId && row.title && row.body)
}

function toAgentTaskUpserts(rows: unknown[]): AgentTaskUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: String(row.characterId ?? row.character_id ?? ''),
      userId: String(row.userId ?? row.user_id ?? ''),
      description: String(row.description ?? ''),
      status: parseTaskStatus(row.status),
      priority: typeof row.priority === 'number' ? row.priority : 0,
      dueContext: typeof row.dueContext === 'string' ? row.dueContext : null,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
      resolvedAt: typeof row.resolvedAt === 'number' ? row.resolvedAt : null,
      resolutionNote: typeof row.resolutionNote === 'string' ? row.resolutionNote : null,
      syncedToCloud: typeof row.syncedToCloud === 'number' ? row.syncedToCloud : 0,
      cloudId: typeof row.cloudId === 'string' ? row.cloudId : null,
      deletedAt: typeof row.deletedAt === 'number' ? row.deletedAt : null,
    }))
    .filter((row) => row.id && row.characterId && row.userId && row.description)
}

function toMemoryEventUpserts(rows: unknown[]): MemoryEventUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: String(row.characterId ?? row.character_id ?? ''),
      userId: String(row.userId ?? row.user_id ?? ''),
      eventType: parseEventType(row.eventType),
      summary: String(row.summary ?? ''),
      relatedEntryId: typeof row.relatedEntryId === 'string' ? row.relatedEntryId : null,
      relatedTaskId: typeof row.relatedTaskId === 'string' ? row.relatedTaskId : null,
      sourceRef: typeof row.sourceRef === 'string' ? row.sourceRef : null,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : undefined,
      syncedToCloud: typeof row.syncedToCloud === 'number' ? row.syncedToCloud : 0,
      cloudId: typeof row.cloudId === 'string' ? row.cloudId : null,
    }))
    .filter((row) => row.id && row.characterId && row.userId && row.summary)
}

function toDerivedSynonymUpserts(characterId: string, rows: unknown[]): DerivedSynonymUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      characterId,
      term: String(row.term ?? ''),
      synonyms: Array.isArray(row.synonyms)
        ? row.synonyms.filter((value): value is string => typeof value === 'string')
        : [],
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
    }))
    .filter((row) => row.term.length > 0)
}

async function applyMemoryDiff(
  characterId: string,
  diff: { entries?: unknown[]; tasks?: unknown[]; events?: unknown[]; synonyms?: unknown[] },
): Promise<void> {
  const [entryRows, taskRows, eventRows, synonymRows] = [
    toWikiEntryUpserts(diff.entries ?? []),
    toAgentTaskUpserts(diff.tasks ?? []),
    toMemoryEventUpserts(diff.events ?? []),
    toDerivedSynonymUpserts(characterId, diff.synonyms ?? []),
  ]

  await Promise.all([
    upsertWikiEntries(entryRows),
    upsertAgentTasks(taskRows),
    appendMemoryEvents(eventRows),
    upsertDerivedSynonyms(synonymRows),
  ])

  await queryClient.invalidateQueries({
    queryKey: ['memoryBundle', characterId],
  })
}

export async function fetchMemoryBundle(
  userId: string,
  characterId: string,
  query: string,
): Promise<MemoryBundle> {
  const ftsQuery = await buildFtsQuery(query, characterId)

  const [facts, openTasks, recentEvents] = await Promise.all([
    ftsQuery ? searchEntries(userId, characterId, ftsQuery) : getRecentEntries(userId, characterId, 10),
    getOpenTasks(userId, characterId, 5),
    getRecentEvents(userId, characterId, 3),
  ])

  return {
    facts,
    openTasks,
    recentEvents,
  }
}

export async function triggerMemoryWrite(
  character: Character,
  userId: string,
  chunk: string,
): Promise<void> {
  const memoryKey = `${character.id}:${userId}`
  if (activeMemoryWrites.has(memoryKey)) {
    return
  }

  activeMemoryWrites.add(memoryKey)

  try {
    await appCheckReady
    const result = await memoryWriteFn({
      characterId: character.id,
      sourceText: chunk,
      sourceType: 'conversation',
    })
    const payload = result.data as MemoryWriteResponse
    await applyMemoryDiff(character.id, payload.diff ?? {})
  } catch (error) {
    console.warn('Failed to trigger memory write:', error)
  } finally {
    activeMemoryWrites.delete(memoryKey)
  }
}

export async function triggerMemoryHeal(characterId: string): Promise<void> {
  try {
    await appCheckReady
    const result = await memoryHealFn({ characterId })
    const payload = result.data as MemoryHealResponse
    await applyMemoryDiff(characterId, payload.diff ?? {})
  } catch (error) {
    console.warn('Failed to trigger memory heal:', error)
  }
}