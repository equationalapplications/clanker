import type { Character, MemoryBundle } from '~/services/aiChatService'
import { buildFtsQuery } from '~/database/ftsQueryBuilder'
import { searchEntries, getRecentEntries, upsertWikiEntries, countEntries, softDeleteWikiEntries, softDeleteAllWikiEntries, softDeleteWikiEntriesBySourceRef, softDeleteWikiEntriesBySourceHash, getEntriesForHeal, type WikiEntryUpsertInput } from '~/database/wikiDatabase'
import { getOpenTasks, upsertAgentTasks, softDeleteAgentTasks, softDeleteAllAgentTasks, getOpenTasksForHeal, type AgentTaskUpsertInput } from '~/database/agentTaskDatabase'
import { getRecentEvents, appendMemoryEvents, type MemoryEventUpsertInput } from '~/database/memoryEventDatabase'
import { upsertDerivedSynonyms, type DerivedSynonymUpsertInput } from '~/database/derivedSynonymDatabase'
import { appCheckReady, memoryWriteFn, memoryHealFn, memoryReadFn, memoryForgetFn } from '~/config/firebaseConfig'
import { queryClient } from '~/config/queryClient'

const activeMemoryWrites = new Set<string>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveCloudCharacterId(character: Pick<Character, 'id' | 'cloud_id'>): string {
  return character.cloud_id && UUID_RE.test(character.cloud_id) ? character.cloud_id : character.id
}

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

interface MemoryReadResponse {
  entries?: unknown[]
  tasks?: unknown[]
  events?: unknown[]
  synonyms?: unknown[]
}

function parseConfidence(value: unknown): 'certain' | 'inferred' | 'tentative' {
  if (value === 'certain' || value === 'tentative') {
    return value
  }

  return 'inferred'
}

function parseSourceType(value: unknown): 'user_stated' | 'agent_inferred' | 'user_confirmed' | 'user_document' {
  if (value === 'user_stated' || value === 'user_confirmed' || value === 'user_document') {
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

function toWikiEntryUpserts(rows: unknown[], characterId?: string): WikiEntryUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: characterId ?? String(row.characterId ?? row.character_id ?? ''),
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
      sourceHash: typeof row.sourceHash === 'string' ? row.sourceHash : typeof row.source_hash === 'string' ? row.source_hash : null,
      sourceRef: typeof row.sourceRef === 'string' ? row.sourceRef : typeof row.source_ref === 'string' ? row.source_ref : null,
    }))
    .filter((row) => row.id && row.characterId && row.userId && row.title && row.body)
}

function toAgentTaskUpserts(rows: unknown[], characterId?: string): AgentTaskUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: characterId ?? String(row.characterId ?? row.character_id ?? ''),
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

function toMemoryEventUpserts(rows: unknown[], characterId?: string): MemoryEventUpsertInput[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id ?? ''),
      characterId: characterId ?? String(row.characterId ?? row.character_id ?? ''),
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
  userId: string,
  diff: { entries?: unknown[]; tasks?: unknown[]; events?: unknown[]; synonyms?: unknown[] },
): Promise<void> {
  const [rawEntryRows, rawTaskRows, rawEventRows, synonymRows] = [
    toWikiEntryUpserts(diff.entries ?? [], characterId),
    toAgentTaskUpserts(diff.tasks ?? [], characterId),
    toMemoryEventUpserts(diff.events ?? [], characterId),
    toDerivedSynonymUpserts(characterId, diff.synonyms ?? []),
  ]

  // Override userId with the locally-known value to prevent server payload mismatches
  const entryRows = rawEntryRows.map((row) => ({ ...row, userId }))
  const taskRows = rawTaskRows.map((row) => ({ ...row, userId }))
  const eventRows = rawEventRows.map((row) => ({ ...row, userId }))

  await upsertWikiEntries(entryRows)
  await upsertAgentTasks(taskRows)
  await appendMemoryEvents(eventRows)
  await upsertDerivedSynonyms(synonymRows)

  await queryClient.invalidateQueries({
    queryKey: ['memoryBundle', characterId, userId],
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
      characterId: resolveCloudCharacterId(character),
      sourceText: chunk,
      sourceType: 'conversation',
    })
    const payload = result.data as MemoryWriteResponse
    await applyMemoryDiff(character.id, userId, payload.diff ?? {})
  } catch (error) {
    console.warn('Failed to trigger memory write:', error)
  } finally {
    activeMemoryWrites.delete(memoryKey)
  }
}

