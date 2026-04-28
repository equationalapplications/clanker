import { getDatabase, isWikiFtsAvailable } from '~/database/index'

export interface LocalWikiEntry {
  id: string
  character_id: string
  user_id: string
  title: string
  body: string
  tags: string
  confidence: 'certain' | 'inferred' | 'tentative'
  created_at: number
  updated_at: number
  last_accessed_at: number | null
  access_count: number
  source_type: 'user_stated' | 'agent_inferred' | 'user_confirmed' | 'user_document'
  synced_to_cloud: number
  cloud_id: string | null
  deleted_at: number | null
  source_hash: string | null
  source_ref: string | null
}

export interface WikiEntryUpsertInput {
  id: string
  characterId: string
  userId: string
  title: string
  body: string
  tags: string[]
  confidence: 'certain' | 'inferred' | 'tentative'
  sourceType?: 'user_stated' | 'agent_inferred' | 'user_confirmed' | 'user_document'
  sourceHash?: string | null
  sourceRef?: string | null
  createdAt?: number
  updatedAt?: number
  lastAccessedAt?: number | null
  accessCount?: number
  syncedToCloud?: number
  cloudId?: string | null
  deletedAt?: number | null
}

interface WikiEntryView {
  id: string
  title: string
  body: string
  confidence: 'certain' | 'inferred' | 'tentative'
  tags: string[]
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function toView(entry: LocalWikiEntry): WikiEntryView {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    confidence: entry.confidence,
    tags: parseTags(entry.tags),
  }
}

/**
 * Extract bare tokens from an FTS5 query string of the form `"foo"* OR "bar"*`.
 * Used to translate the same query into a LIKE-based scan when FTS5 is not
 * available (web/wa-sqlite).
 */
function extractFtsTokens(query: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(query)) !== null) {
    if (match[1]) tokens.push(match[1])
  }
  return tokens
}

function escapeLikePattern(token: string): string {
  // Escape the LIKE wildcards and our chosen escape character.
  return token.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function searchEntries(userId: string, characterId: string, query: string): Promise<WikiEntryView[]> {
  const db = await getDatabase()
  let rows: LocalWikiEntry[]

  if (isWikiFtsAvailable()) {
    rows = await db.getAllAsync<LocalWikiEntry>(
      `SELECT *
       FROM wiki_entries
       WHERE rowid IN (SELECT rowid FROM wiki_fts WHERE wiki_fts MATCH ?)
         AND character_id = ?
         AND user_id = ?
         AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 10`,
      [query, characterId, userId],
    )
  } else {
    // Fallback for platforms without FTS5 (e.g. web/wa-sqlite): scan title/body/tags
    // with LIKE on each token extracted from the FTS5-formatted query.
    const tokens = extractFtsTokens(query).slice(0, 20)
    if (tokens.length === 0) {
      return []
    }

    const tokenClauses: string[] = []
    const params: (string | number)[] = []
    for (const token of tokens) {
      const pattern = `%${escapeLikePattern(token)}%`
      tokenClauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
      params.push(pattern, pattern, pattern)
    }

    rows = await db.getAllAsync<LocalWikiEntry>(
      `SELECT *
       FROM wiki_entries
       WHERE character_id = ?
         AND user_id = ?
         AND deleted_at IS NULL
         AND (${tokenClauses.join(' OR ')})
       ORDER BY updated_at DESC
       LIMIT 10`,
      [characterId, userId, ...params],
    )
  }

  if (rows.length > 0) {
    const now = Date.now()
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(', ')

    await db.runAsync(
      `UPDATE wiki_entries
       SET access_count = access_count + 1, last_accessed_at = ?
       WHERE character_id = ?
         AND user_id = ?
         AND deleted_at IS NULL
         AND id IN (${placeholders})`,
      [now, characterId, userId, ...ids],
    )
  }

  return rows.map(toView)
}

export async function getRecentEntries(
  userId: string,
  characterId: string,
  limit: number,
): Promise<WikiEntryView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalWikiEntry>(
    `SELECT *
     FROM wiki_entries
     WHERE character_id = ?
       AND user_id = ?
       AND deleted_at IS NULL
     ORDER BY COALESCE(last_accessed_at, updated_at) DESC
     LIMIT ?`,
    [characterId, userId, limit],
  )

  return rows.map(toView)
}

