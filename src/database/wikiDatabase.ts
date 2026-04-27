import { getDatabase } from '~/database/index'

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
  deleted_at: number | null
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

export async function searchEntries(characterId: string, query: string): Promise<WikiEntryView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalWikiEntry>(
    `SELECT *
     FROM wiki_entries
     WHERE rowid IN (SELECT rowid FROM wiki_fts WHERE wiki_fts MATCH ?)
       AND character_id = ?
       AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 10`,
    [query, characterId],
  )

  const now = Date.now()
  for (const row of rows) {
    await db.runAsync(
      `UPDATE wiki_entries
       SET access_count = access_count + 1, last_accessed_at = ?
       WHERE id = ?`,
      [now, row.id],
    )
  }

  return rows.map(toView)
}

export async function getRecentEntries(
  characterId: string,
  limit: number,
): Promise<WikiEntryView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalWikiEntry>(
    `SELECT *
     FROM wiki_entries
     WHERE character_id = ?
       AND deleted_at IS NULL
     ORDER BY COALESCE(last_accessed_at, updated_at) DESC
     LIMIT ?`,
    [characterId, limit],
  )

  return rows.map(toView)
}