export async function triggerMemoryHeal(characterId: string, userId: string, cloudId?: string | null): Promise<void> {
  try {
    await appCheckReady

    const isLocalOnly = !cloudId || !UUID_RE.test(cloudId)
    const resolvedCharacterId = isLocalOnly ? characterId : cloudId!

    let localDump: { entries: object[]; tasks: object[] } | undefined
    if (isLocalOnly) {
      const [entries, tasks] = await Promise.all([
        getEntriesForHeal(userId, characterId),
        getOpenTasksForHeal(userId, characterId),
      ])
      localDump = {
        entries: entries.map((e) => {
          let tags: string[] = []
          try {
            const parsed: unknown = JSON.parse(e.tags)
            tags = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
          } catch {
            tags = []
          }
          return {
            id: e.id,
            title: e.title,
            body: e.body,
            tags,
            confidence: e.confidence,
            sourceType: e.source_type,
            createdAt: e.created_at,
            updatedAt: e.updated_at,
            lastAccessedAt: e.last_accessed_at,
            accessCount: e.access_count,
            deletedAt: e.deleted_at,
          }
        }),
        tasks: tasks.map((t) => ({
          id: t.id,
          description: t.description,
          priority: t.priority,
        })),
      }
    }

    const result = await memoryHealFn({ characterId: resolvedCharacterId, localDump })
    const payload = result.data as MemoryHealResponse
    await applyMemoryDiff(characterId, userId, payload.diff ?? {})
  } catch (error) {
    console.warn('Failed to trigger memory heal:', error)
  }
}

export async function triggerMemoryRead(character: Character, userId: string): Promise<boolean> {
  const cloudId = resolveCloudCharacterId(character)
  if (cloudId === character.id) {
    return true
  }

  const existingCount = await countEntries(userId, character.id)
  if (existingCount > 0) {
    return true
  }

  try {
    await appCheckReady
    const result = await memoryReadFn({ characterId: cloudId })
    const payload = result.data as MemoryReadResponse
    await applyMemoryDiff(character.id, userId, payload)
    return true
  } catch (error) {
    console.warn('Failed to bootstrap memory from cloud:', error)
    return false
  }
}

export async function forgetMemory(
  character: Pick<Character, 'id' | 'cloud_id'>,
  userId: string,
  target: { entryIds?: string[]; taskIds?: string[]; clearAll?: boolean; sourceRef?: string; sourceHash?: string },
): Promise<void> {
  const characterId = character.id
  const cloudCharacterId = resolveCloudCharacterId(character)
  const entryIds = target.entryIds ?? []
  const taskIds = target.taskIds ?? []
  const clearAll = target.clearAll ?? false

  // Normalize sourceRef: mirror server sanitization (strip path separators and null bytes,
  // trim, cap at 255). Treat whitespace-only or empty values as null so they don't trigger
  // a local soft-delete that the cloud call would treat as a no-op.
  const rawSourceRef = target.sourceRef
  const sourceRef: string | null =
    rawSourceRef !== undefined
      ? (() => {
          const cleaned = rawSourceRef
            .replace(/[/\\]/g, '')
            .split('\0').join('')
            .trim()
            .slice(0, 255)
          return cleaned.length > 0 ? cleaned : null
        })()
      : null

  // Normalize sourceHash: must be a valid 64-char hex SHA-256 string.
  // Discard invalid values so local deletion isn't applied when the cloud
  // call would reject the same input.
  const rawSourceHash = target.sourceHash
  const sourceHash: string | null =
    rawSourceHash !== undefined && /^[0-9a-f]{64}$/i.test(rawSourceHash)
      ? rawSourceHash.toLowerCase()
      : null

  try {
    if (clearAll) {
      await Promise.all([
        softDeleteAllWikiEntries(characterId, userId),
        softDeleteAllAgentTasks(characterId, userId),
      ])
    } else {
      await Promise.all([
        entryIds.length > 0 ? softDeleteWikiEntries(characterId, userId, entryIds) : Promise.resolve(0),
        taskIds.length > 0 ? softDeleteAgentTasks(characterId, userId, taskIds) : Promise.resolve(0),
        sourceRef !== null ? softDeleteWikiEntriesBySourceRef(characterId, userId, sourceRef) : Promise.resolve(0),
        sourceHash !== null ? softDeleteWikiEntriesBySourceHash(characterId, userId, sourceHash) : Promise.resolve(0),
      ])
    }
  } catch (error) {
    console.warn('Failed to apply local memory forget:', error)
  }

  if (cloudCharacterId !== characterId) {
    try {
      await appCheckReady
      await memoryForgetFn({
        characterId: cloudCharacterId,
        entryIds,
        taskIds,
        clearAll,
        ...(sourceRef !== null ? { sourceRef } : {}),
        ...(sourceHash !== null ? { sourceHash } : {}),
      })
    } catch (error) {
      console.warn('Failed to sync memory forget to cloud:', error)
    }
  }

  await queryClient.invalidateQueries({
    queryKey: ['memoryBundle', characterId, userId],
  })
}