export async function countEntries(userId: string, characterId: string): Promise<number> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM wiki_entries
     WHERE character_id = ?
       AND user_id = ?
       AND deleted_at IS NULL`,
    [characterId, userId],
  )

  return row?.count ?? 0
}

export async function upsertWikiEntries(entries: WikiEntryUpsertInput[]): Promise<void> {
  if (entries.length === 0) {
    return
  }

  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      const now = Date.now()
      await db.runAsync(
        `INSERT INTO wiki_entries (
          id,
          character_id,
          user_id,
          title,
          body,
          tags,
          confidence,
          source_type,
          created_at,
          updated_at,
          last_accessed_at,
          access_count,
          synced_to_cloud,
          cloud_id,
          deleted_at,
          source_hash,
          source_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          tags = excluded.tags,
          confidence = excluded.confidence,
          source_type = excluded.source_type,
          updated_at = excluded.updated_at,
          last_accessed_at = CASE
            WHEN wiki_entries.last_accessed_at IS NULL THEN excluded.last_accessed_at
            WHEN excluded.last_accessed_at IS NULL THEN wiki_entries.last_accessed_at
            WHEN excluded.last_accessed_at > wiki_entries.last_accessed_at THEN excluded.last_accessed_at
            ELSE wiki_entries.last_accessed_at
          END,
          access_count = MAX(wiki_entries.access_count, excluded.access_count),
          synced_to_cloud = excluded.synced_to_cloud,
          cloud_id = excluded.cloud_id,
          deleted_at = excluded.deleted_at,
          source_hash = excluded.source_hash,
          source_ref = excluded.source_ref`,

        [
          entry.id,
          entry.characterId,
          entry.userId,
          entry.title.trim(),
          entry.body.trim(),
          JSON.stringify(entry.tags ?? []),
          entry.confidence,
          entry.sourceType ?? 'agent_inferred',
          entry.createdAt ?? now,
          entry.updatedAt ?? now,
          entry.lastAccessedAt ?? null,
          entry.accessCount ?? 0,
          entry.syncedToCloud ?? 0,
          entry.cloudId ?? null,
          entry.deletedAt ?? null,
          entry.sourceHash ?? null,
          entry.sourceRef ?? null,
        ],
      )
    }
  })
}

export async function findEntriesByHash(characterId: string, userId: string, hash: string): Promise<LocalWikiEntry[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalWikiEntry>(
    `SELECT * FROM wiki_entries
     WHERE character_id = ? AND user_id = ? AND source_hash = ? AND deleted_at IS NULL`,
    [characterId, userId, hash],
  )
}

export async function findEntriesByRef(characterId: string, userId: string, sourceRef: string): Promise<LocalWikiEntry[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalWikiEntry>(
    `SELECT * FROM wiki_entries
     WHERE character_id = ? AND user_id = ? AND source_ref = ? AND deleted_at IS NULL`,
    [characterId, userId, sourceRef],
  )
}

export async function bulkInsertEntries(entries: WikiEntryUpsertInput[]): Promise<void> {
  if (entries.length === 0) return
  const db = await getDatabase()
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      const now = Date.now()
      await db.runAsync(
        `INSERT INTO wiki_entries (
          id, character_id, user_id, title, body, tags, confidence, source_type,
          created_at, updated_at, last_accessed_at, access_count,
          synced_to_cloud, cloud_id, deleted_at, source_hash, source_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          tags = excluded.tags,
          confidence = excluded.confidence,
          source_type = excluded.source_type,
          updated_at = excluded.updated_at,
          synced_to_cloud = excluded.synced_to_cloud,
          cloud_id = excluded.cloud_id,
          deleted_at = excluded.deleted_at,
          source_hash = excluded.source_hash,
          source_ref = excluded.source_ref`,
        [
          entry.id,
          entry.characterId,
          entry.userId,
          entry.title.trim(),
          entry.body.trim(),
          JSON.stringify(entry.tags ?? []),
          entry.confidence,
          entry.sourceType ?? 'agent_inferred',
          entry.createdAt ?? now,
          entry.updatedAt ?? now,
          entry.lastAccessedAt ?? null,
          entry.accessCount ?? 0,
          entry.syncedToCloud ?? 0,
          entry.cloudId ?? null,
          entry.deletedAt ?? null,
          entry.sourceHash ?? null,
          entry.sourceRef ?? null,
        ],
      )
    }
  })
}

export async function softDeleteWikiEntriesBySourceRef(
  characterId: string,
  userId: string,
  sourceRef: string,
): Promise<number> {
  const db = await getDatabase()
  const deletedAt = Date.now()
  const result = await db.runAsync(
    `UPDATE wiki_entries
     SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
     WHERE character_id = ? AND user_id = ? AND source_ref = ? AND deleted_at IS NULL`,
    [deletedAt, deletedAt, characterId, userId, sourceRef],
  )
  return result.changes ?? 0
}

export async function softDeleteWikiEntriesBySourceHash(
  characterId: string,
  userId: string,
  sourceHash: string,
): Promise<number> {
  const db = await getDatabase()
  const deletedAt = Date.now()
  const result = await db.runAsync(
    `UPDATE wiki_entries
     SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
     WHERE character_id = ? AND user_id = ? AND source_hash = ? AND deleted_at IS NULL`,
    [deletedAt, deletedAt, characterId, userId, sourceHash],
  )
  return result.changes ?? 0
}

export async function getEntriesForHeal(userId: string, characterId: string): Promise<LocalWikiEntry[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalWikiEntry>(
    `SELECT *
     FROM wiki_entries
     WHERE character_id = ?
       AND user_id = ?
       AND deleted_at IS NULL
     ORDER BY
       CASE WHEN confidence = 'certain' THEN 0 ELSE 1 END ASC,
       access_count DESC
     LIMIT 100`,
    [characterId, userId],
  )
}

export async function softDeleteWikiEntries(
  characterId: string,
  userId: string,
  entryIds: string[],
): Promise<number> {
  if (entryIds.length === 0) {
    return 0
  }

  const db = await getDatabase()
  const deletedAt = Date.now()
  let changed = 0

  await db.withTransactionAsync(async () => {
    for (const entryId of entryIds) {
      const result = await db.runAsync(
        `UPDATE wiki_entries
         SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
         WHERE id = ? AND character_id = ? AND user_id = ?`,
        [deletedAt, deletedAt, entryId, characterId, userId],
      )
      changed += result.changes ?? 0
    }
  })

  return changed
}

export async function softDeleteAllWikiEntries(characterId: string, userId: string): Promise<number> {
  const db = await getDatabase()
  const deletedAt = Date.now()
  const result = await db.runAsync(
    `UPDATE wiki_entries
     SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
     WHERE character_id = ? AND user_id = ? AND deleted_at IS NULL`,
    [deletedAt, deletedAt, characterId, userId],
  )

  return result.changes ?? 0
}
