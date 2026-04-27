import { getDatabase } from '~/database/index'

export interface DerivedSynonymRow {
  term: string
  synonyms: string[]
}

export interface DerivedSynonymUpsertInput {
  characterId: string
  term: string
  synonyms: string[]
  updatedAt?: number
}

export async function getDerivedSynonyms(
  characterId: string,
): Promise<DerivedSynonymRow[]> {
  const db = await getDatabase()

  const rows = await db.getAllAsync<{ term: string; synonyms: string }>(
    `SELECT term, synonyms
     FROM derived_synonyms
     WHERE character_id = ?`,
    [characterId],
  )

  return rows.map((row) => {
    let synonyms: string[] = []
    try {
      const parsed = JSON.parse(row.synonyms)
      synonyms = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : []
    } catch {
      synonyms = []
    }

    return {
      term: row.term,
      synonyms,
    }
  })
}

export async function upsertDerivedSynonyms(rows: DerivedSynonymUpsertInput[]): Promise<void> {
  if (rows.length === 0) {
    return
  }

  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const term = row.term.trim().toLowerCase()
      if (!term) {
        continue
      }

      await db.runAsync(
        `INSERT INTO derived_synonyms (term, character_id, synonyms, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(term, character_id) DO UPDATE SET
           synonyms = excluded.synonyms,
           updated_at = excluded.updated_at`,
        [
          term,
          row.characterId,
          JSON.stringify(row.synonyms.map((value) => value.trim().toLowerCase()).filter(Boolean)),
          row.updatedAt ?? Date.now(),
        ],
      )
    }
  })
}